import Foundation
import Security

enum CampusAssistantAI {
    private static let service = (Bundle.main.bundleIdentifier ?? "local.campusdesk.mac") + ".assistant.deepseek"
    private static let keyStore = AssistantKeyStore(
        service: service,
        currentAccount: { UserDefaults.standard.string(forKey: "assistant.deepseek.activeAccount") ?? "api-key" },
        selectAccount: {
            UserDefaults.standard.set($0, forKey: "assistant.deepseek.activeAccount")
            UserDefaults.standard.synchronize()
        },
        copyMatching: { AssistantCredentialBridge.lookup($0) },
        add: { AssistantCredentialBridge.add($0) },
        remove: { AssistantCredentialBridge.remove($0) },
        authorizeMatching: { AssistantCredentialBridge.lookup($0, allowInteraction: true) }
    )
    static func status() -> [String: Any] {
        let state = keyStore.state()
        return ["type": "assistantStatus", "deepSeekKeyConfigured": state == .stored || state == .locked,
                "deepSeekKeyState": state.rawValue]
    }

    static func saveDeepSeekKey(_ rawKey: String) throws {
        try keyStore.save(rawKey)
    }

    static func restoreDeepSeekKeyAccess() throws {
        try keyStore.restoreAccess()
    }

    @discardableResult static func deleteDeepSeekKey() -> Bool {
        keyStore.delete()
    }

    static func keyForModelCatalog() throws -> String { try keyStore.read() }

    /// Completion and chunks are ordered on a background serial queue. Even
    /// validation failures and cancellation complete asynchronously exactly once.
    @discardableResult static func request(provider: String, model: String, fallbackModel: String?, networkAvailable: Bool,
                                           messages: [[String: Any]], onChunk: ((AssistantStreamChunk) -> Void)? = nil,
                                           completion: @escaping (Result<AssistantReply, AssistantError>) -> Void) -> AssistantRequestHandle {
        AssistantRequestOperation(provider: provider, model: model, fallbackModel: fallbackModel,
                                  networkAvailable: networkAvailable, messages: messages,
                                  keyProvider: { try keyStore.read() }, onChunk: onChunk, completion: completion).start()
    }

}

struct AssistantReply {
    let answer: String
    let providerUsed: String
    let fallbackReason: String?
}

struct AssistantStreamChunk {
    let text: String
    let providerUsed: String
    let fallbackReason: String?
}

final class AssistantRequestHandle {
    private let cancellation: () -> Void
    init(_ cancellation: @escaping () -> Void) { self.cancellation = cancellation }
    func cancel() { cancellation() }
}

/// Dependencies are injectable for URLProtocol fixtures; production callers
/// cannot change endpoints or supply a key from the JavaScript bridge.
final class AssistantRequestOperation {
    private let queue = DispatchQueue(label: "CampusDesk.assistant.request")
    private let provider: String, model: String, localModel: String
    private let networkAvailable: Bool
    private let rawMessages: [[String: Any]]
    private let keyProvider: () throws -> String
    private let configuration: () -> URLSessionConfiguration
    private let onChunk: ((AssistantStreamChunk) -> Void)?
    private let completion: (Result<AssistantReply, AssistantError>) -> Void
    private var messages: [[String: String]] = []
    private var task: AssistantHTTPTask?
    private var finished = false
    private var emittedText = false

    init(provider: String, model: String, fallbackModel: String?, networkAvailable: Bool,
         messages: [[String: Any]], keyProvider: @escaping () throws -> String,
         configuration: @escaping () -> URLSessionConfiguration = { .ephemeral },
         onChunk: ((AssistantStreamChunk) -> Void)? = nil,
         completion: @escaping (Result<AssistantReply, AssistantError>) -> Void) {
        self.provider = provider; self.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
        self.localModel = (provider == "hybrid" ? fallbackModel ?? "" : model).trimmingCharacters(in: .whitespacesAndNewlines)
        self.networkAvailable = networkAvailable; self.rawMessages = messages
        self.keyProvider = keyProvider; self.configuration = configuration
        self.onChunk = onChunk; self.completion = completion
    }

