import Foundation

// No default Keychain hooks and no real network requests are used in this fixture.
final class SyntheticTeamsAnalysisProtocol: URLProtocol {
    static let lock = NSLock()
    static var handler: ((SyntheticTeamsAnalysisProtocol) -> Void)?
    static var requests = [URLRequest]()
    static var stops = 0
    private let stateLock = NSRecursiveLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var copy = request
        if copy.httpBody == nil, let stream = copy.httpBodyStream {
            stream.open(); defer { stream.close() }; var body = Data(), bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let count = stream.read(&bytes, maxLength: bytes.count); if count <= 0 { break }; body.append(contentsOf: bytes.prefix(count)) }
            copy.httpBody = body
        }
        Self.lock.lock(); Self.requests.append(copy); let handler = Self.handler; Self.lock.unlock()
        handler?(self)
    }
    override func stopLoading() { stateLock.lock(); stopped = true; stateLock.unlock(); Self.lock.lock(); Self.stops += 1; Self.lock.unlock() }
    func respond(_ body: Data, status: Int = 200, headers: [String: String] = [:]) {
        stateLock.lock(); defer { stateLock.unlock() }; guard !stopped else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body); client?.urlProtocolDidFinishLoading(self)
    }
    func redirect() {
        client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: URL(string: "https://untrusted.example/collect")!), redirectResponse: HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": "https://untrusted.example/collect"])!)
    }
    static func reset(_ callback: @escaping (SyntheticTeamsAnalysisProtocol) -> Void) { lock.lock(); defer { lock.unlock() }; requests = []; stops = 0; handler = callback }
    static func captured() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    static func configuration() -> URLSessionConfiguration { let value = URLSessionConfiguration.ephemeral; value.protocolClasses = [Self.self]; return value }
}

@main struct TeamsAnalysisSmoke {
    static var checks = 0
    static let fingerprint = String(repeating: "a", count: 64)
    static let token = "synthetic-fixture-token"
    static func check(_ value: Bool, _ message: String) { guard value else { fputs("FAIL: \(message)\n", stderr); exit(1) }; checks += 1 }
    static func item(_ id: String = "item-1", text: String = "Read chapter 2 by Friday. Join the club on Saturday.") -> [String: Any] {
        ["id": id, "fingerprint": fingerprint, "title": "Class information", "channel": "Synthetic class", "publishedAt": "2026-11-12", "text": text, "sourceIncomplete": false]
    }
    static func request(_ items: [[String: Any]]? = nil, phase: String = "classify") -> [String: Any] {
        ["requestId": "teams-analysis-fixture-1", "phase": phase, "model": "deepseek-flash", "items": items ?? [item()]]
    }
    static func task() -> [String: Any] { ["category": "homework", "title": "Read chapter 2", "summary": "Read the specified chapter.", "evidence": "Read chapter 2 by Friday.", "deadlineText": "Friday"] }
    static func row(_ id: String = "item-1") -> [String: Any] { ["id": id, "summary": "Reading assignment and club information.", "classification": "actionable", "tasks": [task()]] }
    static func envelope(_ rows: [[String: Any]], finish: String = "stop") -> Data {
        let content = String(data: try! JSONSerialization.data(withJSONObject: ["results": rows]), encoding: .utf8)!
        return try! JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": finish, "message": ["content": content]]]])
    }
    static func rejects(_ body: [String: Any]) -> Bool { (try? TeamsAnalysisBatch(body)) == nil }
    static func run(_ batch: TeamsAnalysisBatch, key: @escaping () throws -> String = { token }) -> Result<[[String: Any]], TeamsAnalysisError> {
        let done = DispatchSemaphore(value: 0); var result: Result<[[String: Any]], TeamsAnalysisError>?
        let handle = TeamsAnalysisOperation(batch: batch, keyProvider: key, configuration: SyntheticTeamsAnalysisProtocol.configuration) { result = $0; done.signal() }.start()
        check(done.wait(timeout: .now() + 5) == .success, "Synthetic operation completes within bound")
        withExtendedLifetime(handle) {}
        return result!
    }
    static func code(_ result: Result<[[String: Any]], TeamsAnalysisError>) -> String? { if case .failure(let error) = result { return error.code }; return nil }

