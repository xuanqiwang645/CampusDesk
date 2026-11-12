import Foundation
import CryptoKit
import Security
import Darwin

enum PatchError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let text) = self { return text }; return nil }
}

struct PatchManifest: Codable {
    let formatVersion: Int
    let bundleID: String
    let appName: String
    let version: String
    let build: Int
    let architecture: String
    let archiveSHA256: String
    let appTreeSHA256: String
    let credentialHelperSHA256: String
    let signingCertificateSHA1: String
}

enum PatchEdition: String, CaseIterable {
    case classic = "local.campusdesk.mac"
    case theme = "local.campusdesk.mac.themeedition"
    var appName: String { self == .theme ? "CampusDesk Theme Edition.app" : "CampusDesk.app" }
    var dataName: String { self == .theme ? "CampusDesk-local-campusdesk-mac-themeedition" : "CampusDesk" }
    var archiveName: String { self == .theme ? "Payload-Theme.zip" : "Payload-Classic.zip" }
    var label: String { self == .theme ? "主题版" : "普通版" }
    var protectedPaths: [String] {
        let id = rawValue
        var paths = ["Application Support/" + dataName, "WebKit/" + id,
                "HTTPStorages/" + id, "HTTPStorages/" + id + ".binarycookies", "Cookies/" + id + ".binarycookies",
                "Preferences/" + id + ".plist", "Caches/" + id, "Saved Application State/" + id + ".savedState", "Containers/" + id]
        if self == .theme { paths.insert("Application Support/CampusDesk Widgets", at: 1) }
        return paths
    }
}

struct PatchCatalog: Codable {
    let formatVersion: Int
    let variants: [PatchManifest]
}

