import Foundation

/// A single writer with at most one waiting snapshot. Callers pass immutable
/// values and acknowledge durability only when their latest receipt succeeds.
/// Superseded waiting values have no side effects and need no completion.
final class CampusLatestValueWriter<Value> {
    struct Receipt {
        let revision: UInt64
        let result: Result<Void, Error>
    }

    private struct Job {
        let revision: UInt64
        let value: Value
    }

    private let queue: DispatchQueue
    private let completionQueue: DispatchQueue
    private let delay: TimeInterval
    private let write: (Value) throws -> Void
    private let completion: (Receipt) -> Void
    private let lock = NSLock()
    private var nextRevision: UInt64 = 0
    private var pending: Job?
    private var scheduledToken: UUID?
    private var lastReceipt: Receipt?

    init(label: String, delay: TimeInterval = 0.06, completionQueue: DispatchQueue = .main,
         write: @escaping (Value) throws -> Void, completion: @escaping (Receipt) -> Void = { _ in }) {
        queue = DispatchQueue(label: label, qos: .utility)
        self.delay = delay
        self.completionQueue = completionQueue
        self.write = write
        self.completion = completion
    }

    @discardableResult func submit(_ value: Value) -> UInt64 {
        lock.lock()
        nextRevision += 1
        let revision = nextRevision
        pending = Job(revision: revision, value: value)
        let token = scheduledToken == nil ? UUID() : nil
        if let token { scheduledToken = token }
        lock.unlock()
        if let token {
            // Do not restart this deadline for every update: a continuous
            // stream still makes durable progress at a bounded interval.
            queue.asyncAfter(deadline: .now() + delay) { [self] in drain(expected: token) }
        }
        return revision
    }

    /// Used before imports/account changes and on quit. Work never waits for
    /// its UI completion, so the main thread can safely drain the disk queue.
    /// A delayed job is executed now, rather than waiting for its debounce.
    @discardableResult func flush() -> Receipt? {
        queue.sync {
            drain(expected: nil)
            lock.lock(); defer { lock.unlock() }
            return lastReceipt
        }
    }

    private func drain(expected: UUID?) {
        lock.lock()
        if let expected, scheduledToken != expected { lock.unlock(); return }
        let job = pending
        pending = nil
        scheduledToken = nil
        lock.unlock()
        guard let job else { return }
        let receipt = Receipt(revision: job.revision, result: Result { try write(job.value) })
        lock.lock(); lastReceipt = receipt; lock.unlock()
        completionQueue.async { [completion] in completion(receipt) }
    }
}

/// Encoding is CPU work; only WebKit delivery belongs on the main thread.
/// Both queues are serial, preserving state/snapshot/acknowledgement order.
final class CampusJSONEventEncoder {
    private let queue = DispatchQueue(label: "CampusDesk.event-encoding", qos: .userInitiated)
    private let deliveryQueue: DispatchQueue

    init(deliveryQueue: DispatchQueue = .main) { self.deliveryQueue = deliveryQueue }

    func encode(_ event: [String: Any], failure: @escaping () -> Void = {}, delivery: @escaping (String) -> Void) {
        queue.async { [deliveryQueue] in
            guard JSONSerialization.isValidJSONObject(event),
                  let data = try? JSONSerialization.data(withJSONObject: event),
                  let payload = String(data: data, encoding: .utf8) else {
                deliveryQueue.async(execute: failure)
                return
            }
            deliveryQueue.async { delivery(payload) }
        }
    }
}

/// An asynchronous file read belongs to both its initiating state and its
/// selection. A later selection, state replacement or page reload revokes it.
/// Confined to the main queue, like CampusStateBridgeBoundary.
struct CampusStateRequest {
    struct Ticket {
        fileprivate let id: UUID
        fileprivate let generation: Int
    }
    private var current: UUID?

    mutating func begin(generation: Int) -> Ticket {
        let id = UUID()
        current = id
        return Ticket(id: id, generation: generation)
    }

    mutating func cancel() { current = nil }

    /// Consume only this request. An older completion must not cancel a newer
    /// selection, and a rejected state generation can never be relabeled.
    mutating func finish(_ ticket: Ticket, boundary: CampusStateBridgeBoundary) -> Bool {
        guard current == ticket.id else { return false }
        current = nil
        return boundary.acceptsMutation(ticket.generation)
    }
}