    func start() -> AssistantRequestHandle {
        let handle = AssistantRequestHandle { self.queue.async { self.finish(.failure(.cancelled)) } }
        queue.async {
            guard ["deepseek", "ollama", "hybrid"].contains(self.provider),
                  CampusAssistantModels.validModelName(self.model),
                  self.provider != "hybrid" || CampusAssistantModels.validModelName(self.localModel),
                  !self.rawMessages.isEmpty, self.rawMessages.count <= 12 else {
                self.finish(.failure(.invalidRequest)); return
            }
            var count = 0
            for item in self.rawMessages {
                guard let role = item["role"] as? String, ["system", "user", "assistant"].contains(role),
                      let content = item["content"] as? String, !content.isEmpty else {
                    self.finish(.failure(.invalidRequest)); return
                }
                count += content.count
                guard count <= 40_000 else { self.finish(.failure(.invalidRequest)); return }
                self.messages.append(["role": role, "content": content])
            }
            if self.provider == "ollama" || (self.provider == "hybrid" && !self.networkAvailable) {
                self.verifyAndSendLocal(reason: self.provider == "hybrid" ? "offline" : nil)
            } else if !self.networkAvailable {
                self.finish(.failure(.network))
            } else { self.send(provider: "deepseek", model: self.model, reason: nil) }
        }
        return handle
    }

    private func verifyAndSendLocal(reason: String?) {
        guard !finished else { return }
        guard !CampusAssistantModels.isCloudModelName(localModel),
              let request = try? CampusAssistantModels.makeLocalDetailsRequest(model: localModel) else {
            finish(.failure(.localModelNotLocal)); return
        }
        var body = Data()
        let task = AssistantHTTPTask(queue: queue, maximumBytes: CampusAssistantModels.maximumResponseBytes,
                                     receive: { body.append($0) }) { result in
            guard !self.finished else { return }
            switch result {
            case .failure(let error): self.finish(.failure(self.map(error, provider: "ollama")))
            case .success:
                guard CampusAssistantModels.isVerifiedLocalDetails(body, model: self.localModel) else {
                    self.finish(.failure(.localModelNotLocal)); return
                }
                self.send(provider: "ollama", model: self.localModel, reason: reason)
            }
        }
        self.task = task
        task.start(request, local: true, resourceTimeout: 5, configuration: configuration())
    }

    private func send(provider: String, model: String, reason: String?) {
        guard !finished else { return }
        var request = URLRequest(url: URL(string: provider == "deepseek" ? "https://api.deepseek.com/chat/completions" : "http://127.0.0.1:11434/api/chat")!)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = provider == "deepseek" && self.provider == "hybrid" ? 15 : 90
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(provider == "deepseek" ? "text/event-stream" : "application/x-ndjson", forHTTPHeaderField: "Accept")
        var payload: [String: Any] = ["model": model, "messages": messages, "stream": true]
        if provider == "deepseek" {
            do {
                let key = try keyProvider()
                guard (8...512).contains(key.count), CampusSecurity.isSafeHTTPHeaderValue(key) else { finish(.failure(.invalidKey)); return }
                request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            } catch let error as AssistantError { finish(.failure(error)); return }
            catch { finish(.failure(.keyStore)); return }
            payload["max_tokens"] = 4096; payload["temperature"] = 0.4
            // DeepSeek enables high-effort thinking by default. Reserve this
            // ordinary chat budget for the visible answer rather than hidden
            // reasoning that can consume the whole limit before any reply.
            payload["thinking"] = ["type": "disabled"]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { finish(.failure(.invalidRequest)); return }
        request.httpBody = data
        let decoder = AssistantStreamDecoder(provider: provider)
        let task = AssistantHTTPTask(queue: queue, maximumBytes: 2_000_000, receive: { data in
            guard !self.finished else { return }
            do {
                self.deliver(try decoder.append(data), provider: provider, reason: reason)
                if decoder.done { self.complete(decoder, provider: provider, reason: reason) }
            } catch { self.finish(.failure(.badResponse)) }
        }) { result in
            guard !self.finished else { return }
            switch result {
            case .success: self.complete(decoder, provider: provider, reason: reason)
            case .failure(let failure):
                let error = self.map(failure, provider: provider)
                if self.provider == "hybrid", provider == "deepseek", error == .network, !self.emittedText {
                    self.verifyAndSendLocal(reason: "deepseekUnavailable")
                } else { self.finish(.failure(error)) }
            }
        }
        self.task = task
        task.start(request, local: provider == "ollama", resourceTimeout: 180, configuration: configuration())
    }

    private func deliver(_ chunks: [String], provider: String, reason: String?) {
        guard !finished else { return }
        for text in chunks {
            emittedText = true
            onChunk?(AssistantStreamChunk(text: text, providerUsed: provider, fallbackReason: reason))
        }
    }

    private func complete(_ decoder: AssistantStreamDecoder, provider: String, reason: String?) {
        do {
            deliver(try decoder.finish(), provider: provider, reason: reason)
            finish(.success(AssistantReply(answer: decoder.answer.trimmingCharacters(in: .whitespacesAndNewlines), providerUsed: provider, fallbackReason: reason)))
        } catch { finish(.failure(.badResponse)) }
    }

    private func map(_ error: AssistantHTTPError, provider: String) -> AssistantError {
        switch error {
        case .cancelled: return .cancelled
        case .network: return provider == "ollama" ? .localUnavailable : .network
        case .rejected(let code):
            if provider == "ollama" && code == 404 { return .localModelMissing }
            guard provider == "deepseek" else { return .serviceRejected }
            switch code {
            case 400, 422: return .remoteInvalidRequest
            case 401, 403: return .unauthorized
            case 402: return .insufficientBalance
            case 404: return .modelUnavailable
            case 429: return .rateLimited
            case 500...599: return .serviceUnavailable
            default: return .serviceRejected
            }
        case .invalidResponse, .tooLarge: return .badResponse
        }
    }

    private func finish(_ result: Result<AssistantReply, AssistantError>) {
        guard !finished else { return }
        finished = true
        let task = self.task
        self.task = nil
        task?.cancel()
        completion(result)
    }
}

enum AssistantError: Error {
    case invalidKey, keyStore, keyAccess, invalidRequest, missingKey, localUnavailable, localModelMissing
    case network, unauthorized, remoteInvalidRequest, insufficientBalance, modelUnavailable, rateLimited, serviceUnavailable
    case serviceRejected, badResponse, localModelNotLocal, cancelled

