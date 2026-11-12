import Foundation

@main
enum PatchCleanupSmoke {
    static func main() throws {
        guard CommandLine.arguments.count == 3 else { fatalError("Expected signed updater and installed payload") }
        let updater = URL(fileURLWithPath: CommandLine.arguments[1]), payload = URL(fileURLWithPath: CommandLine.arguments[2])
        let certificate = try PatchFiles.certificateSHA1(updater)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-cleanup-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        var checks = 0
        func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws { guard try condition() else { throw PatchError.invalid("FAIL: " + message) }; checks += 1 }
        func endedPID() throws -> Int32 {
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/true"); try p.run(); let pid = p.processIdentifier; p.waitUntilExit(); return pid
        }
        let payloadBefore = try PatchFiles.treeDigest(payload)
        do {
            _ = try PatchCleanup.perform(job: PatchCleanupJob(updater: payload.path, parentPID: endedPID(), backup: nil), certificate: certificate)
            throw PatchError.invalid("FAIL: installed app selected for cleanup")
        } catch let error as PatchError {
            guard !error.localizedDescription.contains("FAIL:") else { throw error }; checks += 1
        }
        try check(try PatchFiles.treeDigest(payload) == payloadBefore, "installed CampusDesk app cannot be cleaned up")
        let loose = root.appendingPathComponent("Loose/CampusDesk 更新补丁.app")
        try PatchFiles.copy(updater, loose)
        let personal = loose.deletingLastPathComponent().appendingPathComponent("personal-data.txt")
        try Data("unrelated-original-data".utf8).write(to: personal)
        let result = try PatchCleanup.perform(job: PatchCleanupJob(updater: loose.path, parentPID: endedPID(), backup: nil), certificate: certificate)
        try check(!PatchFiles.exists(loose) && result["completed"] as? Bool == true, "writable updater removes itself after successful use")
        try check(try String(contentsOf: personal) == "unrelated-original-data", "cleanup never removes neighboring user files")
        if let path = result["trash"] as? String, !path.isEmpty {
            let trashed = URL(fileURLWithPath: path)
            try check(try PatchFiles.info(trashed)["CFBundleIdentifier"] as? String == PatchCleanup.updaterID, "the updater is recoverable in Trash")
            try FileManager.default.removeItem(at: trashed) // Only this test-created copy.
        }
        for includePersonalFile in [false, true] {
            let volume = root.appendingPathComponent(includePersonalFile ? "mixed-volume" : "patch-volume")
            try FileManager.default.createDirectory(at: volume, withIntermediateDirectories: false)
            try PatchFiles.copy(updater, volume.appendingPathComponent(updater.lastPathComponent))
            try Data("Patch instructions".utf8).write(to: volume.appendingPathComponent("使用说明.txt"))
            if includePersonalFile { try Data("not-a-patch".utf8).write(to: volume.appendingPathComponent("personal.txt")) }
            let image = root.appendingPathComponent(includePersonalFile ? "mixed.dmg" : "patch.dmg")
            try PatchFiles.command("/usr/bin/hdiutil", ["create", "-quiet", "-srcfolder", volume.path, "-format", "UDZO", image.path])
            let mount = root.appendingPathComponent(includePersonalFile ? "mixed-mount" : "patch-mount")
            try FileManager.default.createDirectory(at: mount, withIntermediateDirectories: false)
            try PatchFiles.command("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount.path, image.path])
            let mountedUpdater = mount.appendingPathComponent(updater.lastPathComponent)
            if includePersonalFile {
                do {
                    _ = try PatchCleanup.perform(job: PatchCleanupJob(updater: mountedUpdater.path, parentPID: endedPID(), backup: nil), certificate: certificate)
                    throw PatchError.invalid("FAIL: mixed personal disk image was removed")
                } catch let error as PatchError {
                    guard !error.localizedDescription.contains("FAIL:") else { throw error }; checks += 1
                }
                try check(PatchFiles.exists(image), "a mixed disk image is retained")
                try PatchFiles.command("/usr/bin/hdiutil", ["detach", mount.path])
            } else {
                let cleanup = try PatchCleanup.perform(job: PatchCleanupJob(updater: mountedUpdater.path, parentPID: endedPID(), backup: nil), certificate: certificate)
                try check(cleanup["mode"] as? String == "eject-and-trash-patch-image" && !PatchFiles.exists(image), "read-only updater image ejects and moves to Trash")
                if let path = cleanup["trash"] as? String, !path.isEmpty {
                    try check(PatchFiles.exists(URL(fileURLWithPath: path)), "removed image remains recoverable")
                    try FileManager.default.removeItem(atPath: path) // Only the image generated by this test.
                }
            }
        }
        let jobDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-Patch-Cleanup-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: jobDirectory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: jobDirectory) }
        try FileManager.default.copyItem(at: updater.appendingPathComponent("Contents/Helpers/CampusDeskPatchCleanup"), to: jobDirectory.appendingPathComponent("Cleanup"))
        try JSONEncoder().encode(PatchCleanupJob(updater: payload.path, parentPID: getpid(), backup: nil)).write(to: jobDirectory.appendingPathComponent("Cleanup.json"))
        let extra = jobDirectory.appendingPathComponent("keep-personal-file.txt"); try Data("do-not-delete".utf8).write(to: extra)
        let worker = Process(); worker.executableURL = jobDirectory.appendingPathComponent("Cleanup"); try worker.run(); worker.waitUntilExit()
        try check(try String(contentsOf: extra) == "do-not-delete", "cleanup worker never removes a job directory containing unrelated files")
        try FileManager.default.removeItem(at: extra)
        try Data("not-a-valid-cleanup-job".utf8).write(to: jobDirectory.appendingPathComponent("Cleanup.json"))
        let invalidWorker = Process(); invalidWorker.executableURL = jobDirectory.appendingPathComponent("Cleanup"); try invalidWorker.run(); invalidWorker.waitUntilExit()
        try check(PatchFiles.exists(jobDirectory.appendingPathComponent("Cleanup.json")), "invalid cleanup plans retain their files instead of removing a directory")
        print("PASS: \(checks) updater cleanup checks; app, image, recovery and unrelated-data isolation")
    }
}