enum PatchFiles {
    static let bundleID = "local.campusdesk.mac.themeedition"
    static let appName = "CampusDesk Theme Edition.app"
    static let helperPath = "Contents/Helpers/CampusDeskCredentials"
    static let dataName = "CampusDesk-local-campusdesk-mac-themeedition"
    static let protectedPaths = [
        "Application Support/" + dataName,
        "Application Support/CampusDesk Widgets",
        "WebKit/" + bundleID,
        "HTTPStorages/" + bundleID,
        "HTTPStorages/" + bundleID + ".binarycookies",
        "Cookies/" + bundleID + ".binarycookies",
        "Preferences/" + bundleID + ".plist",
        "Caches/" + bundleID,
        "Saved Application State/" + bundleID + ".savedState",
        "Containers/" + bundleID
    ]
    static func exists(_ url: URL) -> Bool { (try? FileManager.default.attributesOfItem(atPath: url.path)) != nil }
    static func attributes(_ url: URL) throws -> [FileAttributeKey: Any] { try FileManager.default.attributesOfItem(atPath: url.path) }
    static func isMissing(_ url: URL) throws -> Bool {
        do { _ = try attributes(url); return false }
        catch let error as NSError {
            if error.domain == NSCocoaErrorDomain && [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(error.code) { return true }
            if error.domain == NSPOSIXErrorDomain && error.code == Int(ENOENT) { return true }
            throw PatchError.invalid("无法完整读取用户资料以进行备份和核验，原应用未替换。")
        }
    }
    static func isLink(_ url: URL) throws -> Bool { try attributes(url)[.type] as? FileAttributeType == .typeSymbolicLink }
    static func digest(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
    // Include file bytes, link destinations and permissions, excluding timestamps
    // and Finder metadata that the OS may update independently of this installer.
    static func treeDigest(_ root: URL) throws -> String {
        if try isMissing(root) { return "missing" }
        var lines = [String](), hash = SHA256()
        func visit(_ url: URL, _ relative: String) throws {
            let attr = try attributes(url), type = attr[.type] as? FileAttributeType
            let mode = (attr[.posixPermissions] as? NSNumber)?.intValue ?? 0
            let content: String
            switch type {
            case .typeDirectory:
                content = "directory"
                for child in try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                    try visit(child, relative.isEmpty ? child.lastPathComponent : relative + "/" + child.lastPathComponent)
                }
            case .typeRegular: content = "file:" + (try digest(url))
            case .typeSymbolicLink: content = "link:" + (try FileManager.default.destinationOfSymbolicLink(atPath: url.path))
            default: throw PatchError.invalid("发现不支持的特殊文件，已停止更新。")
            }
            lines.append(relative + "\0" + String(mode) + "\0" + content)
        }
        try visit(root, "")
        for line in lines.sorted() { hash.update(data: Data((line + "\n").utf8)) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
    static func info(_ app: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
        guard let value = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { throw PatchError.invalid("应用信息无法读取。") }
        return value
    }
    @discardableResult static func command(_ executable: String, _ arguments: [String]) throws -> Data {
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
        process.environment = ["PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"]
        process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
        try process.run(); let output = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw PatchError.invalid("文件校验或复制未完成，已停止更新。") }
        return output
    }
    static func copy(_ source: URL, _ target: URL) throws {
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try command("/usr/bin/ditto", [source.path, target.path])
    }
    static func snapshot(home: URL, edition: PatchEdition = .theme) throws -> [String: String] {
        let library = home.appendingPathComponent("Library")
        return try Dictionary(uniqueKeysWithValues: edition.protectedPaths.map { path in
            let source = library.appendingPathComponent(path)
            if try !isMissing(source), try isLink(source) { throw PatchError.invalid("用户资料位置使用了符号链接，无法完整核验；原应用未替换。") }
            return (path, try treeDigest(source))
        })
    }
    static func certificateSHA1(_ app: URL) throws -> String {
        var code: SecStaticCode?, info: CFDictionary?
        guard SecStaticCodeCreateWithPath(app as CFURL, SecCSFlags(), &code) == errSecSuccess, let code,
              SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
              let dictionary = info as? [String: Any], let certificates = dictionary[kSecCodeInfoCertificates as String] as? [SecCertificate], let leaf = certificates.first else {
            throw PatchError.invalid("无法核实应用签名身份，原应用未替换。")
        }
        return Insecure.SHA1.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
    }
    static func checkSignature(_ app: URL, certificate: String) throws {
        try command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path])
        guard try certificateSHA1(app) == certificate else { throw PatchError.invalid("应用签名身份不同，无法确保保留钥匙串访问，更新已停止。") }
    }
    static func swap(_ first: URL, _ second: URL) throws {
        let result = first.path.withCString { a in second.path.withCString { b in renameatx_np(AT_FDCWD, a, AT_FDCWD, b, UInt32(RENAME_SWAP)) } }
        guard result == 0 else { throw PatchError.invalid("无法原子替换应用，原版本未改动。请检查安装目录的写入权限。") }
    }
}

struct PatchResult {
    let target: URL
    let backup: URL?
    let alreadyCurrent: Bool
}

private final class PatchLock {
    let descriptor: Int32
    init(parent: URL) throws {
        let path = parent.appendingPathComponent(".CampusDesk-Patch.lock").path
        let created = open(path, O_RDONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644)
        if created >= 0 { descriptor = created; fchmod(descriptor, 0o644) }
        else if errno == EEXIST { descriptor = open(path, O_RDONLY | O_NOFOLLOW) }
        else { descriptor = -1 }
        guard descriptor >= 0 else { throw PatchError.invalid("无法锁定安装目录，更新未开始。") }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_nlink == 1,
              (info.st_mode & S_IFMT) == S_IFREG, flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            close(descriptor); throw PatchError.invalid("另一个补丁正在安装，或安装锁不可用。请稍后重试。")
        }
    }
    deinit { flock(descriptor, LOCK_UN); close(descriptor) }
}

struct PatchHooks {
    var progress: (String) -> Void = { _ in }
    var ensureStopped: (URL) throws -> Void
    // Fault injection for transaction tests; no command-line switch or UI can set it.
    var afterSwap: (() throws -> Void)? = nil
}

final class PatchEngine {
    let manifest: PatchManifest
    let edition: PatchEdition
    let archive: URL
    let home: URL
    let manager = FileManager.default

