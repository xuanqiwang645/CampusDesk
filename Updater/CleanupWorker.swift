import Foundation
import Darwin

@main
enum CleanupWorker {
    static func main() {
        let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
        let directory = executable.deletingLastPathComponent()
        let prefix = "CampusDesk-Patch-Cleanup-"
        guard executable.lastPathComponent == "Cleanup", directory.lastPathComponent.hasPrefix(prefix),
              UUID(uuidString: String(directory.lastPathComponent.dropFirst(prefix.count))) != nil,
              directory.deletingLastPathComponent().resolvingSymlinksInPath() == FileManager.default.temporaryDirectory.resolvingSymlinksInPath(),
              (try? PatchFiles.isLink(directory)) == false,
              let attributes = try? PatchFiles.attributes(directory), (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              let entries = try? FileManager.default.contentsOfDirectory(atPath: directory.path), Set(entries) == ["Cleanup", "Cleanup.json"],
              (try? PatchFiles.isLink(directory.appendingPathComponent("Cleanup.json"))) == false else { return }
        guard let planAttributes = try? PatchFiles.attributes(directory.appendingPathComponent("Cleanup.json")),
              planAttributes[.type] as? FileAttributeType == .typeRegular, (planAttributes[.size] as? NSNumber)?.intValue ?? Int.max <= 16384,
              let bytes = try? Data(contentsOf: directory.appendingPathComponent("Cleanup.json")), bytes.count <= 16384,
              let job = try? JSONDecoder().decode(PatchCleanupJob.self, from: bytes) else { return }
        defer { try? FileManager.default.removeItem(at: directory) }
        let report: [String: Any]
        do { report = try PatchCleanup.perform(job: job, certificate: PatchFiles.certificateSHA1(executable)) }
        catch { report = ["completed": false, "message": error.localizedDescription] }
        PatchCleanup.writeReport(report, backup: job.backup)
    }
}
