import Foundation
import JavaScriptCore

// No default Keychain hooks and no real network requests are used in this fixture.
final class SyntheticTaskReviewProtocol: URLProtocol {
    static let lock = NSLock()
    static var handler: ((SyntheticTaskReviewProtocol) -> Void)?
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
    static func reset(_ callback: @escaping (SyntheticTaskReviewProtocol) -> Void) { lock.lock(); defer { lock.unlock() }; requests = []; stops = 0; handler = callback }
    static func captured() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    static func configuration() -> URLSessionConfiguration { let value = URLSessionConfiguration.ephemeral; value.protocolClasses = [Self.self]; return value }
}

@main struct TaskReviewSmoke {
    static var checks = 0
    static func check(_ value: Bool, _ message: String) { guard value else { fputs("FAIL: \(message)\n", stderr); exit(1) }; checks += 1 }
    static func item(_ id: String = "manual-1") -> [String: Any] {
        ["id": id, "title": "Synthetic reading", "category": "homework", "dueAt": "2026-11-13T08:00:00.000Z", "course": "Synthetic class", "summary": "Read chapter 2."]
    }
    static func request(_ items: [[String: Any]]? = nil) -> [String: Any] {
        ["requestId": "task-review-fixture-1", "model": "deepseek-flash", "currentTime": "2026-11-12T08:00:00.000Z", "items": items ?? [item()]]
    }
    static func report(_ id: String = "manual-1") -> [String: Any] {
        ["summary": "Prepare the reading before the stated deadline.", "recommendations": [["id": id, "reason": "Its stated deadline is tomorrow."]]]
    }
    static func envelope(_ result: [String: Any], finish: String = "stop") -> Data {
        let content = String(decoding: try! JSONSerialization.data(withJSONObject: result), as: UTF8.self)
        return try! JSONSerialization.data(withJSONObject: ["choices": [["finish_reason": finish, "message": ["content": content]]]])
    }
    static func rejects(_ body: [String: Any]) -> Bool { (try? TaskReviewBatch(body)) == nil }
    static func run(_ batch: TaskReviewBatch) -> Result<[String: Any], TeamsAnalysisError> {
        let done = DispatchSemaphore(value: 0); var result: Result<[String: Any], TeamsAnalysisError>?
        let handle = CampusDeepSeekJSONOperation(batch: batch, keyProvider: { "synthetic-fixture-key" }, configuration: SyntheticTaskReviewProtocol.configuration) {
            result = $0; done.signal()
        }.start()
        check(done.wait(timeout: .now() + 5) == .success, "Review completes within the fixture timeout")
        withExtendedLifetime(handle) {}; return result!
    }
    static func main() throws {
        let batch = try TaskReviewBatch(request())
        check(batch.items.count == 1, "A bounded nonempty review is accepted")
        var activity = item("activity-1"); activity["category"] = "activity"; activity["dueAt"] = ""
        check(!rejects(request([activity])), "Activities and unknown deadlines stay distinct")
        for field in ["requestId", "model", "currentTime", "items"] { var value = request(); value[field] = NSNull(); check(rejects(value), "Missing request field is rejected before upload") }
        for (field, value) in [("id", "bad\nid"), ("title", "  "), ("title", String(repeating: "x", count: 501)), ("summary", String(repeating: "😋", count: 401)), ("course", String(repeating: "x", count: 301)), ("category", "newtask"), ("dueAt", "Friday"), ("url", "https://unexpected.example/")] {
            var row = item(); row[field] = value; check(rejects(request([row])), "Invalid task data is rejected")
        }
        check(rejects(request([])) && rejects(request([item(), item()])), "Empty reviews and duplicate task IDs are rejected")
        check(!rejects(request((1...100).map { item("task-\($0)") })), "Exactly 100 compact tasks fit")
        check(rejects(request((1...101).map { item("task-\($0)") })), "101 tasks are rejected")
        check(rejects(request((1...100).map { i in var row = item("task-\(i)"); row["summary"] = String(repeating: "x", count: 800); return row })), "Serialized text budget is enforced across tasks")
        var wrongModel = request(); wrongModel["model"] = "ollama-local"; check(rejects(wrongModel), "Reviews never route to a non-DeepSeek provider")

        check(try batch.decode(envelope(report()))["summary"] as? String == report()["summary"] as? String, "Valid review returns its bounded summary")
        var empty = report(); empty["recommendations"] = [[String: String]](); check((try? batch.decode(envelope(empty))) != nil, "Review may recommend no task")
        for (field, value) in [("summary", "" as Any), ("summary", String(repeating: "x", count: 1201) as Any), ("tasks", [item()] as Any), ("recommendations", [["id": "missing", "reason": "invented"]] as Any), ("recommendations", [["id": "manual-1", "reason": "" ]] as Any), ("recommendations", [["id": "manual-1", "reason": String(repeating: "r", count: 301)]] as Any), ("recommendations", [["id": "manual-1", "reason": "reason", "completed": true]] as Any), ("recommendations", Array(repeating: ["id": "manual-1", "reason": "reason"], count: 2) as Any)] {
            var value2 = report(); value2[field] = value; check((try? batch.decode(envelope(value2))) == nil, "Invalid review never becomes a recommendation")
        }
        let four = try TaskReviewBatch(request((1...4).map { item("task-\($0)") }))
        let allFour: [String: Any] = ["summary": "summary", "recommendations": (1...4).map { ["id": "task-\($0)", "reason": "reason"] }]
        check((try? four.decode(envelope(allFour))) == nil, "More than three recommendations is rejected")
        check((try? batch.decode(envelope(report(), finish: "length"))) == nil, "Truncated JSON cannot count as success")
        check((try? batch.decode(Data("not-json".utf8))) == nil, "Malformed response fails closed")

        SyntheticTaskReviewProtocol.reset { $0.respond(envelope(report())) }
        guard case .success = run(batch) else { check(false, "Synthetic review succeeds"); return }
        let captured = SyntheticTaskReviewProtocol.captured(); check(captured.count == 1, "Review sends one request")
        let payload = try JSONSerialization.jsonObject(with: captured[0].httpBody!) as! [String: Any]
        check(captured[0].url?.absoluteString == "https://api.deepseek.com/chat/completions", "Review uses the same fixed endpoint")
        check(payload["max_tokens"] as? Int == 4096 && payload["stream"] as? Bool == false && payload["tools"] == nil, "Review output budget and capabilities are bounded")
        check((payload["response_format"] as? [String: String])?["type"] == "json_object", "Review asks for JSON")
        let messages = payload["messages"] as! [[String: String]], sentInput = try JSONSerialization.jsonObject(with: Data(messages[1]["content"]!.utf8)) as! [String: Any]
        check(sentInput["currentTime"] as? String == batch.currentTime && (sentInput["items"] as? [Any])?.count == 1, "Only bounded input and context are uploaded")
        for (status, expected) in [(401, "unauthorized"), (403, "unauthorized"), (402, "insufficientBalance"), (429, "rateLimited"), (503, "serviceUnavailable")] {
            SyntheticTaskReviewProtocol.reset { $0.respond(Data("untrusted-error".utf8), status: status, headers: ["Retry-After": "45"]) }
            guard case .failure(let error) = run(batch) else { check(false, "HTTP error must fail"); return }
            check(error.code == expected && !error.message.contains("untrusted-error") && SyntheticTaskReviewProtocol.captured().count == 1, "No fallback or unsafe error body after rejection")
            if status == 429 || status == 503 { check(error.retryAfterSeconds == 45, "Review shares provider backoff") }
        }

        let settings: [String: Any] = ["taskReviewEnabled": true, "aiModel": "deepseek-flash"]
        var work = TaskReviewWorkBoundary()
        check(work.admissionError(settings: settings, model: batch.model, otherBusy: false, suspended: false, keyRecovery: false) == nil, "Enabled idle review is admitted")
        check(work.admissionError(settings: [:], model: batch.model, otherBusy: false, suspended: false, keyRecovery: false)?.code == "disabled", "Consent is required independently of Teams analysis")
        check(work.admissionError(settings: settings, model: batch.model, otherBusy: true, suspended: false, keyRecovery: false)?.code == "busy", "Chat or Teams work defers review")
        check(work.admissionError(settings: settings, model: batch.model, otherBusy: false, suspended: true, keyRecovery: false)?.code == "busy", "Sleeping app does not send a review")
        check(work.admissionError(settings: settings, model: batch.model, otherBusy: false, suspended: false, keyRecovery: true)?.code == "keyAccess", "Background review cannot prompt to unlock credentials")
        let ticket = work.begin(batch, generation: 3, account: "account-a")!
        check(work.begin(batch, generation: 3, account: "account-a") == nil, "Only one review is active")
        work.cancel(); let newTicket = work.begin(batch, generation: 3, account: "account-a")!
        check(!work.finish(ticket, generation: 3, account: "account-a", model: batch.model, enabled: true) && work.owns(newTicket), "Old callback cannot finish replacement review")
        for mismatch in 0..<4 {
            var boundary = TaskReviewWorkBoundary(); let t = boundary.begin(batch, generation: 3, account: "account-a")!
            check(!boundary.finish(t, generation: mismatch == 0 ? 4 : 3, account: mismatch == 1 ? "account-b" : "account-a", model: mismatch == 2 ? "deepseek-v4-pro" : batch.model, enabled: mismatch != 3), "Generation/account/model/disable change invalidates results")
        }
        check(work.finish(newTicket, generation: 3, account: "account-a", model: batch.model, enabled: true), "Matching review can finish once")

        func consume(_ receipt: inout TaskReviewNotificationReceipt, id: String = "task-review-fixture-1", ids: [String] = ["manual-1"], generation: Int = 3, account: String = "account-a", model: String = "deepseek-flash", enabled: Bool = true, unfinished: [String: String] = ["manual-1": "Current trusted title"]) -> (summary: String, titles: [String])? {
            receipt.consume(requestID: id, taskIDs: ids, generation: generation, account: account, model: model, enabled: enabled, unfinished: unfinished)
        }
        var receipt = TaskReviewNotificationReceipt(ticket: ticket, result: try batch.decode(envelope(report())))
        check(consume(&receipt, id: "other-request") == nil, "Notification must name its completed request")
        check(consume(&receipt, ids: ["invented"]) == nil && consume(&receipt, ids: ["manual-1", "manual-1"]) == nil && consume(&receipt, ids: []) == nil, "Only distinct recommended IDs may notify")
        check(consume(&receipt, generation: 4) == nil && consume(&receipt, account: "new-account") == nil && consume(&receipt, model: "deepseek-v4-pro") == nil, "Receipt is isolated from new state/account/model")
        check(consume(&receipt, enabled: false) == nil && consume(&receipt, unfinished: [:]) == nil, "Disabled or no-longer-open task cannot notify")
        let notification = consume(&receipt)
        check(notification?.titles == ["Current trusted title"] && notification?.summary == report()["summary"] as? String, "Notification uses native result and trusted current titles")
        check(consume(&receipt) == nil, "Completed review can notify at most once")
        for type in ["taskReviewTick", "taskReviewResult"] { check(CampusStateBridgeBoundary.isolatesEvent(type), "Review event is generation-scoped") }
        for action in ["taskReviewAnalyze", "taskReviewCancel", "taskReviewNotify"] { check(CampusStateBridgeBoundary.requiresCurrentState(action), "Review command requires current state") }

        let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
        let validator = try CampusStateValidator(resources: root.appendingPathComponent("Resources"), themeEdition: true)
        var state = try validator.validate(["version": 1, "settings": [String: Any](), "snapshots": ["seiue": [String: Any](), "managebac": [String: Any](), "teams": [String: Any]()], "manualTasks": [Any](), "taskChecks": [String: Any](), "feedbackRead": [String: Any](), "gradeHistory": [Any]()])
        state["manualTasks"] = [["id": "manual-1", "title": "Current trusted title", "course": "个人待办", "status": "open", "createdAt": "2026-11-12T08:00:00Z"]]
        state = try validator.validate(state)
        check(try validator.unfinishedTasks(state, among: ["manual-1"]) == ["manual-1": "Current trusted title"], "Native recheck uses actual Core task list")
        // Generate receipts with the real Core implementation rather than
        // reproducing its hash contract in Swift.
        let fixtureJS = JSContext()!
        fixtureJS.setObject(true, forKeyedSubscript: "CampusDeskThemeEdition" as NSString)
        fixtureJS.evaluateScript(try String(contentsOf: root.appendingPathComponent("Resources/core.js"), encoding: .utf8))
        fixtureJS.evaluateScript("""
        function makeReviewedFixture(encoded) {
          const state = JSON.parse(encoded);
          state.taskReview = {lastAttemptAt:'2026-11-12T08:00:00Z', lastCompletedAt:'2026-11-12T08:01:00Z',
            summary:'Existing review must remain in the saved state.', error:'',
            recommendations:[{id:'manual-1', reason:'Review the supplied assignment.'}],
            inputFingerprint:CampusCore.taskReviewInputFingerprint(CampusCore.getTasks(state), CampusCore.teamsAnalysisModel(state))};
          return JSON.stringify(state);
        }
        """)
        func reviewedFixture(_ source: [String: Any]) throws -> [String: Any] {
            let encoded = String(decoding: try CampusStateValidator.encode(source), as: UTF8.self)
            guard let result = fixtureJS.objectForKeyedSubscript("makeReviewedFixture")?.call(withArguments: [encoded])?.toString(),
                  fixtureJS.exception == nil,
                  let object = try JSONSerialization.jsonObject(with: Data(result.utf8)) as? [String: Any] else {
                throw CampusStateValidationError(message: "Review fixture could not be built")
            }
            return try validator.validate(object)
        }
        let reviewed = try reviewedFixture(state)
        check(try validator.unfinishedTasks(reviewed, among: ["manual-1"], requireCurrentReview: true) == ["manual-1": "Current trusted title"], "Unchanged reviewed tasks may pass the delayed notification check")
        for (field, replacement) in [("title", "Revised task"), ("dueAt", "2026-11-20T10:00:00Z"), ("course", "Different course")] {
            var changed = reviewed, rows = changed["manualTasks"] as! [[String: Any]]
            rows[0][field] = replacement; changed["manualTasks"] = rows
            changed = try validator.validate(changed)
            check(try validator.unfinishedTasks(changed, among: ["manual-1"], requireCurrentReview: true).isEmpty, "Same ID with changed \(field) invalidates a delayed review notification")
        }
        var added = reviewed, addedRows = reviewed["manualTasks"] as! [[String: Any]]
        addedRows.append(["id": "manual-new", "title": "A new urgent assignment", "status": "open"]); added["manualTasks"] = addedRows
        check(try validator.unfinishedTasks(validator.validate(added), among: ["manual-1"], requireCurrentReview: true).isEmpty, "A newly added task invalidates the previous priority ranking")
        var legacy = reviewed, legacyReport = legacy["taskReview"] as! [String: Any]
        legacyReport.removeValue(forKey: "inputFingerprint"); legacy["taskReview"] = legacyReport
        legacy = try validator.validate(legacy)
        check(try validator.unfinishedTasks(legacy, among: ["manual-1"], requireCurrentReview: true).isEmpty, "A legacy report without a fingerprint cannot authorize a new notification")
        check((legacy["taskReview"] as? [String: Any])?["summary"] as? String == legacyReport["summary"] as? String, "Invalidating an old report preserves its stored summary")
        let teamsURL = "https://teams.microsoft.com/v2/"
        var withRequirements = state
        let teamTask: [String: Any] = ["id": "teams:graph:assignment:fixture", "title": "Source assignment", "officialAssignment": true,
            "requirements": "Read chapter one.", "status": "open"]
        withRequirements["snapshots"] = ["seiue": [:], "managebac": [:], "teams": [teamsURL: ["source": "teams", "url": teamsURL,
            "coverage": "graph", "accountId": "synthetic-account", "capturedAt": "2026-11-12T08:00:00Z", "tasks": [teamTask]]]]
        withRequirements = try reviewedFixture(validator.validate(withRequirements))
        check(try validator.unfinishedTasks(withRequirements, among: ["manual-1"], requireCurrentReview: true).count == 1, "A reviewed set including source requirements is current")
        var snapshots = withRequirements["snapshots"] as! [String: Any], teams = snapshots["teams"] as! [String: [String: Any]], page = teams[teamsURL]!
        var teamTasks = page["tasks"] as! [[String: Any]]; teamTasks[0]["requirements"] = "Read chapter two instead."
        page["tasks"] = teamTasks; teams[teamsURL] = page; snapshots["teams"] = teams; withRequirements["snapshots"] = snapshots
        check(try validator.unfinishedTasks(validator.validate(withRequirements), among: ["manual-1"], requireCurrentReview: true).isEmpty, "Changed source requirements invalidate the already completed review")
        state["taskChecks"] = ["manual-1": true]
        check(try validator.unfinishedTasks(state, among: ["manual-1"]).isEmpty, "Locally completed task cannot be notified")
        state["taskChecks"] = [String: Any]()
        var tasks = state["manualTasks"] as! [[String: Any]]; tasks[0]["status"] = "completed"; state["manualTasks"] = tasks
        check(try validator.unfinishedTasks(state, among: ["manual-1"]).isEmpty, "Source completion status cannot be bypassed by missing local check")
        state["manualTasks"] = [[String: Any]]()
        check(try validator.unfinishedTasks(state, among: ["manual-1"]).isEmpty, "Deleted task cannot be notified")
        check((try? validator.unfinishedTasks(state, among: ["a", "b", "c", "d"])) == nil, "Notification state lookup remains bounded")
        print("PASS: Task review \(checks) synthetic native checks; no real Keychain, notifications or network")
    }
}