    init(manifest: PatchManifest, archive: URL, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws {
        guard let edition = PatchEdition(rawValue: manifest.bundleID), manifest.formatVersion == 1, manifest.appName == edition.appName,
              manifest.build > 0, manifest.architecture == "arm64",
              [manifest.archiveSHA256, manifest.appTreeSHA256, manifest.credentialHelperSHA256].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
              manifest.signingCertificateSHA1.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil else { throw PatchError.invalid("补丁说明文件不完整。") }
        self.manifest = manifest; self.edition = edition; self.archive = archive; self.home = home
    }

    static func versionParts(_ text: String) -> [Int]? {
        let pieces = text.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...4).contains(pieces.count), pieces.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
              pieces.allSatisfy({ Int($0) != nil }) else { return nil }
        return pieces.map { Int($0)! }
    }
    static func compareVersions(_ left: [Int], _ right: [Int]) -> Int {
        for i in 0..<max(left.count, right.count) {
            let a = i < left.count ? left[i] : 0, b = i < right.count ? right[i] : 0
            if a != b { return a < b ? -1 : 1 }
        }
        return 0
    }
    func credentialHelperUnchanged(at app: URL) throws -> Bool {
        let helper = app.appendingPathComponent(PatchFiles.helperPath)
        guard PatchFiles.exists(helper), try !PatchFiles.isLink(helper) else { return false }
        return try PatchFiles.digest(helper) == manifest.credentialHelperSHA256
    }
    private func legacyConfiguration(in backup: URL) throws -> [String: Any] {
        func object(_ url: URL, limit: Int = 8192) -> [String: Any] {
            guard let size = try? PatchFiles.attributes(url)[.size] as? NSNumber, size.intValue <= limit,
                  let bytes = try? Data(contentsOf: url), let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { return [:] }
            return value
        }
        func origin(_ raw: String, _ source: String) -> String? {
            guard raw.count <= 4096, let url = URLComponents(string: raw), url.scheme == "https", url.user == nil, url.password == nil,
                  let host = url.host?.lowercased(), url.port == nil || url.port == 443 else { return nil }
            let suffixes = source == "seiue" ? ["seiue.com"] : ["managebac.com", "managebac.cn"]
            guard suffixes.contains(where: { host == $0 || host.hasSuffix("." + $0) }) else { return nil }
            return "https://" + host + "/"
        }
        let oldResources = backup.appendingPathComponent(manifest.appName + "/Contents/Resources")
        let bundled = object(oldResources.appendingPathComponent("SchoolConfig.json"))
        let state = object(backup.appendingPathComponent("Library/Application Support/" + edition.dataName + "/state.json"), limit: 25 * 1024 * 1024)
        let settings = state["settings"] as? [String: Any] ?? [:], snapshots = state["snapshots"] as? [String: Any] ?? [:]
        var homes = [String: String]()
        for source in ["seiue", "managebac"] {
            if let value = bundled[source] as? String, let url = origin(value, source) { homes[source] = url }
            else if let value = settings[source + "URL"] as? String, let url = origin(value, source) { homes[source] = url }
            else if let pages = snapshots[source] as? [String: [String: Any]] {
                let candidates = Set(pages.values.compactMap { ($0["url"] as? String).flatMap { origin($0, source) } })
                if candidates.count == 1 { homes[source] = candidates.first! }
            }
        }
        let graph = object(oldResources.appendingPathComponent("MicrosoftGraphConfig.json"))
        var publicGraph = [String: String]()
        if let id = graph["clientId"] as? String, UUID(uuidString: id) != nil {
            publicGraph["clientId"] = id
            if let tenant = graph["tenant"] as? String, tenant.count <= 253,
               tenant == "organizations" || UUID(uuidString: tenant) != nil || tenant.range(of: "^[A-Za-z0-9][A-Za-z0-9.-]+$", options: .regularExpression) != nil { publicGraph["tenant"] = tenant }
        }
        return ["schoolHomes": homes, "graphConfiguration": publicGraph]
    }

