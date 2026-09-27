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
    private static let maximumMessageCount = 12
    private static let maximumTotalCharacters = 40_000

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

    static func request(provider: String, model rawModel: String, fallbackModel rawFallbackModel: String?, networkAvailable: Bool, messages rawMessages: [[String: Any]], completion: @escaping (Result<AssistantReply, AssistantError>) -> Void) {
        guard ["deepseek", "ollama", "hybrid"].contains(provider) else { completion(.failure(.invalidRequest)); return }
        let model = rawModel.trimmingCharacters(in: .whitespacesAndNewlines)
        let localModel = (provider == "hybrid" ? rawFallbackModel : rawModel)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        func validModel(_ value: String) -> Bool {
            (1...100).contains(value.count) && value.range(of: "^[A-Za-z0-9._:/-]+$", options: .regularExpression) != nil
        }
        guard validModel(model), (provider != "hybrid" || validModel(localModel)),
              !rawMessages.isEmpty, rawMessages.count <= maximumMessageCount else {
            completion(.failure(.invalidRequest)); return
        }
        var totalCharacters = 0
        var messages: [[String: String]] = []
        for item in rawMessages {
            guard let role = item["role"] as? String, ["system", "user", "assistant"].contains(role),
                  let content = item["content"] as? String, !content.isEmpty, content.count <= maximumTotalCharacters else {
                completion(.failure(.invalidRequest)); return
            }
            totalCharacters += content.count
            guard totalCharacters <= maximumTotalCharacters else { completion(.failure(.invalidRequest)); return }
            messages.append(["role": role, "content": content])
        }

        if provider == "hybrid" {
            if !networkAvailable {
                performRequest(provider: "ollama", model: localModel, messages: messages, timeout: 90) { result in
                    completion(result.map { AssistantReply(answer: $0, providerUsed: "ollama", fallbackReason: "offline") })
                }
                return
            }
            performRequest(provider: "deepseek", model: model, messages: messages, timeout: 15) { result in
                switch result {
                case .success(let answer): completion(.success(AssistantReply(answer: answer, providerUsed: "deepseek", fallbackReason: nil)))
                case .failure(.network):
                    performRequest(provider: "ollama", model: localModel, messages: messages, timeout: 90) { localResult in
                        completion(localResult.map { AssistantReply(answer: $0, providerUsed: "ollama", fallbackReason: "deepseekUnavailable") })
                    }
                case .failure(let error): completion(.failure(error))
                }
            }
            return
        }

        performRequest(provider: provider, model: model, messages: messages, timeout: 90) { result in
            completion(result.map { AssistantReply(answer: $0, providerUsed: provider, fallbackReason: nil) })
        }
    }

    private static func performRequest(provider: String, model: String, messages: [[String: String]], timeout: TimeInterval, completion: @escaping (Result<String, AssistantError>) -> Void) {
        var request: URLRequest
        if provider == "deepseek" {
            let key: String
            do { key = try keyStore.read() }
            catch let error as AssistantError { completion(.failure(error)); return }
            catch { completion(.failure(.keyStore)); return }
            request = URLRequest(url: URL(string: "https://api.deepseek.com/chat/completions")!)
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var payload: [String: Any] = ["model": model, "messages": messages, "stream": false, "max_tokens": 4096]
            payload["temperature"] = 0.4
            guard let data = try? JSONSerialization.data(withJSONObject: payload) else { completion(.failure(.invalidRequest)); return }
            request.httpBody = data
        } else {
            request = URLRequest(url: URL(string: "http://127.0.0.1:11434/api/chat")!)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let payload: [String: Any] = ["model": model, "messages": messages, "stream": false]
            guard let data = try? JSONSerialization.data(withJSONObject: payload) else { completion(.failure(.invalidRequest)); return }
            request.httpBody = data
        }
        request.httpMethod = "POST"
        request.timeoutInterval = timeout

        let session = URLSession(configuration: .ephemeral, delegate: NoRedirectDelegate(), delegateQueue: nil)
        session.dataTask(with: request) { data, response, error in
            defer { session.finishTasksAndInvalidate() }
            if error != nil { completion(.failure(provider == "ollama" ? .localUnavailable : .network)); return }
            guard let http = response as? HTTPURLResponse, let data, data.count <= 2_000_000 else { completion(.failure(.badResponse)); return }
            guard (200...299).contains(http.statusCode) else {
                if provider == "ollama" && http.statusCode == 404 { completion(.failure(.localModelMissing)); return }
                completion(.failure(provider == "deepseek" && http.statusCode == 401 ? .unauthorized : .serviceRejected)); return
            }
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { completion(.failure(.badResponse)); return }
            let content: String?
            if provider == "deepseek" {
                let choices = object["choices"] as? [[String: Any]]
                if let message = choices?.first?["message"] as? [String: Any] {
                    content = message["content"] as? String
                } else {
                    content = nil
                }
            } else {
                content = (object["message"] as? [String: Any])?["content"] as? String
            }
            guard let answer = content?.trimmingCharacters(in: .whitespacesAndNewlines), !answer.isEmpty, answer.count <= 100_000 else {
                completion(.failure(.badResponse)); return
            }
            completion(.success(answer))
        }.resume()
    }

}

struct AssistantReply {
    let answer: String
    let providerUsed: String
    let fallbackReason: String?
}

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum AssistantError: Error {
    case invalidKey, keyStore, keyAccess, invalidRequest, missingKey, localUnavailable, localModelMissing
    case network, unauthorized, serviceRejected, badResponse

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
        case .serviceRejected: return "serviceRejected"
        case .badResponse: return "badResponse"
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
        case .serviceRejected: return "AI 服务拒绝了这次请求；请检查模型设置或稍后重试。"
        case .badResponse: return "AI 服务返回的内容无法识别，请稍后重试。"
        }
    }
}
