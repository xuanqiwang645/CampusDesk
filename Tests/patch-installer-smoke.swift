import Foundation
import Darwin

enum InjectedFailure: Error { case afterSwap, quitCancelled }
@main
enum PatchInstallerSmoke {
    static func main() throws {
        guard CommandLine.arguments.count >= 3 else { fatalError("Expected updater resources and payload app") }
        let resources = URL(fileURLWithPath: CommandLine.arguments[1]), payload = URL(fileURLWithPath: CommandLine.arguments[2])
        let manifest = try JSONDecoder().decode(PatchManifest.self, from: Data(contentsOf: resources.appendingPathComponent("PatchManifest.json")))
        let archive = resources.appendingPathComponent("Payload.zip")
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-patch-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        var checks = 0
        func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
            guard try condition() else { throw PatchError.invalid("FAIL: " + message) }; checks += 1
        }
        let old: URL
        if CommandLine.arguments.count == 4 { old = URL(fileURLWithPath: CommandLine.arguments[3]) }
        else {
            old = root.appendingPathComponent("legacy/" + PatchFiles.appName)
            try PatchFiles.copy(payload, old)
            let file = old.appendingPathComponent("Contents/Info.plist")
            var info = try PatchFiles.info(old); info["CFBundleVersion"] = String(manifest.build - 1)
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: file)
            try PatchFiles.command("/usr/bin/codesign", ["--force", "--timestamp=none", "--sign", manifest.signingCertificateSHA1, old.path])
        }
        try check(try PatchFiles.digest(old.appendingPathComponent(PatchFiles.helperPath)) == manifest.credentialHelperSHA256, "legacy credential helper remains byte-identical")
        let oldDigest = try PatchFiles.treeDigest(old)
        func fixture(_ name: String) throws -> (URL, URL, PatchEngine) {
            let home = root.appendingPathComponent(name + " '中文' $(not-a-shell)")
            let target = home.appendingPathComponent("Applications/" + PatchFiles.appName)
            try PatchFiles.copy(old, target)
            for (index, relative) in PatchFiles.protectedPaths.enumerated() {
                let fileRoot = relative.hasSuffix(".plist") || relative.hasSuffix(".binarycookies")
                let destination = home.appendingPathComponent("Library/" + relative + (fileRoot ? "" : "/nested/session-and-data.bin"))
                try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                try Data(("synthetic-session-\(index)\0homework-finished\0settings\0").utf8).write(to: destination)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
            }
            let outside = home.appendingPathComponent("Library/Keychains/fixture.keychain-db")
            try FileManager.default.createDirectory(at: outside.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data("synthetic-keychain-do-not-touch".utf8).write(to: outside)
            return (home, target, try PatchEngine(manifest: manifest, archive: archive, home: home))
        }
        func expectFailure(_ message: String, _ body: () throws -> Void) throws {
            do { try body() } catch { checks += 1; return }; throw PatchError.invalid("FAIL: expected refusal: " + message)
        }
        let quiet = PatchHooks(ensureStopped: { _ in })

        let (home, target, engine) = try fixture("upgrade")
        let before = try PatchFiles.snapshot(home: home)
        let keychain = home.appendingPathComponent("Library/Keychains/fixture.keychain-db"), keychainBefore = try PatchFiles.digest(keychain)
        let result = try engine.install(target: target, hooks: quiet)
        try check(!result.alreadyCurrent && result.backup != nil, "real transaction creates a complete backup")
        try check(try PatchFiles.treeDigest(target) == manifest.appTreeSHA256, "installed app matches release tree including permissions")
        try check(try PatchFiles.snapshot(home: home) == before, "all protected data and session contents remain identical")
        try check(try PatchFiles.digest(keychain) == keychainBefore, "keychain file remains untouched")
        try check(try PatchFiles.treeDigest(result.backup!.appendingPathComponent(PatchFiles.appName)) == oldDigest, "backup contains the original app")
        for relative in PatchFiles.protectedPaths {
            try check(try PatchFiles.treeDigest(result.backup!.appendingPathComponent("Library/" + relative)) == before[relative], "verified backup for " + relative)
        }
        let receipt = try JSONSerialization.jsonObject(with: Data(contentsOf: result.backup!.appendingPathComponent("Patch-Receipt.json"))) as! [String: Any]
        try check(receipt["dataUnchanged"] as? Bool == true && receipt["credentialHelperUnchanged"] as? Bool == true, "receipt records byte-preserving transaction")
        let repeatInstall = try engine.install(target: target, hooks: PatchHooks(ensureStopped: { _ in throw InjectedFailure.quitCancelled }))
        try check(repeatInstall.alreadyCurrent && repeatInstall.backup == nil, "same release is a no-op without quitting or creating new backups")

        let (rollbackHome, rollbackTarget, rollbackEngine) = try fixture("rollback")
        let rollbackData = try PatchFiles.snapshot(home: rollbackHome)
        try expectFailure("post-swap failure") {
            _ = try rollbackEngine.install(target: rollbackTarget, hooks: PatchHooks(ensureStopped: { _ in }, afterSwap: { throw InjectedFailure.afterSwap }))
        }
        try check(try PatchFiles.treeDigest(rollbackTarget) == oldDigest, "failed verification rolls the app back atomically")
        try check(try PatchFiles.snapshot(home: rollbackHome) == rollbackData, "rollback does not restore or alter user data")

        let (quitHome, quitTarget, quitEngine) = try fixture("cancel-quit")
        let quitData = try PatchFiles.snapshot(home: quitHome)
        try expectFailure("app refused normal quit") { _ = try quitEngine.install(target: quitTarget, hooks: PatchHooks(ensureStopped: { _ in throw InjectedFailure.quitCancelled })) }
        try check(try PatchFiles.treeDigest(quitTarget) == oldDigest && PatchFiles.snapshot(home: quitHome) == quitData, "cancelled quit leaves app and data untouched")

        let (wrongHome, wrongTarget, wrongEngine) = try fixture("wrong-edition")
        var wrongInfo = try PatchFiles.info(wrongTarget); wrongInfo["CFBundleIdentifier"] = "local.campusdesk.mac"
        try PropertyListSerialization.data(fromPropertyList: wrongInfo, format: .xml, options: 0).write(to: wrongTarget.appendingPathComponent("Contents/Info.plist"))
        let wrongBefore = try PatchFiles.snapshot(home: wrongHome), wrongAppBefore = try PatchFiles.treeDigest(wrongTarget)
        try expectFailure("wrong edition") { _ = try wrongEngine.install(target: wrongTarget, hooks: quiet) }
        try check(try PatchFiles.treeDigest(wrongTarget) == wrongAppBefore && PatchFiles.snapshot(home: wrongHome) == wrongBefore, "wrong edition is never replaced")

        let (newerHome, newerTarget, newerEngine) = try fixture("no-downgrade")
        var newerInfo = try PatchFiles.info(newerTarget); newerInfo["CFBundleVersion"] = String(manifest.build + 1); newerInfo["CFBundleShortVersionString"] = manifest.version
        try PropertyListSerialization.data(fromPropertyList: newerInfo, format: .xml, options: 0).write(to: newerTarget.appendingPathComponent("Contents/Info.plist"))
        try expectFailure("newer build") { _ = try newerEngine.install(target: newerTarget, hooks: quiet) }
        try check(try PatchFiles.info(newerTarget)["CFBundleVersion"] as? String == String(manifest.build + 1), "newer build is not downgraded")
        try check(try PatchFiles.snapshot(home: newerHome).values.allSatisfy { $0 != "missing" }, "downgrade refusal retains every protected data store")

        let (helperHome, helperTarget, helperEngine) = try fixture("incompatible-helper")
        let helper = helperTarget.appendingPathComponent(PatchFiles.helperPath)
        try FileManager.default.removeItem(at: helper)
        try FileManager.default.copyItem(at: URL(fileURLWithPath: "/usr/bin/true"), to: helper)
        try PatchFiles.command("/usr/bin/codesign", ["--force", "--timestamp=none", "--identifier", "local.campusdesk.mac.credentials", "--sign", manifest.signingCertificateSHA1, helper.path])
        try PatchFiles.command("/usr/bin/codesign", ["--force", "--timestamp=none", "--sign", manifest.signingCertificateSHA1, helperTarget.path])
        let helperBefore = try PatchFiles.treeDigest(helperTarget), helperData = try PatchFiles.snapshot(home: helperHome)
        let legacyHelperResult = try helperEngine.install(target: helperTarget, hooks: quiet)
        try check(try PatchFiles.treeDigest(helperTarget) == manifest.appTreeSHA256 && PatchFiles.snapshot(home: helperHome) == helperData, "legacy helpers can upgrade without altering credentials or data")
        try check(try PatchFiles.treeDigest(legacyHelperResult.backup!.appendingPathComponent(PatchFiles.appName)) == helperBefore, "legacy signed helper and original app remain in the backup")
        let legacyReceipt = try JSONSerialization.jsonObject(with: Data(contentsOf: legacyHelperResult.backup!.appendingPathComponent("Patch-Receipt.json"))) as! [String: Any]
        try check(legacyReceipt["credentialAccessMayNeedAuthorization"] as? Bool == true, "legacy authorization is reported without clearing existing credentials")

        let (corruptHome, corruptTarget, _) = try fixture("corrupt-payload")
        let corruptArchive = root.appendingPathComponent("corrupt.zip"); try Data("corrupt".utf8).write(to: corruptArchive)
        let corruptEngine = try PatchEngine(manifest: manifest, archive: corruptArchive, home: corruptHome)
        let corruptData = try PatchFiles.snapshot(home: corruptHome)
        try expectFailure("damaged download") { _ = try corruptEngine.install(target: corruptTarget, hooks: quiet) }
        try check(try PatchFiles.treeDigest(corruptTarget) == oldDigest && PatchFiles.snapshot(home: corruptHome) == corruptData, "damaged archive cannot change application or data")

        let link = root.appendingPathComponent("alias.app"); try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        try expectFailure("symlink target") { _ = try engine.install(target: link, hooks: quiet) }

        let (lockHome, lockTarget, lockEngine) = try fixture("concurrent")
        let descriptor = open(lockTarget.deletingLastPathComponent().appendingPathComponent(".CampusDesk-Patch.lock").path, O_CREAT | O_RDWR, 0o600)
        guard descriptor >= 0 && flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { fatalError("cannot make lock fixture") }
        try expectFailure("another updater owns lock") { _ = try lockEngine.install(target: lockTarget, hooks: quiet) }
        flock(descriptor, LOCK_UN); close(descriptor)
        try check(try PatchFiles.treeDigest(lockTarget) == oldDigest && PatchFiles.snapshot(home: lockHome).values.allSatisfy { $0 != "missing" }, "concurrent updater preserves current application and data")

        let (missingHome, missingTarget, missingEngine) = try fixture("missing-optional-stores")
        for relative in PatchFiles.protectedPaths.dropFirst() { try FileManager.default.removeItem(at: missingHome.appendingPathComponent("Library/" + relative)) }
        let missingBefore = try PatchFiles.snapshot(home: missingHome)
        _ = try missingEngine.install(target: missingTarget, hooks: quiet)
        try check(try PatchFiles.snapshot(home: missingHome) == missingBefore, "missing optional data stores stay missing instead of being initialized")

        let (deniedHome, deniedTarget, deniedEngine) = try fixture("unreadable-stores")
        let deniedBefore = try PatchFiles.snapshot(home: deniedHome), deniedParent = deniedHome.appendingPathComponent("Library/HTTPStorages")
        let deniedMode = try PatchFiles.attributes(deniedParent)[.posixPermissions] as! NSNumber
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: deniedParent.path)
        try expectFailure("inaccessible data cannot be silently treated as missing") { _ = try deniedEngine.install(target: deniedTarget, hooks: quiet) }
        try FileManager.default.setAttributes([.posixPermissions: deniedMode], ofItemAtPath: deniedParent.path)
        try check(try PatchFiles.treeDigest(deniedTarget) == oldDigest && PatchFiles.snapshot(home: deniedHome) == deniedBefore, "unreadable-store refusal leaves app and contents intact")

        let (symlinkHome, symlinkTarget, symlinkEngine) = try fixture("symlink-store")
        let sessionRoot = symlinkHome.appendingPathComponent("Library/WebKit/" + PatchFiles.bundleID)
        let movedSession = symlinkHome.appendingPathComponent("external-sessions")
        try FileManager.default.moveItem(at: sessionRoot, to: movedSession)
        try FileManager.default.createSymbolicLink(at: sessionRoot, withDestinationURL: movedSession)
        let sessionBefore = try PatchFiles.treeDigest(movedSession)
        try expectFailure("symlink data store needs manual review") { _ = try symlinkEngine.install(target: symlinkTarget, hooks: quiet) }
        try check(try PatchFiles.treeDigest(symlinkTarget) == oldDigest && PatchFiles.treeDigest(movedSession) == sessionBefore && PatchFiles.isLink(sessionRoot), "symlink refusal does not touch its session target")

        let (externalHome, externalTarget, externalEngine) = try fixture("external-writer")
        let changedFile = externalHome.appendingPathComponent("Library/Application Support/" + PatchFiles.dataName + "/nested/session-and-data.bin")
        let sentinel = Data("new-user-change-must-not-be-overwritten".utf8); var quitCount = 0
        try expectFailure("external writer during transaction") {
            _ = try externalEngine.install(target: externalTarget, hooks: PatchHooks(ensureStopped: { _ in quitCount += 1; if quitCount == 2 { try sentinel.write(to: changedFile) } }))
        }
        try check(try PatchFiles.treeDigest(externalTarget) == oldDigest, "external write triggers app rollback")
        try check(try Data(contentsOf: changedFile) == sentinel, "rollback never overwrites a newer external data change with a backup")
        print("PASS: \(checks) patch transaction checks; data/session bytes, permissions, keychain isolation, rollback, concurrent install and idempotence")
    }
}
