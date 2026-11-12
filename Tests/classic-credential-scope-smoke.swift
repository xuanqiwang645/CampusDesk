import Foundation
import Security

@main
enum ClassicCredentialScopeSmoke {
    static func main() throws {
        let id = Bundle.main.bundleIdentifier!
        let account = "api-key." + UUID().uuidString
        let service = id + ".assistant.deepseek"
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: account, kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        let (status, _) = AssistantCredentialBridge.lookup(query)
        if CommandLine.arguments.contains("--expect-rejection") {
            guard status != errSecSuccess && status != errSecItemNotFound else { throw NSError(domain: "Wrong caller accepted", code: 1) }
        } else {
            guard status == errSecItemNotFound else { throw NSError(domain: "Classic helper namespace unavailable", code: Int(status)) }
            var other = query; other[kSecAttrService as String] = "local.campusdesk.mac.themeedition.assistant.deepseek"
            guard AssistantCredentialBridge.lookup(other).0 == errSecParam else { throw NSError(domain: "Cross-profile service accepted", code: 1) }
        }
        print("PASS: classic credential helper permits its own namespace and rejects cross-edition callers; nonexistent account only")
    }
}
