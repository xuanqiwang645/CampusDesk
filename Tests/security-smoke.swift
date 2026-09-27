import Foundation

@main
struct SecuritySmokeTests {
    static func main() {
        var passed = 0
        func check(_ condition: Bool, _ label: String) {
            guard condition else { fputs("FAIL: \(label)\n", stderr); exit(1) }
            passed += 1
        }

        check(CampusSecurity.safeHTTPSURL("https://teams.microsoft.com/l/channel/abc") != nil, "Allow a normal Teams HTTPS URL")
        for value in [
            "http://teams.microsoft.com/", "https://user@teams.microsoft.com/",
            "https://teams.microsoft.com:444/", "https://teams.microsoft.com./",
            "https://teams.microsoft.com/\n", "https://teams.microsoft.com\\@evil.invalid/",
            "https://exämple.com/", "https://teams.microsoft.com/?%61ccess_token=secret",
            "https://teams.microsoft.com/#%61ccess_token=secret", "https://teams.microsoft.com/?code_verifier=secret"
        ] { check(CampusSecurity.safeHTTPSURL(value) == nil, "Reject unsafe URL: \(value)") }

        check(CampusSecurity.isSafeHTTPHeaderValue("sk-example_0123456789"), "Allow printable API key header value")
        for value in ["key\r\nInjected: true", "key\u{0000}value", "key with spaces", "密钥abcdefgh"] {
            check(!CampusSecurity.isSafeHTTPHeaderValue(value), "Reject unsafe HTTP header value")
        }

        let state: [String: Any] = [
            "version": 1, "settings": ["aiProvider": "off"],
            "snapshots": ["seiue": [String: Any](), "managebac": [String: Any](), "teams": [String: Any]()],
            "manualTasks": [Any](), "gradeHistory": [Any](), "changeLog": [Any]()
        ]
        check(CampusSecurity.validStateEnvelope(state), "Accept a minimal valid state envelope")
        check(CampusSecurity.validStateEnvelope(["version": 1, "settings": ["aiProvider": "auto"], "snapshots": ["seiue": [String: Any](), "managebac": [String: Any]()], "manualTasks": [Any](), "gradeHistory": [Any](), "changeLog": [Any]()] ), "Keep legacy provider state readable")
        var invalid = state; invalid["version"] = 99
        check(!CampusSecurity.validStateEnvelope(invalid), "Reject unsupported state version")
        invalid = state; invalid["snapshots"] = ["seiue": [String: Any]()]
        check(!CampusSecurity.validStateEnvelope(invalid), "Reject state missing a required source map")
        invalid = state; invalid["settings"] = ["aiProvider": "arbitrary-network-provider"]
        check(!CampusSecurity.validStateEnvelope(invalid), "Reject unknown provider values in disk state")
        invalid = state; invalid["settings"] = ["constructor": ["polluted": true]]
        check(!CampusSecurity.validStateEnvelope(invalid), "Reject prototype-sensitive keys")
        invalid = state; invalid["untrusted"] = String(repeating: "x", count: 1_000_001)
        check(!CampusSecurity.validStateEnvelope(invalid), "Reject oversized individual values")
        invalid = state; invalid["untrusted"] = Array(repeating: "x", count: 10_001)
        check(!CampusSecurity.validStateEnvelope(invalid), "Reject oversized nested arrays")
        var deeplyNested: Any = "leaf"
        for _ in 0..<42 { deeplyNested = ["child": deeplyNested] as [String: Any] }
        invalid = state; invalid["untrusted"] = deeplyNested
        check(!CampusSecurity.validStateEnvelope(invalid), "Reject excessively nested disk or bridge payloads")

        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-security-" + UUID().uuidString, isDirectory: true)
        let resources = temporary.appendingPathComponent("Resources", isDirectory: true)
        try! FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        let index = resources.appendingPathComponent("index.html")
        try! Data("<html></html>".utf8).write(to: index)
        let outside = temporary.appendingPathComponent("outside.html")
        try! Data("<html>outside</html>".utf8).write(to: outside)
        defer { try? FileManager.default.removeItem(at: temporary) }
        check(CampusSecurity.isDashboardResourceURL(index, resources: resources), "Allow the exact bundled dashboard document")
        check(!CampusSecurity.isDashboardResourceURL(outside, resources: resources), "Reject an outside local document")
        check(!CampusSecurity.isDashboardResourceURL(resources.appendingPathComponent("missing.html"), resources: resources), "Reject a missing local document")
        let symlinkResources = temporary.appendingPathComponent("SymlinkResources", isDirectory: true)
        try! FileManager.default.createDirectory(at: symlinkResources, withIntermediateDirectories: true)
        try! FileManager.default.createSymbolicLink(at: symlinkResources.appendingPathComponent("index.html"), withDestinationURL: outside)
        check(!CampusSecurity.isDashboardResourceURL(symlinkResources.appendingPathComponent("index.html"), resources: symlinkResources), "Reject a symlinked dashboard entrypoint")
        check(CampusSecurity.isRegularNonSymlinkFile(index, maximumBytes: 100), "Accept bounded regular state file input")
        check(!CampusSecurity.isRegularNonSymlinkFile(index, maximumBytes: 2), "Reject oversized local data")
        let fileLink = temporary.appendingPathComponent("state-link.json")
        try! FileManager.default.createSymbolicLink(at: fileLink, withDestinationURL: index)
        check(!CampusSecurity.isRegularNonSymlinkFile(fileLink, maximumBytes: 100), "Reject symlinked saved-state paths")

        print("PASS: \(passed) native security checks")
    }
}
