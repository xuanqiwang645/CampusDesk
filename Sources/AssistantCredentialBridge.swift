import Foundation
import Security

/// The stable native helper owns Keychain ACLs. Updating the dashboard or app
/// binary cannot change the helper's identity. Secrets stay in native pipes.
enum AssistantCredentialBridge {
    static func lookup(_ query: [String: Any], allowInteraction: Bool = false) -> (OSStatus, CFTypeRef?) {
        let reply = invoke("lookup", query: query, allowInteraction: allowInteraction)
        guard reply.status == errSecSuccess else { return (reply.status, nil) }
        if query[kSecReturnData as String] as? Bool == true {
            guard let key = reply.body["key"] as? String else { return (errSecDecode, nil) }
            return (errSecSuccess, Data(key.utf8) as CFData)
        }
        return (errSecSuccess, [:] as CFDictionary)
    }

    static func add(_ query: [String: Any]) -> OSStatus { invoke("add", query: query).status }
    static func remove(_ query: [String: Any]) -> OSStatus { invoke("delete", query: query).status }

    private static func invoke(_ action: String, query: [String: Any], allowInteraction: Bool = false) -> (status: OSStatus, body: [String: Any]) {
        guard query[kSecAttrService as String] as? String == AssistantCredentialIdentity.service,
              let account = query[kSecAttrAccount as String] as? String,
              let executable = Bundle.main.executableURL else {
            NSLog("CampusDesk credential bridge: invalid local query"); return (errSecParam, [:])
        }
        let helper = executable.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Helpers/CampusDeskCredentials")
        guard AssistantCredentialIdentity.validHelper(at: helper) else {
            NSLog("CampusDesk credential bridge: helper identity unavailable"); return (errSecNotAvailable, [:])
        }
        var request: [String: Any] = ["action": action, "account": account, "interactive": allowInteraction,
                                     "returnData": query[kSecReturnData as String] as? Bool == true]
        if action == "add" {
            guard let data = query[kSecValueData as String] as? Data,
                  let key = String(data: data, encoding: .utf8) else { return (errSecParam, [:]) }
            request["key"] = key
        }
        guard let payload = try? JSONSerialization.data(withJSONObject: request), payload.count <= 4096 else { return (errSecParam, [:]) }
        let process = Process(), input = Pipe(), output = Pipe()
        process.executableURL = helper
        process.standardInput = input; process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        // Do not inherit loader hooks, debug options or credentials from a shell.
        process.environment = ["PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"]
        do { try process.run() } catch {
            NSLog("CampusDesk credential bridge: could not launch helper"); return (errSecNotAvailable, [:])
        }
        input.fileHandleForWriting.write(payload)
        input.fileHandleForWriting.closeFile()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0, data.count <= 4096,
              let reply = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let status = reply["status"] as? Int32 else {
            NSLog("CampusDesk credential bridge: helper exit %d, response length %d", process.terminationStatus, data.count)
            return (errSecNotAvailable, [:])
        }
        if status != errSecSuccess && status != errSecItemNotFound {
            NSLog("CampusDesk credential bridge: Keychain status %d", status)
        }
        return (status, reply)
    }
}
