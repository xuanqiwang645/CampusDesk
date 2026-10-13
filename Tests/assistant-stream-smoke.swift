import Foundation

/// URLProtocol intercepts every request; these tests cannot contact either real
/// endpoint and supply synthetic credentials without opening the Keychain.
private final class SyntheticAssistantProtocol: URLProtocol {
    static let lock = NSLock()
    static var handler: ((SyntheticAssistantProtocol) -> Void)?
    static var requests: [URLRequest] = []
    static var stopCount = 0
    private let stateLock = NSRecursiveLock()
    private var stopped = false
    private(set) var receivedRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var captured = request
        if captured.httpBody == nil, let stream = captured.httpBodyStream {
            stream.open(); defer { stream.close() }
            var data = Data(), bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                guard count > 0 else { break }
                data.append(contentsOf: bytes.prefix(count))
            }
            captured.httpBody = data
        }
        receivedRequest = captured
        Self.lock.lock(); Self.requests.append(captured); let handler = Self.handler; Self.lock.unlock()
        handler?(self)
    }
    override func stopLoading() {
        stateLock.lock(); stopped = true; stateLock.unlock()
        Self.lock.lock(); Self.stopCount += 1; Self.lock.unlock()
    }
    func send(_ body: String, status: Int = 200, type: String = "application/json", finish: Bool = true) {
        headers(status: status, type: type)
        bytes(Data(body.utf8))
        if finish { end() }
    }
    func headers(status: Int = 200, type: String = "text/event-stream", length: Int? = nil) {
        stateLock.lock(); defer { stateLock.unlock() }
        guard !stopped else { return }
        var fields = ["Content-Type": type]
        if let length { fields["Content-Length"] = String(length) }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!, cacheStoragePolicy: .notAllowed)
    }
    func bytes(_ data: Data) {
        stateLock.lock(); defer { stateLock.unlock() }
        if !stopped { client?.urlProtocol(self, didLoad: data) }
    }
    func end() {
        stateLock.lock(); defer { stateLock.unlock() }
        if !stopped { client?.urlProtocolDidFinishLoading(self) }
    }
    func fail() {
        stateLock.lock(); defer { stateLock.unlock() }
        if !stopped { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)) }
    }
    static func setup(_ handler: @escaping (SyntheticAssistantProtocol) -> Void) {
        lock.lock(); defer { lock.unlock() }
        requests = []; stopCount = 0; Self.handler = handler
    }
    static func captured() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SyntheticAssistantProtocol.self]
        return configuration
    }
}

@main
struct AssistantStreamSmokeTests {
    static var passed = 0
    static let localJSON = "{\"details\":{\"format\":\"gguf\"},\"model_info\":{\"general.architecture\":\"qwen3\"},\"capabilities\":[\"completion\"]}"
    static let localReply = "{\"message\":{\"content\":\"本机\"},\"done\":false}\n{\"message\":{\"content\":\"回答\"},\"done\":true}\n"
    static func check(_ value: Bool, _ label: String) {
        guard value else { fputs("FAIL: \(label)\n", stderr); exit(1) }
        passed += 1
    }
    static func frame(_ text: String) -> String {
        let json: [String: Any] = ["choices": [["delta": ["content": text]]]]
        return "data: " + String(data: try! JSONSerialization.data(withJSONObject: json), encoding: .utf8)! + "\n\n"
    }
    static func error(_ result: Result<AssistantReply, AssistantError>) -> AssistantError? {
        if case .failure(let error) = result { return error }; return nil
    }
    private static func run(provider: String = "deepseek", model: String = "deepseek-flash", localModel: String = "qwen3:8b", online: Bool = true,
                    cancelAfterChunk: Bool = false, handler: @escaping (SyntheticAssistantProtocol) -> Void) -> (Result<AssistantReply, AssistantError>, [String]) {
        SyntheticAssistantProtocol.setup(handler)
        let done = DispatchSemaphore(value: 0), firstChunk = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var result: Result<AssistantReply, AssistantError>?, chunks: [String] = [], completions = 0
        let operation = AssistantRequestOperation(provider: provider, model: model, fallbackModel: localModel,
            networkAvailable: online, messages: [["role": "user", "content": "SYNTHETIC_QUESTION_ONLY"]],
            keyProvider: { "synthetic-not-a-real-key" }, configuration: SyntheticAssistantProtocol.configuration,
            onChunk: { chunk in lock.lock(); chunks.append(chunk.text); lock.unlock(); firstChunk.signal() }) { value in
                lock.lock(); result = value; completions += 1; lock.unlock(); done.signal()
            }
        let handle = operation.start()
        if cancelAfterChunk {
            check(firstChunk.wait(timeout: .now() + 5) == .success, "The first chunk is delivered before HTTP completion")
            handle.cancel(); handle.cancel()
        }
        check(done.wait(timeout: .now() + 5) == .success, "Request completes within the synthetic test deadline")
        check(done.wait(timeout: .now() + 0.03) == .timedOut, "Completion is called only once")
        lock.lock(); defer { lock.unlock() }
        check(completions == 1, "Completion count remains one")
        return (result!, chunks)
    }

