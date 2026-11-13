import Foundation
import Security

/// OpenAI credentials belong to this edition's own helper and service. The
/// renderer receives status only; no saved secret is ever read back into JS.
enum CampusOpenAI {
    private static let keyStore = AssistantKeyStore(
        service: (Bundle.main.bundleIdentifier ?? "local.campusdesk.mac") + ".assistant.openai",
        currentAccount: { UserDefaults.standard.string(forKey: "assistant.openai.activeAccount") ?? "api-key" },
        selectAccount: { UserDefaults.standard.set($0, forKey: "assistant.openai.activeAccount"); UserDefaults.standard.synchronize() },
        copyMatching: { OpenAICredentialBridge.lookup($0) },
        add: { OpenAICredentialBridge.add($0) },
        remove: { OpenAICredentialBridge.remove($0) },
        authorizeMatching: { OpenAICredentialBridge.lookup($0, allowInteraction: true) }
    )

    static func status() -> [String: Any] {
        let state = keyStore.state()
        return ["type": "openaiStatus", "configured": state == .stored || state == .locked, "keyState": state.rawValue]
    }
    static func saveKey(_ key: String) throws { try keyStore.save(key) }
    static func restoreAccess() throws { try keyStore.restoreAccess() }
    static func deleteKey() -> Bool { keyStore.delete() }
    static func key() throws -> String { try keyStore.read() }

    static func request(provider: String, model: String, fallbackModel: String?, networkAvailable: Bool,
                        messages: [[String: Any]], onChunk: ((AssistantStreamChunk) -> Void)?,
                        completion: @escaping (Result<AssistantReply, AssistantError>) -> Void) -> AssistantRequestHandle {
        // Non-OpenAI modes retain their existing credential path and fallback.
        if provider != "openai" {
            return CampusAssistantAI.request(provider: provider, model: model, fallbackModel: fallbackModel,
                networkAvailable: networkAvailable, messages: messages, onChunk: onChunk, completion: completion)
        }
        return AssistantRequestOperation(provider: "openai", model: model, fallbackModel: nil,
            networkAvailable: networkAvailable, messages: messages, keyProvider: { try keyStore.read() },
            onChunk: onChunk, completion: completion).start()
    }
}
