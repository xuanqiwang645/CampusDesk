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

    static func isolatesEvent(_ type: String) -> Bool {
        ["state", "snapshot", "graphBatch", "graphReset", "teamsAttachment", "teamsAttachmentUnchanged",
         "pinTeamsPage", "schoolConfiguration", "schoolConfigurationError", "schoolCalendarFile",
         "schoolCalendarPDF", "schoolCalendarFileError", "import", "importResult", "graphStatus",
         "teamsAutoStatus", "status"].contains(type)
    }
}
