import Foundation

enum AssistantModelError: String, Error {
    case missingKey, unauthorized, network, localUnavailable, badResponse

    var code: String { rawValue }
}

/// Model discovery sends only a GET request and, for DeepSeek, the supplied API
/// key. It never reads the keychain, school state, questions, or attachments.
enum CampusAssistantModels {
    static let maximumResponseBytes = 512 * 1024
    static let maximumModelCount = 100

    static func list(provider: String, key: String?, completion: @escaping (Result<[String], AssistantModelError>) -> Void) {
        do {
            let request = try makeRequest(provider: provider, key: key)
            AssistantModelListRequest(provider: provider, completion: completion).start(request)
        } catch let error as AssistantModelError {
            completion(.failure(error))
        } catch {
            completion(.failure(.badResponse))
        }
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
            guard let value, (1...100).contains(value.count),
                  value.range(of: "^[A-Za-z0-9._:/-]+$", options: .regularExpression) != nil else {
                throw AssistantModelError.badResponse
            }
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

/// A serial delegate bounds the received body before accumulation. Cancelling a
/// request never exposes a raw response or credential in its error message.
private final class AssistantModelListRequest: NSObject, URLSessionDataDelegate {
    private let provider: String
    private let completion: (Result<[String], AssistantModelError>) -> Void
    private var session: URLSession?
    private var body = Data()
    private var finished = false

    init(provider: String, completion: @escaping (Result<[String], AssistantModelError>) -> Void) {
        self.provider = provider
        self.completion = completion
    }

    func start(_ request: URLRequest) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = request.timeoutInterval
        configuration.timeoutIntervalForResource = request.timeoutInterval
        configuration.waitsForConnectivity = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        // A local model list must stay on loopback even when a proxy is set up.
        if provider == "ollama" { configuration.connectionProxyDictionary = [:] }
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        self.session = session
        session.dataTask(with: request).resume()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(.badResponse))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !finished else { completionHandler(.cancel); return }
        guard let response = response as? HTTPURLResponse else {
            completionHandler(.cancel); finish(.failure(.badResponse)); return
        }
        if let error = CampusAssistantModels.responseError(provider: provider, statusCode: response.statusCode) {
            completionHandler(.cancel); finish(.failure(error)); return
        }
        guard response.expectedContentLength <= Int64(CampusAssistantModels.maximumResponseBytes) else {
            completionHandler(.cancel); finish(.failure(.badResponse)); return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !finished else { return }
        guard data.count <= CampusAssistantModels.maximumResponseBytes - body.count else {
            finish(.failure(.badResponse)); return
        }
        body.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !finished else { return }
        guard error == nil else {
            finish(.failure(provider == "ollama" ? .localUnavailable : .network)); return
        }
        do {
            finish(.success(try CampusAssistantModels.parse(body, provider: provider)))
        } catch {
            finish(.failure(.badResponse))
        }
    }

    private func finish(_ result: Result<[String], AssistantModelError>) {
        guard !finished else { return }
        finished = true
        let session = self.session
        self.session = nil
        body.removeAll(keepingCapacity: false)
        session?.invalidateAndCancel()
        completion(result)
    }
}