/// Sync cancellation also revokes the login callback that was preparing that
/// sync. Keep its busy flag and callback identity in the same transition.
struct CampusGraphWorkBoundary {
    private(set) var generation = UUID()
    private(set) var signingIn = false

    mutating func beginSignIn() -> UUID {
        signingIn = true
        return generation
    }

    mutating func finishSignIn(_ expected: UUID) -> Bool {
        guard signingIn, generation == expected else { return false }
        signingIn = false
        return true
    }

    @discardableResult mutating func cancel() -> Bool {
        let interruptedSignIn = signingIn
        generation = UUID()
        signingIn = false
        return interruptedSignIn
    }
}

/// The dashboard and native state share an epoch, independently of disk-write
/// revisions. Import replaces that epoch before either side may produce data
/// again. A matching acknowledgement proves the dashboard applied the result.
struct CampusStateBridgeBoundary {
    private(set) var generation = 0
    private(set) var awaitingImportRequestID: String?

    mutating func beginImport(_ requestID: String) {
        generation += 1
        awaitingImportRequestID = requestID
    }

    mutating func replaceState() { generation += 1 }

    func matches(_ supplied: Any?) -> Bool { supplied as? Int == generation }
    func acceptsMutation(_ supplied: Any?) -> Bool { awaitingImportRequestID == nil && matches(supplied) }
    func allowsDelivery(type: String, generation captured: Int) -> Bool {
        !Self.isolatesEvent(type) || captured == generation
    }

    mutating func acknowledgeImport(_ requestID: String, generation supplied: Any?) -> Bool {
        guard awaitingImportRequestID == requestID, matches(supplied) else { return false }
        awaitingImportRequestID = nil
        return true
    }

    mutating func dashboardReloaded() { awaitingImportRequestID = nil }

    static func resumesAfterImportFailure(_ action: String) -> Bool {
        ["sync", "syncTeams", "syncSchool", "connectSchool", "graphSync", "graphSignIn",
         "teams-auto-start", "teams-auto-login", "pinTeamsBrowserPage", "captureTeamsBrowserPage"].contains(action)
    }

    static func requiresCurrentState(_ action: String) -> Bool {
        action != "ready" && action != "importResultApplied" && !action.hasPrefix("assistant")
    }

    /// Only this fixed-size header can rely on prepare() to check the size and
    /// schema of the payload. Imports and messages with extra fields still
    /// require a byte limit on the entire envelope.
    static func isPlainStateSave(_ body: [String: Any]) -> Bool {
        body.count == 3 && body["action"] as? String == "saveState" &&
            body["stateGeneration"] is Int && (body["state"] is [String: Any] || body["stateJSON"] is String)
    }

    static func importRequestID(_ body: [String: Any]) -> String? {
        guard body["action"] as? String == "saveState", body["imported"] as? Bool == true,
              let id = body["importRequestId"] as? String, (1...100).contains(id.utf8.count),
              id.range(of: #"^[A-Za-z0-9-]+\z"#, options: .regularExpression) != nil else { return nil }
        return id
    }

    static func acceptsEnvelope(_ body: [String: Any], maximumBytes: Int, currentState: [String: Any],
                                onImportFailure: ([String: Any]) -> Void) -> Bool {
        if isPlainStateSave(body) { return true }
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              data.count <= maximumBytes else {
            if let requestID = importRequestID(body) {
                onImportFailure(["type": "importResult", "requestId": requestID, "success": false,
                                 "state": currentState, "message": "备份数据格式无效或超出大小限制，原数据保持不变。"])
            }
            return false
        }
        return true
    }

    static func isolatesEvent(_ type: String) -> Bool {
        ["state", "snapshot", "graphBatch", "graphReset", "teamsAttachment", "teamsAttachmentUnchanged",
         "pinTeamsPage", "schoolConfiguration", "schoolConfigurationError", "schoolCalendarFile",
         "schoolCalendarPDF", "schoolCalendarFileError", "import", "importResult", "graphStatus",
         "teamsAutoStatus", "teamsAnalysisResult", "taskReviewResult", "taskReviewTick", "status"].contains(type)
    }
}
