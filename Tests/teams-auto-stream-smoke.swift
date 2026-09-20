import Foundation

@main struct TeamsAutoStreamSmoke {
    static func main() throws {
        var checks = 0
        func check(_ success: Bool, _ label: String) {
            guard success else { fputs("FAIL: \(label)\n", stderr); exit(1) }
            checks += 1
        }
        for type in ["snapshot", "progress", "done", "error", "attachment", "attachmentUnchanged"] {
            let data = try JSONSerialization.data(withJSONObject: ["type": type, "accountId": "test-account", "snapshotId": "test-scope"])
            check(TeamsAutoEventDecoder.decode(data)?["type"] as? String == type, "protocol accepts \(type)")
        }
        for text in ["", "[]", "null", "{", "{}", "{\"type\":1}", "{\"type\":\"unknown\"}"] {
            check(TeamsAutoEventDecoder.decode(Data(text.utf8)) == nil, "reject invalid event")
        }
        check(TeamsAutoEventDecoder.decode(Data(repeating: 32, count: TeamsAutoEventDecoder.maximumLine + 1)) == nil, "reject oversized event")
        print("PASS: \(checks) native Teams protocol checks")
    }
}
