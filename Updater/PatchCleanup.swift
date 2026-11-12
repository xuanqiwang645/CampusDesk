import Foundation
import Darwin

struct PatchCleanupJob: Codable {
    let updater: String
    let parentPID: Int32
    let backup: String?
}

enum PatchCleanup {
    static let updaterID = "local.campusdesk.patch"
    static func launch(updater: URL, backup: URL?) throws {
        guard try PatchFiles.info(updater)["CFBundleIdentifier"] as? String == updaterID else { throw PatchError.invalid("更新器身份校验失败，未清理文件。") }
        let source = updater.appendingPathComponent("Contents/Helpers/CampusDeskPatchCleanup")
        let certificate = try PatchFiles.certificateSHA1(updater)
        try PatchFiles.checkSignature(source, certificate: certificate)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-Patch-Cleanup-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let executable = directory.appendingPathComponent("Cleanup")
        try FileManager.default.copyItem(at: source, to: executable)
        try PatchFiles.checkSignature(executable, certificate: certificate)
        let sourceUpdater = try originalSource(for: updater, certificate: certificate)
        let plan = PatchCleanupJob(updater: sourceUpdater.path, parentPID: getpid(), backup: backup?.path)
        try JSONEncoder().encode(plan).write(to: directory.appendingPathComponent("Cleanup.json"), options: .atomic)
        let process = Process(); process.executableURL = executable
        process.environment = ["PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"]
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        try process.run()
    }

    private static func originalSource(for updater: URL, certificate: String) throws -> URL {
        guard updater.path.contains("/AppTranslocation/") else { return updater }
        // Gatekeeper may execute a read-only translocated copy. Recover a unique
        // matching original via mounted updater-only images or the normal user
        // download locations; never guess between multiple different copies.
        let expected = try PatchFiles.treeDigest(updater)
        let home = FileManager.default.homeDirectoryForCurrentUser
        var candidates = ["Downloads", "Desktop", "Applications"].map { home.appendingPathComponent($0 + "/" + updater.lastPathComponent) }
        if let data = try? PatchFiles.command("/usr/bin/hdiutil", ["info", "-plist"]),
           let object = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
           let images = object["images"] as? [[String: Any]] {
            for image in images { for entity in image["system-entities"] as? [[String: Any]] ?? [] {
                if let mount = entity["mount-point"] as? String { candidates.append(URL(fileURLWithPath: mount).appendingPathComponent(updater.lastPathComponent)) }
            } }
        }
        let matches = Set(candidates.filter { candidate in
            guard PatchFiles.exists(candidate), (try? PatchFiles.isLink(candidate)) == false,
                  (try? PatchFiles.info(candidate)["CFBundleIdentifier"] as? String) == updaterID,
                  (try? PatchFiles.treeDigest(candidate)) == expected else { return false }
            return (try? PatchFiles.checkSignature(candidate, certificate: certificate)) != nil
        })
        return matches.count == 1 ? matches.first! : updater
    }

    struct ImageSource {
        let mount: URL
        let image: URL
    }
    static func imageSource(for updater: URL) throws -> ImageSource? {
        let data = try PatchFiles.command("/usr/bin/hdiutil", ["info", "-plist"])
        guard let object = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              let images = object["images"] as? [[String: Any]] else { return nil }
        let parent = updater.deletingLastPathComponent().standardizedFileURL
        for image in images {
            guard let path = image["image-path"] as? String,
                  let entities = image["system-entities"] as? [[String: Any]],
                  entities.contains(where: { ($0["mount-point"] as? String).map { URL(fileURLWithPath: $0).standardizedFileURL == parent } == true }) else { continue }
            let source = URL(fileURLWithPath: path)
            guard source.pathExtension.lowercased() == "dmg", try !PatchFiles.isLink(source) else { return nil }
            let allowed = Set([updater.lastPathComponent, "使用说明.txt", ".DS_Store", ".fseventsd", ".Trashes", ".Spotlight-V100"])
            let children = try FileManager.default.contentsOfDirectory(atPath: parent.path)
            guard Set(children).isSubset(of: allowed) else { return nil }
            return ImageSource(mount: parent, image: source)
        }
        return nil
    }

    /// Only this signed updater, or its updater-only disk image, can be trashed.
    /// Neither an installed CampusDesk app nor a backup is an eligible target.
    static func perform(job: PatchCleanupJob, certificate: String) throws -> [String: Any] {
        let updater = URL(fileURLWithPath: job.updater).standardizedFileURL
        guard updater.pathExtension == "app", try !PatchFiles.isLink(updater),
              try PatchFiles.info(updater)["CFBundleIdentifier"] as? String == updaterID else { throw PatchError.invalid("清理目标不是更新器，未删除任何文件。") }
        try PatchFiles.checkSignature(updater, certificate: certificate)
        let original = try PatchFiles.treeDigest(updater)
        let image = try imageSource(for: updater)
        let imageDigest = try image.map { try PatchFiles.digest($0.image) }
        guard job.parentPID > 1, job.parentPID != getpid() else { throw PatchError.invalid("清理进程参数无效。") }
        let deadline = Date().addingTimeInterval(30)
        while kill(job.parentPID, 0) == 0 && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        guard kill(job.parentPID, 0) != 0 else { throw PatchError.invalid("更新器尚未退出，文件已保留。") }
        guard try PatchFiles.treeDigest(updater) == original else { throw PatchError.invalid("补丁文件已变化，未自动清理。") }
        var trashed: NSURL?
        if let image {
            var detached = false
            for _ in 0..<10 {
                do { try PatchFiles.command("/usr/bin/hdiutil", ["detach", image.mount.path]); detached = true; break }
                catch { Thread.sleep(forTimeInterval: 0.5) }
            }
            guard detached else { throw PatchError.invalid("补丁镜像仍被使用，未强制卸载或删除。") }
            guard try PatchFiles.digest(image.image) == imageDigest else { throw PatchError.invalid("下载文件已变化，未自动清理。") }
            try FileManager.default.trashItem(at: image.image, resultingItemURL: &trashed)
            return ["completed": true, "mode": "eject-and-trash-patch-image", "trash": trashed?.path ?? ""]
        }
        let writable = FileManager.default.isWritableFile(atPath: updater.deletingLastPathComponent().path)
        guard writable else { throw PatchError.invalid("更新器位于只读位置，升级成功但清理文件保留。") }
        try FileManager.default.trashItem(at: updater, resultingItemURL: &trashed)
        return ["completed": true, "mode": "trash-updater-app", "trash": trashed?.path ?? ""]
    }

    static func writeReport(_ report: [String: Any], backup: String?) {
        guard let backup else { return }
        let directory = URL(fileURLWithPath: backup).standardizedFileURL
        let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        let allowed = PatchEdition.allCases.map { support.appendingPathComponent($0.dataName + " Backups").standardizedFileURL }
        guard allowed.contains(directory.deletingLastPathComponent()), directory.lastPathComponent.contains("-Patch-Build"),
              (try? PatchFiles.isLink(directory)) == false,
              let bytes = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? bytes.write(to: directory.appendingPathComponent("Cleanup-Result.json"), options: .atomic)
    }
}