    var code: String {
        switch self {
        case .invalidKey: return "invalidKey"
        case .keyStore: return "keyStore"
        case .keyAccess: return "keyAccess"
        case .invalidRequest: return "invalidRequest"
        case .missingKey: return "missingKey"
        case .localUnavailable: return "localUnavailable"
        case .localModelMissing: return "localModelMissing"
        case .network: return "network"
        case .unauthorized: return "unauthorized"
        case .remoteInvalidRequest: return "remoteInvalidRequest"
        case .insufficientBalance: return "insufficientBalance"
        case .modelUnavailable: return "modelUnavailable"
        case .rateLimited: return "rateLimited"
        case .serviceUnavailable: return "serviceUnavailable"
        case .serviceRejected: return "serviceRejected"
        case .badResponse: return "badResponse"
        case .localModelNotLocal: return "localModelNotLocal"
        case .cancelled: return "cancelled"
        }
    }

    var message: String {
        switch self {
        case .invalidKey: return "API 密钥格式无效，请检查后重试。"
        case .keyStore: return "钥匙串暂不可用，请稍后重试。已保存的密钥会保留。"
        case .keyAccess: return "已保存的密钥需要恢复访问。点击“恢复密钥访问”，无需重新输入 API 密钥。"
        case .invalidRequest: return "请求内容超出限制或格式无效。"
        case .missingKey: return "请先在学习助手设置中保存 DeepSeek API 密钥。"
        case .localUnavailable: return "无法连接本机 Ollama。请确认 Ollama 已启动，并且本机模型已安装。"
        case .localModelMissing: return "Ollama 找不到此模型；请先在 Ollama 中下载该模型，再重试。"
        case .network: return "无法连接 DeepSeek。请检查网络后重试。"
        case .unauthorized: return "DeepSeek API 密钥无效或已失效。"
        case .remoteInvalidRequest: return "DeepSeek 未接受本次请求参数，请检查所选模型或减少附带资料后重试。"
        case .insufficientBalance: return "DeepSeek API 账户余额不足，请在 DeepSeek 开放平台充值后重试。"
        case .modelUnavailable: return "所选 DeepSeek 模型暂不可用，请刷新模型列表并重新选择。"
        case .rateLimited: return "DeepSeek 请求过于频繁，请稍后重试。"
        case .serviceUnavailable: return "DeepSeek 服务暂时不可用，请稍后重试。"
        case .serviceRejected: return "AI 服务拒绝了这次请求；请检查模型设置或稍后重试。"
        case .badResponse: return "AI 服务返回的内容无法识别，请稍后重试。"
        case .localModelNotLocal: return "此模型无法确认为本机模型。请选择已下载到这台 Mac 的模型；云模型和远程别名不可用于仅本机模式。"
        case .cancelled: return "已停止生成。"
        }
    }
}
