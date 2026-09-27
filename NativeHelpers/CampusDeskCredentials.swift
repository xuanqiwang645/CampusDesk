import Foundation
import Security

@main
struct CampusDeskCredentials {
    static func main() {
        let parent = getppid()
        // Refuse shells, other apps, altered binaries and copies outside the
        // verified parent's own bundle. No Keychain call occurs before this.
        guard AssistantCredentialIdentity.authorizedParent(parent) else { exit(77) }
        guard let data = try? FileHandle.standardInput.read(upToCount: 4097), data.count <= 4096,
              let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let action = request["action"] as? String,
              let account = request["account"] as? String,
              account == "api-key" || account.range(of: "^api-key\\.[A-Fa-f0-9-]{36}$", options: .regularExpression) != nil else { exit(2) }
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: AssistantCredentialIdentity.service, kSecAttrAccount as String: account]
        var reply: [String: Any] = [:]
        let status: OSStatus
        switch action {
        case "lookup":
            let readSecret = request["returnData"] as? Bool == true
            query[readSecret ? kSecReturnData as String : kSecReturnAttributes as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var value: CFTypeRef?
            status = CampusKeychain.copyMatching(query as CFDictionary, &value,
                allowInteraction: readSecret && request["interactive"] as? Bool == true)
            if status == errSecSuccess && readSecret {
                guard let bytes = value as? Data, let key = String(data: bytes, encoding: .utf8), key.count <= 512 else { exit(3) }
                reply["key"] = key
            }
        case "add":
            guard let key = request["key"] as? String, (8...512).contains(key.utf8.count),
                  key.utf8.allSatisfy({ $0 > 32 && $0 < 127 }) else { exit(2) }
            query[kSecValueData as String] = Data(key.utf8)
            query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            query[kSecAttrLabel as String] = "CampusDesk DeepSeek API key"
            status = CampusKeychain.add(query as CFDictionary, nil, allowInteraction: false)
        case "delete":
            status = CampusKeychain.delete(query as CFDictionary, allowInteraction: false)
        default: exit(2)
        }
        guard getppid() == parent, AssistantCredentialIdentity.authorizedParent(parent) else { exit(77) }
        reply["status"] = status
        guard let output = try? JSONSerialization.data(withJSONObject: reply), output.count <= 4096 else { exit(3) }
        FileHandle.standardOutput.write(output)
    }
}