    func validateTarget(_ target: URL) throws -> Int {
        guard target.pathExtension.lowercased() == "app", PatchFiles.exists(target), try !PatchFiles.isLink(target) else { throw PatchError.invalid("请选择已经安装的 CampusDesk 主题版应用。") }
        let info = try PatchFiles.info(target)
        guard info["CFBundleIdentifier"] as? String == manifest.bundleID,
              info["CFBundleExecutable"] as? String == "CampusDesk",
              let version = info["CFBundleShortVersionString"] as? String, let oldParts = Self.versionParts(version), let newParts = Self.versionParts(manifest.version),
              let rawBuild = info["CFBundleVersion"] as? String, let build = Int(rawBuild), build > 0 else { throw PatchError.invalid("所选应用不是兼容的 CampusDesk 旧版。") }
        let comparison = Self.compareVersions(oldParts, newParts)
        guard comparison < 0 || comparison == 0 && build <= manifest.build else { throw PatchError.invalid("已安装版本比补丁更新，已停止降级。") }
        let executable = target.appendingPathComponent("Contents/MacOS/CampusDesk")
        guard PatchFiles.exists(executable), try !PatchFiles.isLink(executable), try PatchFiles.attributes(executable)[.type] as? FileAttributeType == .typeRegular else { throw PatchError.invalid("原应用的主程序缺失，无法完成旧版识别。") }
        // Old official builds include ad-hoc signatures and pre-helper releases.
        // Trust and verify the new payload, while preserving old credential data
        // in place rather than rejecting those users or resetting their profile.
        return build
    }

