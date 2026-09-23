import Foundation

@main
struct SchoolConfigurationSmoke {
    static func main() {
        var passed = 0
        func check(_ value: Bool, _ message: String) {
            guard value else { fputs("FAIL: \(message)\n", stderr); exit(1) }
            passed += 1
        }
        check(CampusSchoolConfiguration().frontend == ["seiue": "", "managebac": ""], "Empty defaults")
        check(CampusSchoolConfiguration.load(resources: nil).homes.isEmpty, "Missing resource fails closed")
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-school-config-" + UUID().uuidString, isDirectory: true)
        try! FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let resources = temporary.appendingPathComponent("Resources", isDirectory: true)
        try! FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        try! Data("{\"seiue\":\"https://public-school.seiue.com/\",\"managebac\":\"\"}".utf8).write(to: resources.appendingPathComponent("SchoolConfig.json"))
        let local = temporary.appendingPathComponent("SchoolConfig.json")
        try! Data("{\"seiue\":\"https://private-school.seiue.com/\",\"managebac\":\"https://private-school.managebac.cn/\"}".utf8).write(to: local)
        check(CampusSchoolConfiguration.load(resources: resources, userConfig: local).frontend == [
            "seiue": "https://private-school.seiue.com/", "managebac": "https://private-school.managebac.cn/"
        ], "Private config overrides bundled defaults")
        check(CampusSchoolConfiguration.validatedHome("HTTPS://EXAMPLE-SCHOOL.SEIUE.COM:443/", source: "seiue") == "https://example-school.seiue.com/", "Normalized HTTPS default port")
        for suffix in ["managebac.com", "managebac.cn"] {
            check(CampusSchoolConfiguration.validatedHome("https://example-school." + suffix, source: "managebac") == "https://example-school." + suffix + "/", "ManageBac provider suffix")
        }
        let invalid = ["", "http://example-school.seiue.com/", "https://example-school.seiue.com:8443/", "https://user:password@example-school.seiue.com/",
                       "https://example-school.seiue.com/?token=secret", "https://example-school.seiue.com/?", "https://example-school.seiue.com/#",
                       "https://example-school.seiue.com/calendar", "https://example-school.seiue.com//", "https://evilseiue.com/", "https://seiue.com.evil.invalid/",
                       "https://.seiue.com/", "https://example..seiue.com/", "https://-example.seiue.com/", "https://example-.seiue.com/",
                       "https://example-school.seiue.com./", " https://example-school.seiue.com/", "https://%65xample-school.seiue.com/", "https://example-school.seiue.com/\n"]
        for value in invalid { check(CampusSchoolConfiguration.validatedHome(value, source: "seiue") == nil, "Reject invalid configuration") }
        check(CampusSchoolConfiguration.validatedHome("https://example-school.managebac.cn/", source: "seiue") == nil, "Wrong provider rejected")
        check(CampusSchoolConfiguration(["seiue": 123, "teams": "https://evil.invalid/"]).homes.isEmpty, "Wrong types and unknown keys ignored")
        let entered = ["seiue": " new-school.seiue.com ", "managebac": "https://new-school.managebac.com/"]
        let saved = try! CampusSchoolConfiguration.save(entered, to: local)
        check(saved.homes["seiue"] == "https://new-school.seiue.com/", "Normalize bare entered school domain")
        check(CampusSchoolConfiguration.load(resources: resources, userConfig: local).frontend == saved.frontend, "Saved settings survive a new launch and override bundled settings")
        let permissions = (try! FileManager.default.attributesOfItem(atPath: local.path))[.posixPermissions] as? NSNumber
        check(permissions?.intValue == 0o600, "Saved config is private")
        do {
            _ = try CampusSchoolConfiguration.save(["seiue": "https://seiue.com.evil.invalid/", "managebac": ""], to: local)
            check(false, "Reject invalid host on save")
        } catch { check(CampusSchoolConfiguration.load(resources: resources, userConfig: local).frontend == saved.frontend, "Failed save keeps previous config") }
        do {
            _ = try CampusSchoolConfiguration.save(entered, to: resources)
            check(false, "A disk failure must not return success")
        } catch { check(true, "Disk error is propagated to UI") }
        let cleared = try! CampusSchoolConfiguration.save(["seiue": "", "managebac": entered["managebac"]!], to: local)
        check(cleared.homes["seiue"] == nil && cleared.homes["managebac"] != nil, "Unused provider can be cleared independently")
        print("PASS: \(passed) native school-configuration checks")
    }
}
