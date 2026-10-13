import Foundation

enum AssistantHTTPError: Error {
    case network, cancelled, rejected(Int), invalidResponse, tooLarge
}

/// All callbacks and cancellation run on the supplied serial queue. Limits are
/// enforced before a body is accumulated or passed to the streaming decoder.
final class AssistantHTTPTask: NSObject, URLSessionDataDelegate {
    private let queue: DispatchQueue
    private let maximumBytes: Int
    private let receive: (Data) -> Void
    private let completion: (Result<Void, AssistantHTTPError>) -> Void
    private var session: URLSession?
    private var receivedBytes = 0
    private var finished = false

    init(queue: DispatchQueue, maximumBytes: Int, receive: @escaping (Data) -> Void,
         completion: @escaping (Result<Void, AssistantHTTPError>) -> Void) {
        self.queue = queue; self.maximumBytes = maximumBytes
        self.receive = receive; self.completion = completion
    }

    func start(_ request: URLRequest, local: Bool, resourceTimeout: TimeInterval,
               configuration: URLSessionConfiguration = .ephemeral) {
        configuration.timeoutIntervalForRequest = request.timeoutInterval
        configuration.timeoutIntervalForResource = resourceTimeout
        configuration.waitsForConnectivity = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        if local { configuration.connectionProxyDictionary = [:] }
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        delegateQueue.underlyingQueue = queue
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
        self.session = session
        session.dataTask(with: request).resume()
    }

    func cancel() { finish(.failure(.cancelled)) }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(.invalidResponse))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !finished else { completionHandler(.cancel); return }
        guard let http = response as? HTTPURLResponse else {
            completionHandler(.cancel); finish(.failure(.invalidResponse)); return
        }
        guard (200...299).contains(http.statusCode) else {
            completionHandler(.cancel); finish(.failure(.rejected(http.statusCode))); return
        }
        guard response.expectedContentLength <= Int64(maximumBytes) else {
            completionHandler(.cancel); finish(.failure(.tooLarge)); return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !finished else { return }
        guard data.count <= maximumBytes - receivedBytes else { finish(.failure(.tooLarge)); return }
        receivedBytes += data.count
        receive(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error as NSError? {
            finish(.failure(error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled ? .cancelled : .network))
        } else { finish(.success(())) }
    }

    private func finish(_ result: Result<Void, AssistantHTTPError>) {
        guard !finished else { return }
        finished = true
        let session = self.session
        self.session = nil
        session?.invalidateAndCancel()
        completion(result)
    }
}

enum AssistantStreamError: Error { case malformed, tooLarge }

/// Parses arbitrarily split UTF-8 bytes, SSE events, and Ollama NDJSON. A clean
/// HTTP EOF without the protocol's terminal marker is an incomplete answer.
final class AssistantStreamDecoder {
    static let maximumLineBytes = 131_072
    static let maximumAnswerCharacters = 100_000
    let provider: String
    private var pending = Data()
    private var eventData: [String] = []
    private var eventBytes = 0
    private(set) var answer = ""
    private(set) var done = false

    init(provider: String) { self.provider = provider }

    func append(_ data: Data) throws -> [String] {
        guard !done else { return [] }
        pending.append(data)
        var chunks: [String] = []
        while let newline = pending.firstIndex(of: 0x0a) {
            let length = pending.distance(from: pending.startIndex, to: newline)
            guard length <= Self.maximumLineBytes else { throw AssistantStreamError.tooLarge }
            var line = Data(pending.prefix(length))
            pending.removeFirst(length + 1)
            if line.last == 0x0d { line.removeLast() }
            guard let text = String(data: line, encoding: .utf8) else { throw AssistantStreamError.malformed }
            chunks += try consumeLine(text)
            if done { pending.removeAll(); break }
        }
        guard pending.count <= Self.maximumLineBytes else { throw AssistantStreamError.tooLarge }
        return chunks
    }

    func finish() throws -> [String] {
        var chunks: [String] = []
        if !done && !pending.isEmpty {
            guard let text = String(data: pending, encoding: .utf8) else { throw AssistantStreamError.malformed }
            pending.removeAll()
            chunks += try consumeLine(text.hasSuffix("\r") ? String(text.dropLast()) : text)
        }
        if provider == "deepseek" && !done && !eventData.isEmpty { chunks += try consumeEvent() }
        guard done, !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AssistantStreamError.malformed }
        return chunks
    }

    private func consumeLine(_ line: String) throws -> [String] {
        if provider == "ollama" {
            return line.trimmingCharacters(in: .whitespaces).isEmpty ? [] : try consumeJSON(line)
        }
        if line.isEmpty { return try consumeEvent() }
        if line.hasPrefix(":") { return [] }
        if line == "data" || line.hasPrefix("data:") {
            var value = line == "data" ? "" : String(line.dropFirst(5))
            if value.hasPrefix(" ") { value.removeFirst() }
            eventBytes += value.utf8.count + 1
            guard eventBytes <= Self.maximumLineBytes else { throw AssistantStreamError.tooLarge }
            eventData.append(value)
        }
        return []
    }

    private func consumeEvent() throws -> [String] {
        guard !eventData.isEmpty else { return [] }
        let value = eventData.joined(separator: "\n")
        eventData.removeAll(); eventBytes = 0
        if value.trimmingCharacters(in: .whitespacesAndNewlines) == "[DONE]" { done = true; return [] }
        return try consumeJSON(value)
    }

    private func consumeJSON(_ text: String) throws -> [String] {
        guard let object = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any], object["error"] == nil else {
            throw AssistantStreamError.malformed
        }
        let content: String?
        if provider == "deepseek" {
            guard let choices = object["choices"] as? [[String: Any]] else { throw AssistantStreamError.malformed }
            // Usage-only and reasoning-only events contain no display text.
            content = (choices.first?["delta"] as? [String: Any])?["content"] as? String
        } else {
            guard object["remote_host"] == nil, object["remote_model"] == nil else { throw AssistantStreamError.malformed }
            content = (object["message"] as? [String: Any])?["content"] as? String
            if object["done"] as? Bool == true { done = true }
        }
        guard let content, !content.isEmpty else { return [] }
        guard answer.utf8.count + content.utf8.count <= Self.maximumAnswerCharacters * 4 else { throw AssistantStreamError.tooLarge }
        answer += content
        guard answer.count <= Self.maximumAnswerCharacters else { throw AssistantStreamError.tooLarge }
        return [content]
    }
}