    func install(target rawTarget: URL, hooks: PatchHooks) throws -> PatchResult {
        guard try !PatchFiles.isLink(rawTarget) else { throw PatchError.invalid("所选应用是符号链接，请选择原应用本身。") }
        let target = rawTarget.deletingLastPathComponent().resolvingSymlinksInPath().appendingPathComponent(rawTarget.lastPathComponent).standardizedFileURL
        hooks.progress("正在校验原应用与补丁…")
        _ = try validateTarget(target)
        guard try PatchFiles.digest(archive) == manifest.archiveSHA256 else { throw PatchError.invalid("补丁文件校验失败，请重新下载。") }
        if try PatchFiles.treeDigest(target) == manifest.appTreeSHA256 {
            return PatchResult(target: target, backup: nil, alreadyCurrent: true)
        }
        let parent = target.deletingLastPathComponent()
        guard manager.isWritableFile(atPath: parent.path) else {
            throw PatchError.invalid("当前用户无权写入原应用目录，请由有权限的用户安装。")
        }
        let lock = try PatchLock(parent: parent)
        defer { withExtendedLifetime(lock) {} }
        _ = try validateTarget(target)
        // The staging directory shares the destination volume, allowing a single
        // atomic exchange. The application path is never temporarily absent.
        let stage = parent.appendingPathComponent(".CampusDesk-Patch-" + UUID().uuidString)
        try manager.createDirectory(at: stage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var keepStage = false
        defer { if !keepStage { try? manager.removeItem(at: stage) } }
        try PatchFiles.command("/usr/bin/ditto", ["-x", "-k", archive.path, stage.path])
        let staged = stage.appendingPathComponent(manifest.appName)
        let children = try manager.contentsOfDirectory(at: stage, includingPropertiesForKeys: nil)
        guard children.count == 1, children.first?.lastPathComponent == manifest.appName,
              try PatchFiles.treeDigest(staged) == manifest.appTreeSHA256 else { throw PatchError.invalid("解包内容校验失败，原应用未替换。") }
        try PatchFiles.checkSignature(staged, certificate: manifest.signingCertificateSHA1)
        let info = try PatchFiles.info(staged)
        guard info["CFBundleIdentifier"] as? String == manifest.bundleID, info["CFBundleVersion"] as? String == String(manifest.build) else { throw PatchError.invalid("补丁版本不匹配。") }

        hooks.progress("正在正常退出 CampusDesk…")
        try hooks.ensureStopped(target)
        _ = try validateTarget(target)
        let oldAppDigest = try PatchFiles.treeDigest(target)
        let helperUnchanged = try credentialHelperUnchanged(at: target)
        let before = try PatchFiles.snapshot(home: home, edition: edition)
        let backups = home.appendingPathComponent("Library/Application Support/" + edition.dataName + " Backups")
        if PatchFiles.exists(backups), try PatchFiles.isLink(backups) { throw PatchError.invalid("备份根目录使用了符号链接，无法保证资料隔离，原应用未替换。") }
        let backupPath = backups.resolvingSymlinksInPath().path
        for relative in edition.protectedPaths {
            let protected = home.appendingPathComponent("Library/" + relative).resolvingSymlinksInPath().path
            guard backupPath != protected, !backupPath.hasPrefix(protected + "/") else { throw PatchError.invalid("备份目录位于原资料内部，已停止更新。") }
        }
        try manager.createDirectory(at: backups, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let backup = backups.appendingPathComponent(stamp + "-Patch-Build" + String(manifest.build) + "-" + UUID().uuidString)
        try manager.createDirectory(at: backup, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        hooks.progress("正在备份原应用、学习数据和登录会话…")
        try PatchFiles.copy(target, backup.appendingPathComponent(manifest.appName))
        guard try PatchFiles.treeDigest(backup.appendingPathComponent(manifest.appName)) == oldAppDigest else { throw PatchError.invalid("原应用备份校验失败，更新已停止。") }
        for relative in edition.protectedPaths where before[relative] != "missing" {
            let destination = backup.appendingPathComponent("Library/" + relative)
            try PatchFiles.copy(home.appendingPathComponent("Library/" + relative), destination)
            guard try PatchFiles.treeDigest(destination) == before[relative] else { throw PatchError.invalid("资料或会话备份未通过校验，原应用未替换。") }
        }
        guard try PatchFiles.snapshot(home: home, edition: edition) == before, try PatchFiles.treeDigest(target) == oldAppDigest else { throw PatchError.invalid("备份期间应用或数据仍在变化，请退出应用后重试。") }
        try hooks.ensureStopped(target)
        guard try PatchFiles.treeDigest(target) == oldAppDigest else { throw PatchError.invalid("原应用在更新前发生变化，已停止替换。") }
        hooks.progress("正在原位更新应用…")
        try PatchFiles.swap(staged, target)
        do {
            try hooks.afterSwap?()
            guard try PatchFiles.treeDigest(target) == manifest.appTreeSHA256 else { throw PatchError.invalid("更新后的应用内容未通过校验。") }
            try PatchFiles.checkSignature(target, certificate: manifest.signingCertificateSHA1)
            guard try PatchFiles.snapshot(home: home, edition: edition) == before else { throw PatchError.invalid("检测到外部进程改变了用户数据，已停止并恢复原应用。") }
            let receipt: [String: Any] = ["formatVersion": 1, "build": manifest.build, "application": target.path,
                "bundleID": edition.rawValue, "version": manifest.version,
                "installedAt": ISO8601DateFormatter().string(from: Date()), "previousApplicationSHA256": oldAppDigest,
                "installedApplicationSHA256": manifest.appTreeSHA256, "dataBefore": before, "dataAfter": before,
                "credentialHelperUnchanged": helperUnchanged, "credentialAccessMayNeedAuthorization": !helperUnchanged,
                "compatibility": try legacyConfiguration(in: backup), "dataUnchanged": true]
            let data = try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: backup.appendingPathComponent("Patch-Receipt.json"), options: .atomic)
        } catch {
            do { try PatchFiles.swap(staged, target); guard try PatchFiles.treeDigest(target) == oldAppDigest else { throw error } }
            catch { keepStage = true; throw PatchError.invalid("更新校验未完成，自动回退也未完成。旧版和资料备份保留在：\(backup.path)。原应用副本保留在：\(staged.path)。") }
            throw PatchError.invalid("更新未通过校验，原应用已恢复，用户资料未被改写。备份位置：\(backup.path)")
        }
        return PatchResult(target: target, backup: backup, alreadyCurrent: false)
    }
}
