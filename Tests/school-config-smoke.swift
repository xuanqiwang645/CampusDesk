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
        print("PASS: \(passed) native school-configuration checks")
    }
}
