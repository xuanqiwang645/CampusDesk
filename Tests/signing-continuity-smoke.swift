import Foundation
import Security

// Opt-in integration fixture: only this test service and a supplied UUID are
// accessed. No CampusDesk credentials, API keys, or network calls are involved.
@main
struct SigningContinuitySmoke {
    static func main() {
        guard CommandLine.arguments.count == 3,
              UUID(uuidString: CommandLine.arguments[2]) != nil else { exit(2) }
        let operation = CommandLine.arguments[1], account = CommandLine.arguments[2]
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AssistantCredentialIdentity.service,
            kSecAttrAccount as String: "api-key." + account]
        let sample = Data("synthetic-signing-continuity-fixture".utf8)
        let status: OSStatus
        switch operation {
        case "create":
            var item = query
            item[kSecValueData as String] = sample
            item[kSecAttrLabel as String] = "CampusDesk temporary signing test"
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = AssistantCredentialBridge.add(item)
        case "read":
            var lookup = query
            lookup[kSecReturnData as String] = true
            lookup[kSecMatchLimit as String] = kSecMatchLimitOne
            let lookupResult = AssistantCredentialBridge.lookup(lookup)
            status = lookupResult.0
            let result = lookupResult.1
            if status == errSecSuccess && result as? Data != sample { exit(3) }
        case "delete":
            let deletion = AssistantCredentialBridge.remove(query)
            status = deletion == errSecItemNotFound ? errSecSuccess : deletion
        default: exit(2)
        }
        guard status == errSecSuccess else {
            fputs("FAIL: synthetic Keychain \(operation), status \(status)\n", stderr); exit(1)
        }
        #if FIRST_BUILD
        print("PASS: original signed build \(operation)")
        #else
        print("PASS: updated signed build \(operation)")
        #endif
    }
}
