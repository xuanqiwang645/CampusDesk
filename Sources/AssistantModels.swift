import Foundation

enum AssistantModelError: String, Error {
    case missingKey, unauthorized, network, localUnavailable, badResponse

    var code: String { rawValue }
}

/// Discovery sends only model metadata and, for DeepSeek, the supplied API key.
/// Local /show requests contain a model name, never school data or questions.
enum CampusAssistantModels {
    static let maximumResponseBytes = 512 * 1024
    static let maximumModelCount = 100

    static func list(provider: String, key: String?, configuration: @escaping () -> URLSessionConfiguration = { .ephemeral },
                     completion: @escaping (Result<[String], AssistantModelError>) -> Void) {
        do {
            let request = try makeRequest(provider: provider, key: key)
            AssistantModelListRequest(provider: provider, configuration: configuration, completion: completion).start(request)
        } catch let error as AssistantModelError {
            completion(.failure(error))
        } catch {
            completion(.failure(.badResponse))
        }
    }

    static func validModelName(_ value: String) -> Bool {
        (1...100).contains(value.count) && value.range(of: "^[A-Za-z0-9._:/-]+$", options: .regularExpression) != nil
    }

    static func isCloudModelName(_ value: String) -> Bool {
        let name = value.lowercased()
        return name.hasSuffix(":cloud") || name.hasSuffix("-cloud") || name.contains(":cloud:")
    }

    private static func hasRemoteMetadata(_ object: [String: Any]) -> Bool {
        ["remote_host", "remote_model"].contains { key in
            guard let value = object[key], !(value is NSNull) else { return false }
            guard let value = value as? String else { return true }
            return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    static func makeLocalDetailsRequest(model: String) throws -> URLRequest {
        guard validModelName(model), !isCloudModelName(model) else { throw AssistantModelError.badResponse }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:11434/api/show")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["model": model])
        return request
    }

    /// Name checks alone cannot detect `ollama cp` aliases of cloud models.
    /// Require local model metadata and reject remote origin fields before any
    /// question is sent. Unknown/older responses fail closed.
    static func isVerifiedLocalDetails(_ data: Data, model: String) -> Bool {
        guard validModelName(model), !isCloudModelName(model), !data.isEmpty, data.count <= maximumResponseBytes,
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              !hasRemoteMetadata(object), object["error"] == nil,
              let details = object["details"] as? [String: Any],
              let format = details["format"] as? String, ["gguf", "safetensors"].contains(format.lowercased()),
              let info = object["model_info"] as? [String: Any], !info.isEmpty else { return false }
        if let capabilities = object["capabilities"] {
            guard let capabilities = capabilities as? [String], capabilities.contains("completion") else { return false }
        }
        return true
    }

    // Kept separate from transport for synthetic tests; no request is sent here.
    static func makeRequest(provider: String, key: String?) throws -> URLRequest {
        var request: URLRequest
        switch provider {
        case "deepseek":
            guard let key = key?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else {
                throw AssistantModelError.missingKey
            }
            guard (8...512).contains(key.utf8.count), key.unicodeScalars.allSatisfy({ (0x21...0x7e).contains(Int($0.value)) }) else {
                throw AssistantModelError.unauthorized
            }
            request = URLRequest(url: URL(string: "https://api.deepseek.com/models")!)
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            request.timeoutInterval = 10
        case "ollama":
            request = URLRequest(url: URL(string: "http://127.0.0.1:11434/api/tags")!)
            request.timeoutInterval = 5
        default:
            throw AssistantModelError.badResponse
        }
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpShouldHandleCookies = false
        return request
    }

    static func parse(_ data: Data, provider: String) throws -> [String] {
        guard !data.isEmpty, data.count <= maximumResponseBytes,
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            throw AssistantModelError.badResponse
        }
        let rows: [[String: Any]]
        switch provider {
        case "deepseek":
            guard let models = object["data"] as? [[String: Any]] else { throw AssistantModelError.badResponse }
            rows = models
        case "ollama":
            guard let models = object["models"] as? [[String: Any]] else { throw AssistantModelError.badResponse }
            rows = models
        default:
            throw AssistantModelError.badResponse
        }
        guard rows.count <= maximumModelCount else { throw AssistantModelError.badResponse }
        var seen = Set<String>()
        var models: [String] = []
        for row in rows {
            let value = provider == "deepseek" ? row["id"] as? String : (row["name"] as? String ?? row["model"] as? String)
            guard let value, validModelName(value) else {
                throw AssistantModelError.badResponse
            }
            if provider == "ollama" && (isCloudModelName(value) || hasRemoteMetadata(row)) { continue }
            if seen.insert(value).inserted { models.append(value) }
        }
        return models
    }

    static func responseError(provider: String, statusCode: Int) -> AssistantModelError? {
        if (200...299).contains(statusCode) { return nil }
        if (300...399).contains(statusCode) { return .badResponse }
        if provider == "deepseek", statusCode == 401 || statusCode == 403 { return .unauthorized }
        return provider == "ollama" ? .localUnavailable : .network
    }
}

/// Metadata checks use a bounded number of local connections and an overall
/// deadline. A failed verification never turns a remote alias into a local model.
private final class AssistantModelListRequest {
    private let provider: String
    private let configuration: () -> URLSessionConfiguration
    private let completion: (Result<[String], AssistantModelError>) -> Void
    private let queue = DispatchQueue(label: "CampusDesk.assistant.models")
    private var tasks: [String: AssistantHTTPTask] = [:]
    private var candidates: [String] = []
    private var verified = Set<String>()
    private var nextIndex = 0
    private var finished = false