    static func main() throws {
        let batch = try TeamsAnalysisBatch(request())
        let fixedClock = ISO8601DateFormatter().date(from: "2032-04-20T08:00:00Z")!
        var spoofedClock = request(); spoofedClock["currentTime"] = "2099-01-01T00:00:00Z"
        let clockBatch = try TeamsAnalysisBatch(spoofedClock, now: fixedClock)
        check(clockBatch.source["currentTime"] as? String == "2032-04-20T08:00:00Z", "Analysis supplies the trusted clock rather than source/request claims")
        check(clockBatch.source["timezone"] as? String == "Asia/Shanghai", "Activity days use the school timezone")
        check(batch.instructions.contains("participationEvidence") && batch.instructions.contains("historical information") && batch.instructions.contains("Keep genuinely outstanding academic homework"), "Participation and ended-event constraints are sent with classification")
        let activityText = "All registered students must attend. Event time: 2032-04-21 13:00"
        let activityBatch = try TeamsAnalysisBatch(request([item(text: activityText)]), now: fixedClock)
        var policyActivity = task(); policyActivity["category"] = "activity"; policyActivity["evidence"] = "All registered students must attend."
        policyActivity["deadlineText"] = "2032-04-21 13:00"; policyActivity["participationEvidence"] = "All registered students must attend."
        var activityRow = row(); activityRow["tasks"] = [policyActivity]
        let admitted = try activityBatch.decode(envelope([activityRow]))
        check((admitted[0]["tasks"] as? [[String: String]])?.first?["participationEvidence"] == "All registered students must attend.", "Exact participation evidence survives transport for local admission")
        policyActivity["participationEvidence"] = "The user registered yesterday."
        activityRow["tasks"] = [policyActivity]
        check((try? activityBatch.decode(envelope([activityRow]))) == nil, "Invented participation evidence is rejected")
        check(TeamsAnalysisBatch.effectiveModel(settings: ["aiModel": "ollama-local"]) == "deepseek-flash", "Non-DeepSeek chat models cannot redirect classification")
        check(TeamsAnalysisBatch.effectiveModel(settings: ["aiModel": "deepseek-v4-pro"]) == "deepseek-v4-pro", "Valid selected DeepSeek model is reused")
        for field in ["requestId", "phase", "model", "items"] { var bad = request(); bad[field] = NSNull(); check(rejects(bad), "Missing request contract field rejected") }
        check(rejects(request(Array(repeating: item(), count: 9))), "More than eight items rejected")
        check(rejects(request([item(), item()])), "Duplicate IDs rejected before upload")
        check(rejects(request([item(text: String(repeating: "x", count: 32_001))])), "One oversized item rejected")
        check(rejects(request([item("one", text: String(repeating: "x", count: 24_001)), item("two", text: String(repeating: "x", count: 24_000))])), "Total text budget checked")
        check(rejects(request([item(text: String(repeating: "😋", count: 16_001))])), "Text limits use JavaScript-compatible UTF-16 units")
        for (field, value) in [("fingerprint", "invented" as Any), ("sourceIncomplete", 1 as Any), ("title", String(repeating: "x", count: 501) as Any), ("id", "bad\nid" as Any)] {
            var bad = item(); bad[field] = value; check(rejects(request([bad])), "Malformed item metadata rejected")
        }

        let output = try batch.decode(envelope([row()]))
        check(output.count == 1 && output[0]["fingerprint"] as? String == fingerprint, "Fingerprint comes from native input, not the model")
        var metadataOnly = item(text: "School announcements are now available.")
        metadataOnly["channel"] = "Read chapter 2 by Friday."
        let metadataBatch = try TeamsAnalysisBatch(request([metadataOnly]))
        check((try? metadataBatch.decode(envelope([row()]))) == nil, "A channel name cannot be the only evidence for an assignment")
        var publicationDeadline = task(); publicationDeadline["deadlineText"] = "2026-11-12"
        var publicationRow = row(); publicationRow["tasks"] = [publicationDeadline]
        check((try? batch.decode(envelope([publicationRow]))) == nil, "A publication timestamp cannot be reused as a deadline quote")
        let pair = try TeamsAnalysisBatch(request([item("one"), item("two")]))
        check(try pair.decode(envelope([row("two"), row("one")])).map { $0["id"] as! String } == ["one", "two"], "Exact ID sets may arrive reordered but return in input order")
        for phase in ["summarize", "classify"] { check((try TeamsAnalysisBatch(request(phase: phase)).decode(envelope([row()]))).count == 1, "Both phases share the same verified result schema") }
        var mixed = row(); var activity = task(); activity["category"] = "activity"; activity["title"] = "Join the club"; activity["evidence"] = "Join the club on Saturday."; activity["deadlineText"] = "Saturday"; mixed["tasks"] = [task(), activity]
        check(try batch.decode(envelope([mixed]))[0]["tasks"] as? [[String: String]] != nil, "One message may contain homework and activity")
        for classification in ["notice", "uncertain"] { var value = row(); value["classification"] = classification; value["tasks"] = [[String: Any]](); check((try? batch.decode(envelope([value]))) != nil, "Non-actionable information remains a task-free record") }
        var invalidRows = [[String: Any]]()
        for (key, value) in [("id", "unknown" as Any), ("classification", "assignment" as Any), ("summary", "" as Any), ("summary", String(repeating: "s", count: 1201) as Any), ("tasks", [[String: Any]]() as Any), ("fingerprint", "model-controlled" as Any)] { var bad = row(); bad[key] = value; invalidRows.append(bad) }
        var notice = row(); notice["classification"] = "notice"; invalidRows.append(notice)
        var tooMany = row(); tooMany["tasks"] = Array(repeating: task(), count: 9); invalidRows.append(tooMany)
        for (key, value) in [("category", "other"), ("title", ""), ("evidence", "Submit an invented assignment"), ("deadlineText", "2099-01-01"), ("url", "https://evil.example"), ("summary", String(repeating: "x", count: 501))] { var badTask = task(); badTask[key] = value; var bad = row(); bad["tasks"] = [badTask]; invalidRows.append(bad) }
        for bad in invalidRows { check((try? batch.decode(envelope([bad]))) == nil, "Invalid structured result produces no tasks") }
        check((try? pair.decode(envelope([row("one"), row("one")]))) == nil, "Duplicate result cannot replace a missing item")
        check((try? batch.decode(envelope([row()], finish: "length"))) == nil, "Token-truncated completion is rejected even if its JSON parses")
        for content in ["   ", "not JSON", "{\"results\":[]}"] {
            let data = try JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": "stop", "message": ["content": content]]]])
            check((try? batch.decode(data)) == nil, "Blank, malformed and incomplete result rejected")
        }

        SyntheticTeamsAnalysisProtocol.reset { $0.respond(envelope([row()])) }
        check(code(run(batch)) == nil, "Valid structured HTTP response succeeds")
        let captured = SyntheticTeamsAnalysisProtocol.captured(); check(captured.count == 1, "One operation sends exactly one request")
        let sent = captured[0], payload = try JSONSerialization.jsonObject(with: sent.httpBody!) as! [String: Any]
        check(sent.url?.absoluteString == "https://api.deepseek.com/chat/completions" && sent.httpMethod == "POST", "Only the fixed DeepSeek endpoint is used")
        check(sent.value(forHTTPHeaderField: "Authorization") == "Bearer " + token && !sent.httpShouldHandleCookies, "Synthetic key stays in the header and cookies are disabled")
        check(payload["stream"] as? Bool == false && (payload["response_format"] as? [String: String])?["type"] == "json_object" && (payload["thinking"] as? [String: String])?["type"] == "disabled", "Structured, non-thinking, nonstreaming request contract")
        check(payload["tools"] == nil && payload["max_tokens"] as? Int == 32768, "No tools and bounded output allocation")
        for (status, expected) in [(401,"unauthorized"),(403,"unauthorized"),(402,"insufficientBalance"),(404,"modelUnavailable"),(429,"rateLimited"),(503,"serviceUnavailable")] {
            SyntheticTeamsAnalysisProtocol.reset { $0.respond(Data("private error must not export".utf8), status: status, headers: ["Retry-After": "120"]) }
            let result = run(batch); check(code(result) == expected && SyntheticTeamsAnalysisProtocol.captured().count == 1, "HTTP rejection never retries or falls back")
            if case .failure(let error) = result { check(!error.message.contains("private error"), "Only display-safe errors leave native transport"); if status == 429 || status == 503 { check(error.retryAfterSeconds == 120, "Server cooldown is preserved") } }
        }
        SyntheticTeamsAnalysisProtocol.reset { $0.respond(Data(), headers: ["Content-Length": "524289"]) }
        check(code(run(batch)) == "badResponse", "Advertised oversized response is rejected")
        SyntheticTeamsAnalysisProtocol.reset { $0.respond(Data(repeating: 32, count: 524_289)) }
        check(code(run(batch)) == "badResponse", "Streaming byte cap also rejects unadvertised oversized response")
        SyntheticTeamsAnalysisProtocol.reset { $0.redirect() }
        check(code(run(batch)) == "badResponse" && SyntheticTeamsAnalysisProtocol.captured().count == 1, "Redirect cannot forward a credential to another host")
        SyntheticTeamsAnalysisProtocol.reset { _ in fatalError("Missing-key request must not contact HTTP transport") }
        check(code(run(batch, key: { throw AssistantError.missingKey })) == "missingKey" && SyntheticTeamsAnalysisProtocol.captured().isEmpty, "Missing key returns without network activity")
        check(TeamsAnalysisOperation.retrySeconds("999999999999") == 86400 && TeamsAnalysisOperation.retrySeconds("-5") == 1 && TeamsAnalysisOperation.retrySeconds("nonsense") == nil, "Retry values are finite and bounded")
        check(TeamsAnalysisOperation.retrySeconds("Thu, 12 Nov 2026 10:01:00 GMT", now: Date(timeIntervalSince1970: 1794477600)) == 60, "HTTP-date Retry-After is parsed")

        let started = DispatchSemaphore(value: 0), done = DispatchSemaphore(value: 0), callbackLock = NSLock(); var completions = 0, cancelledCode: String?
        SyntheticTeamsAnalysisProtocol.reset { _ in started.signal() }
        let handle = TeamsAnalysisOperation(batch: batch, keyProvider: { token }, configuration: SyntheticTeamsAnalysisProtocol.configuration) { result in callbackLock.lock(); completions += 1; cancelledCode = code(result); callbackLock.unlock(); done.signal() }.start()
        check(started.wait(timeout: .now() + 3) == .success, "Cancellable request began")
        handle.cancel(); handle.cancel(); check(done.wait(timeout: .now() + 3) == .success, "Cancel completes asynchronously")
        check(done.wait(timeout: .now() + 0.05) == .timedOut, "Repeated cancel cannot complete twice")
        callbackLock.lock(); let cancellationCorrect = completions == 1 && cancelledCode == "cancelled"; callbackLock.unlock(); check(cancellationCorrect, "Cancellation returns one terminal error and no tasks")

        var boundary = TeamsAnalysisWorkBoundary(), stateBoundary = CampusStateBridgeBoundary()
        let settings: [String: Any] = ["teamsAnalysisEnabled": true]
        check(boundary.admissionError(settings: settings, model: batch.model, chatBusy: true, suspended: false, keyRecovery: false)?.code == "busy", "Active chat defers analysis without creating or cancelling work")
        check(boundary.admissionError(settings: [:], model: batch.model, chatBusy: false, suspended: false, keyRecovery: false)?.code == "disabled", "Background upload requires saved consent")
        check(boundary.admissionError(settings: settings, model: batch.model, chatBusy: false, suspended: true, keyRecovery: false)?.code == "busy", "Sleeping app cannot start a new analysis")
        for reason in 0..<4 {
            let ticket = boundary.begin(batch, generation: 1, account: "account-a")!
            check(!boundary.finish(ticket, generation: reason == 0 ? 2 : 1, account: reason == 1 ? "account-b" : "account-a", model: reason == 2 ? "deepseek-v4-pro" : batch.model, enabled: reason != 3), "Changed generation/account/model/consent rejects the original result")
        }
        let old = boundary.begin(batch, generation: 1, account: "account-a")!; boundary.cancel()
        let current = boundary.begin(batch, generation: 2, account: "account-b")!
        check(!boundary.finish(old, generation: 2, account: "account-b", model: batch.model, enabled: true) && boundary.owns(current), "Late cancelled callback cannot clear a newer request")
        check(boundary.begin(batch, generation: 2, account: "account-b") == nil, "Only one native analysis is in flight")
        check(boundary.finish(current, generation: 2, account: "account-b", model: batch.model, enabled: true), "Current account and generation may receive the result")
        stateBoundary.replaceState(); check(!stateBoundary.allowsDelivery(type: "teamsAnalysisResult", generation: 0), "Event encoding also rejects old-generation results")
        print("PASS: Teams analysis \(checks) synthetic native checks; no real Keychain or network")
    }
}