    static func main() throws {
        let sse = AssistantStreamDecoder(provider: "deepseek")
        let stream = ": keepalive\r\n\r\n" + frame("你🙂") + "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"hidden\"}}]}\n\n" + frame("好") + "data: [DONE]\r\n\r\n"
        var pieces: [String] = []
        for byte in Data(stream.utf8) { pieces += try sse.append(Data([byte])) }
        _ = try sse.finish()
        check(pieces.joined() == "你🙂好" && sse.answer == "你🙂好", "SSE survives bytewise UTF-8 and CRLF splits without exposing reasoning")
        let ndjson = AssistantStreamDecoder(provider: "ollama")
        for byte in Data(localReply.utf8) { _ = try ndjson.append(Data([byte])) }
        _ = try ndjson.finish()
        check(ndjson.answer == "本机回答", "Ollama NDJSON preserves Unicode and its terminal chunk")
        let truncated = AssistantStreamDecoder(provider: "deepseek")
        _ = try truncated.append(Data(frame("partial").utf8))
        do { _ = try truncated.finish(); check(false, "Truncated stream must fail") } catch { check(true, "Missing terminal marker is rejected") }
        do { _ = try AssistantStreamDecoder(provider: "ollama").append(Data(repeating: 65, count: AssistantStreamDecoder.maximumLineBytes + 1)); check(false, "Long line must fail") }
        catch { check(true, "Streaming line size is bounded") }
        do { _ = try AssistantStreamDecoder(provider: "deepseek").append(Data(frame(String(repeating: "x", count: 100_001)).utf8)); check(false, "Long answer must fail") }
        catch { check(true, "Accumulated answer size is bounded") }

        let cloud = run { connection in connection.send(frame("Hello ") + frame("world") + "data: [DONE]\n\n", type: "text/event-stream") }
        if case .success(let reply) = cloud.0 { check(reply.answer == "Hello world" && reply.providerUsed == "deepseek", "Cloud response is incrementally assembled") }
        else { check(false, "Cloud synthetic stream succeeds") }
        check(cloud.1 == ["Hello ", "world"], "Each cloud delta is delivered separately")
        let cloudRequest = SyntheticAssistantProtocol.captured().first!
        check(cloudRequest.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-not-a-real-key", "Only the supplied synthetic key is used")
        check(cloudRequest.timeoutInterval == 90, "Normal stream has an idle timeout")
        check((try JSONSerialization.jsonObject(with: cloudRequest.httpBody!) as? [String: Any])?["stream"] as? Bool == true, "Inference explicitly requests a stream")

        let local = run(provider: "ollama", model: "qwen3:8b") { connection in
            connection.send(connection.request.url!.path == "/api/show" ? localJSON : localReply)
        }
        if case .success(let reply) = local.0 { check(reply.answer == "本机回答" && reply.providerUsed == "ollama", "Local verified model streams a reply") }
        else { check(false, "Local synthetic stream succeeds") }
        check(SyntheticAssistantProtocol.captured().map { $0.url!.path } == ["/api/show", "/api/chat"], "Local metadata is verified before any question is sent")
        check(SyntheticAssistantProtocol.captured().allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil }, "Local requests never receive the DeepSeek key")

        let remoteAlias = run(provider: "ollama", model: "innocent-alias") { connection in
            connection.send("{\"remote_host\":\"https://ollama.com\",\"remote_model\":\"large-cloud-model\",\"details\":{\"format\":\"gguf\"},\"model_info\":{\"general.architecture\":\"llama\"}}")
        }
        check(error(remoteAlias.0) == .localModelNotLocal, "A cloud alias fails closed before inference")
        check(SyntheticAssistantProtocol.captured().map { $0.url!.path } == ["/api/show"], "A rejected alias never receives the question")
        let namedCloud = run(provider: "ollama", model: "gpt-oss:120b-cloud") { _ in check(false, "Cloud names must not make requests") }
        check(error(namedCloud.0) == .localModelNotLocal && SyntheticAssistantProtocol.captured().isEmpty, "Known cloud model names are rejected without network requests")

        let fallback = run(provider: "hybrid") { connection in
            if connection.request.url!.host == "api.deepseek.com" { connection.fail() }
            else { connection.send(connection.request.url!.path == "/api/show" ? localJSON : localReply) }
        }
        if case .success(let reply) = fallback.0 { check(reply.providerUsed == "ollama" && reply.fallbackReason == "deepseekUnavailable", "Network failure before output falls back to a verified local model") }
        else { check(false, "Hybrid early failure should fall back") }
        check(SyntheticAssistantProtocol.captured().count == 3, "Fallback has one cloud attempt, metadata check, and local inference")

        let lateFailure = run(provider: "hybrid") { connection in
            connection.send(frame("Partial answer"), type: "text/event-stream", finish: false)
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.03) { connection.fail() }
        }
        check(error(lateFailure.0) == .network && lateFailure.1 == ["Partial answer"], "A failure after output preserves the partial stream and reports failure")
        check(SyntheticAssistantProtocol.captured().count == 1, "No local resend occurs after output has begun")

