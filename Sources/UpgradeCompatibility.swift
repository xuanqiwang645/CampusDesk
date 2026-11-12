import Foundation

/// Read-only access to non-secret connection hints captured in a verified patch
/// receipt. User profile files and Keychain services retain their original IDs.
struct CampusUpgradeCompatibility {
    var schoolHomes = [String: String]()
    var graphConfiguration = [String: String]()
    static func load(home: URL, bundleID: String, build: Int, application: URL) -> CampusUpgradeCompatibility {
        guard ["local.campusdesk.mac", "local.campusdesk.mac.themeedition"].contains(bundleID) else { return Self() }
        let dataName = bundleID == "local.campusdesk.mac" ? "CampusDesk" : "CampusDesk-local-campusdesk-mac-themeedition"
        let root = home.appendingPathComponent("Library/Application Support/" + dataName + " Backups")
        let directories = ((try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.contains("-Patch-Build" + String(build) + "-") }.sorted { $0.lastPathComponent > $1.lastPathComponent }
        for directory in directories.prefix(100) {
            let file = directory.appendingPathComponent("Patch-Receipt.json")
            guard let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 65536,
                  let bytes = try? Data(contentsOf: file), let receipt = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  receipt["bundleID"] as? String == bundleID, receipt["build"] as? Int == build, receipt["dataUnchanged"] as? Bool == true,
                  receipt["application"] as? String == application.resolvingSymlinksInPath().standardizedFileURL.path,
                  let compatibility = receipt["compatibility"] as? [String: Any] else { continue }
            var result = Self()
            if let homes = compatibility["schoolHomes"] as? [String: String] {
                result.schoolHomes = homes.filter { key, value in ["seiue", "managebac"].contains(key) && value.count <= 2048 }
            }
            if let graph = compatibility["graphConfiguration"] as? [String: String] {
                result.graphConfiguration = graph.filter { ["clientId", "tenant"].contains($0.key) && $0.value.count <= 253 }
            }
            return result
        }
        return Self()
    }
}
