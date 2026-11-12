import Foundation

@main
enum UpgradeCompatibilitySmoke {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else { fatalError("Expected signed updater resources") }
        let resources = URL(fileURLWithPath: CommandLine.arguments[1])
        let catalog = try JSONDecoder().decode(PatchCatalog.self, from: Data(contentsOf: resources.appendingPathComponent("PatchCatalog.json")))
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-legacy-upgrade-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        var checks = 0
        func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
            guard try condition() else { throw PatchError.invalid("FAIL: " + message) }; checks += 1
        }
        var cases: [(PatchEdition, String, Int)] = [("0.4.1",7),("0.4.2",8),("0.4.4",10),("0.5.4",20),("0.5.5",21),("0.5.6",22),("0.5.8",27),("0.5.13",40)].map { (.classic,$0.0,$0.1) }
        cases += (54...100).map { (.theme, $0 == 54 ? "1.0.0" : $0 < 78 ? "1.1.0" : "1.2.0", $0) }
        let clientID = "11111111-1111-4111-8111-111111111111"
        for (index, item) in cases.enumerated() {
            let (edition, version, build) = item
            let home = root.appendingPathComponent("case-" + String(index)), target = home.appendingPathComponent("Applications/" + edition.appName)
            let contents = target.appendingPathComponent("Contents")
            try FileManager.default.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: URL(fileURLWithPath: "/usr/bin/true"), to: contents.appendingPathComponent("MacOS/CampusDesk"))
            let info: [String: Any] = ["CFBundleIdentifier": edition.rawValue, "CFBundleName": "CampusDesk", "CFBundleExecutable": "CampusDesk", "CFBundlePackageType": "APPL", "CFBundleShortVersionString": version, "CFBundleVersion": String(build)]
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
            try FileManager.default.createDirectory(at: contents.appendingPathComponent("Resources"), withIntermediateDirectories: true)
            let homes = ["seiue": "https://unit-school.seiue.com/", "managebac": "https://unit-school.managebac.cn/"]
            try JSONSerialization.data(withJSONObject: homes).write(to: contents.appendingPathComponent("Resources/SchoolConfig.json"))
            try JSONSerialization.data(withJSONObject: ["clientId": clientID, "tenant": "organizations", "client_secret": "must-never-be-copied"]).write(to: contents.appendingPathComponent("Resources/MicrosoftGraphConfig.json"))
            let profile = home.appendingPathComponent("Library/Application Support/" + edition.dataName)
            try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)
            let state: [String: Any] = ["version": 1, "settings": ["selfStudy": true, "refreshMinutes": 15], "snapshots": ["seiue": [:], "managebac": [:], "teams": [:]], "manualTasks": [["id": "legacy-task", "title": "Existing homework", "status": "open"]], "taskChecks": ["legacy-task": true]]
            try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]).write(to: profile.appendingPathComponent("state.json"))
            try Data("synthetic-refresh-credential-pointer".utf8).write(to: profile.appendingPathComponent("Graph-account.json"))
            let webkit = home.appendingPathComponent("Library/WebKit/" + edition.rawValue)
            try FileManager.default.createDirectory(at: webkit, withIntermediateDirectories: true)
            try Data("existing-logged-in-cookie-and-local-storage".utf8).write(to: webkit.appendingPathComponent("session.bin"))
            let preferences = home.appendingPathComponent("Library/Preferences")
            try FileManager.default.createDirectory(at: preferences, withIntermediateDirectories: true)
            // No historical FreshSetup marker: this is the profile previously
            // endangered by the destructive first-run migration.
            try PropertyListSerialization.data(fromPropertyList: ["assistant.deepseek.activeAccount": "old-account", "taskReviewEnabled": true], format: .binary, options: 0).write(to: preferences.appendingPathComponent(edition.rawValue + ".plist"))
            let other = home.appendingPathComponent("Library/Application Support/" + (edition == .theme ? PatchEdition.classic.dataName : PatchEdition.theme.dataName))
            try FileManager.default.createDirectory(at: other, withIntermediateDirectories: true)
            try Data("other-edition-must-remain-unchanged".utf8).write(to: other.appendingPathComponent("untouched.bin"))
            let before = try PatchFiles.snapshot(home: home, edition: edition), otherBefore = try PatchFiles.treeDigest(other)
            let manifest = catalog.variants.first { $0.bundleID == edition.rawValue }!
            let engine = try PatchEngine(manifest: manifest, archive: resources.appendingPathComponent(edition.archiveName), home: home)
            let result = try engine.install(target: target, hooks: PatchHooks(ensureStopped: { _ in }))
            try check(try PatchFiles.info(target)["CFBundleIdentifier"] as? String == edition.rawValue, "legacy app identity is retained")
            try check(try PatchFiles.info(target)["CFBundleShortVersionString"] as? String == "2.0.0", "legacy app reaches Tarantula")
            try check(try PatchFiles.snapshot(home: home, edition: edition) == before, "all original profile and login files remain identical")
            try check(try PatchFiles.treeDigest(other) == otherBefore, "other edition's profile is not touched")
            let compatibility = CampusUpgradeCompatibility.load(home: home, bundleID: edition.rawValue, build: manifest.build, application: target)
            try check(compatibility.schoolHomes == homes, "legacy embedded school origins remain available read-only")
            try check(compatibility.graphConfiguration["clientId"] == clientID, "legacy public OAuth client ID is retained")
            let receipt = try Data(contentsOf: result.backup!.appendingPathComponent("Patch-Receipt.json"))
            try check(!String(decoding: receipt, as: UTF8.self).contains("must-never-be-copied"), "no client secret enters compatibility metadata")
            try check(CampusSchoolConfiguration.load(resources: target.appendingPathComponent("Contents/Resources"), compatibility: compatibility.schoolHomes).homes == homes, "public empty defaults do not erase old school entry points")
            if index == 0 {
                let local = profile.appendingPathComponent("SchoolConfig.json")
                try JSONSerialization.data(withJSONObject: ["seiue": "", "managebac": "https://different-school.managebac.cn/"]).write(to: local)
                let configured = CampusSchoolConfiguration.load(resources: target.appendingPathComponent("Contents/Resources"), userConfig: local, compatibility: homes)
                try check(configured.homes["seiue"] == nil && configured.homes["managebac"] == "https://different-school.managebac.cn/", "explicit local disable and override win over legacy hints")
            }
            try FileManager.default.removeItem(at: home)
            if (index + 1) % 10 == 0 { print("Legacy upgrade matrix: \(index + 1)/\(cases.count)") }
        }
        print("PASS: \(cases.count) legacy versions / \(checks) identity, login, data and configuration preservation checks")
    }
}