        let cancelled = run(provider: "hybrid", cancelAfterChunk: true) { connection in
            connection.send(frame("First chunk"), type: "text/event-stream", finish: false)
        }
        check(error(cancelled.0) == .cancelled, "Explicit stop completes with cancelled")
        check(SyntheticAssistantProtocol.captured().count == 1, "Cancellation never starts a fallback")
        SyntheticAssistantProtocol.lock.lock(); let stopped = SyntheticAssistantProtocol.stopCount; SyntheticAssistantProtocol.lock.unlock()
        check(stopped > 0, "Stopping actually cancels the URLSession task")

        let oversized = run { connection in connection.headers(length: 2_000_001) }
        check(error(oversized.0) == .badResponse && oversized.1.isEmpty, "Oversized response headers are rejected before reading the body")
        let incomplete = run { connection in connection.send(frame("No terminal marker"), type: "text/event-stream") }
        check(error(incomplete.0) == .badResponse, "A successful HTTP EOF does not hide a truncated response")

        let offline = run(provider: "hybrid", online: false) { connection in connection.send(connection.request.url!.path == "/api/show" ? localJSON : localReply) }
        if case .success(let reply) = offline.0 { check(reply.fallbackReason == "offline", "Offline hybrid routing remains local") }
        else { check(false, "Offline hybrid succeeds with local metadata") }
        check(SyntheticAssistantProtocol.captured().allSatisfy { $0.url!.host == "127.0.0.1" }, "Offline hybrid never contacts a cloud endpoint")

        SyntheticAssistantProtocol.setup { connection in
            if connection.request.url!.path == "/api/tags" {
                connection.send("{\"models\":[{\"name\":\"qwen3:8b\"},{\"name\":\"safe-looking-alias\"},{\"name\":\"other-alias\",\"remote_host\":\"https://ollama.com\"},{\"name\":\"gpt-oss:120b-cloud\"}]}")
            } else {
                let data = connection.receivedRequest?.httpBody ?? Data()
                let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
                connection.send(value?["model"] == "qwen3:8b" ? localJSON : "{\"remote_model\":\"cloud-model\"}")
            }
        }
        let catalogDone = DispatchSemaphore(value: 0)
        var catalog: [String] = []
        CampusAssistantModels.list(provider: "ollama", key: nil, configuration: SyntheticAssistantProtocol.configuration) { result in
            if case .success(let models) = result { catalog = models }; catalogDone.signal()
        }
        check(catalogDone.wait(timeout: .now() + 5) == .success, "Local catalog metadata verification finishes")
        check(catalog == ["qwen3:8b"], "The selectable catalog excludes remote aliases even if /tags omits their remote metadata")
        print("PASS: \(passed) assistant streaming, cancellation, fallback, and local-only checks")
    }
}