    init(provider: String, configuration: @escaping () -> URLSessionConfiguration,
         completion: @escaping (Result<[String], AssistantModelError>) -> Void) {
        self.provider = provider; self.configuration = configuration
        self.completion = completion
    }

    func start(_ request: URLRequest) {
        queue.async {
            var body = Data()
            let task = AssistantHTTPTask(queue: self.queue, maximumBytes: CampusAssistantModels.maximumResponseBytes,
                                         receive: { body.append($0) }) { result in
                guard !self.finished else { return }
                self.tasks.removeValue(forKey: "catalog")
                switch result {
                case .failure(let error): self.finish(.failure(self.map(error)))
                case .success:
                    do {
                        self.candidates = try CampusAssistantModels.parse(body, provider: self.provider)
                        if self.provider == "ollama" { self.verifyNext() }
                        else { self.finish(.success(self.candidates)) }
                    } catch { self.finish(.failure(.badResponse)) }
                }
            }
            self.tasks["catalog"] = task
            task.start(request, local: self.provider == "ollama", resourceTimeout: request.timeoutInterval, configuration: self.configuration())
            self.queue.asyncAfter(deadline: .now() + 15) {
                self.finish(.failure(self.provider == "ollama" ? .localUnavailable : .network))
            }
        }
    }

    private func verifyNext() {
        while !finished && tasks.count < 4 && nextIndex < candidates.count {
            let model = candidates[nextIndex]
            nextIndex += 1
            guard let request = try? CampusAssistantModels.makeLocalDetailsRequest(model: model) else { continue }
            var body = Data()
            let task = AssistantHTTPTask(queue: queue, maximumBytes: CampusAssistantModels.maximumResponseBytes,
                                         receive: { body.append($0) }) { result in
                guard !self.finished else { return }
                self.tasks.removeValue(forKey: model)
                switch result {
                case .success:
                    if CampusAssistantModels.isVerifiedLocalDetails(body, model: model) { self.verified.insert(model) }
                case .failure(.rejected(404)): break // A model may have been removed after /tags.
                case .failure(let error): self.finish(.failure(self.map(error))); return
                }
                self.verifyNext()
            }
            tasks[model] = task
            task.start(request, local: true, resourceTimeout: 5, configuration: configuration())
        }
        if !finished && nextIndex == candidates.count && tasks.isEmpty {
            finish(.success(candidates.filter { verified.contains($0) }))
        }
    }

    private func map(_ error: AssistantHTTPError) -> AssistantModelError {
        switch error {
        case .rejected(let code): return CampusAssistantModels.responseError(provider: provider, statusCode: code) ?? .badResponse
        case .cancelled, .network: return provider == "ollama" ? .localUnavailable : .network
        case .invalidResponse, .tooLarge: return .badResponse
        }
    }

    private func finish(_ result: Result<[String], AssistantModelError>) {
        guard !finished else { return }
        finished = true
        let active = Array(tasks.values)
        tasks.removeAll()
        active.forEach { $0.cancel() }
        completion(result)
    }
}
