import Foundation

@main struct NativeWorkQueueSmoke {
    static func main() throws {
        var checks = 0
        func check(_ success: Bool, _ label: String) {
            guard success else { fputs("FAIL: \(label)\n", stderr); exit(1) }
            checks += 1
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-native-queue-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let target = directory.appendingPathComponent("synthetic-state.txt")
        let callbacks = DispatchQueue(label: "CampusDesk.tests.queue-callbacks")
        var writes = [Int](), receipts = [UInt64]()
        let writer = CampusLatestValueWriter<Int>(label: "CampusDesk.tests.burst", delay: 5, completionQueue: callbacks,
            write: { value in
                writes.append(value)
                try Data(String(value).utf8).write(to: target, options: .atomic)
            }, completion: { receipt in receipts.append(receipt.revision) })
        var finalRevision: UInt64 = 0
        for value in 1...300 { finalRevision = writer.submit(value) }
        let receipt = writer.flush()
        callbacks.sync {}
        check(writes == [300], "A burst of 300 immutable snapshots writes only the newest waiting value")
        check(receipt?.revision == finalRevision && receipts == [finalRevision], "Flush acknowledges exactly the revision that reached disk")
        check(try String(contentsOf: target, encoding: .utf8) == "300", "Quit-style flush commits the newest value immediately, before its delay")

        let started = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
        var orderedWrites = [Int](), ordinaryWriteWasOnMain = false
        let serial = CampusLatestValueWriter<Int>(label: "CampusDesk.tests.in-flight", delay: 0.01, completionQueue: callbacks,
            write: { value in
                if value == 1 {
                    ordinaryWriteWasOnMain = Thread.isMainThread
                    started.signal(); _ = release.wait(timeout: .now() + 5)
                }
                orderedWrites.append(value)
                try Data(String(value).utf8).write(to: target, options: .atomic)
            })
        serial.submit(1)
        check(started.wait(timeout: .now() + 5) == .success, "First disk write can run while the caller remains free")
        check(!ordinaryWriteWasOnMain, "Ordinary autosave disk work runs off the main thread")
        serial.submit(2)
        let newest = serial.submit(3)
        release.signal()
        let latest = serial.flush()
        check(orderedWrites == [1, 3] && latest?.revision == newest, "In-flight writes stay ordered and only waiting snapshots coalesce")
        check(try String(contentsOf: target, encoding: .utf8) == "3", "An older in-flight save cannot overwrite the latest snapshot")
        // Model an import/account reset after its mandatory barrier. A delayed
        // autosave callback can no longer write over this critical commit.
        try Data("critical-import".utf8).write(to: target, options: .atomic)
        Thread.sleep(forTimeInterval: 0.04)
        serial.flush()
        check(try String(contentsOf: target, encoding: .utf8) == "critical-import", "A drained delayed save cannot overwrite a later synchronous commit")

        let failureTarget = directory.appendingPathComponent("missing-parent/state.txt")
        var failedReceipt = false
        let failing = CampusLatestValueWriter<Int>(label: "CampusDesk.tests.failure", delay: 5, completionQueue: callbacks,
            write: { value in try Data(String(value).utf8).write(to: failureTarget, options: .atomic) },
            completion: { receipt in if case .failure = receipt.result { failedReceipt = true } })
        failing.submit(7)
        let failed = failing.flush()
        callbacks.sync {}
        if case .failure? = failed?.result { check(true, "Flush returns disk failure without acknowledging durability") }
        else { check(false, "Flush returns disk failure without acknowledging durability") }
        check(failedReceipt, "Disk failure reaches the completion handler")
        check(try String(contentsOf: target, encoding: .utf8) == "critical-import", "A failed save does not change the existing good file")
        try FileManager.default.createDirectory(at: failureTarget.deletingLastPathComponent(), withIntermediateDirectories: true)
        let retry = failing.submit(8)
        let recovered = failing.flush()
        if case .success? = recovered?.result { check(recovered?.revision == retry, "A later successful retry acknowledges only its own revision") }
        else { check(false, "A later successful retry acknowledges only its own revision") }
        check(try String(contentsOf: failureTarget, encoding: .utf8) == "8", "A retry persists the newest value after a prior failure")

        let events = CampusJSONEventEncoder(deliveryQueue: callbacks)
        let delivered = DispatchSemaphore(value: 0)
        var eventNumbers = [Int](), deliveredValidJSON = true
        let expected = Array(0..<60)
        for number in expected {
            events.encode(["type": "synthetic", "number": number, "text": String(repeating: "本地测试", count: number % 3 == 0 ? 1000 : 1)]) { payload in
                guard let value = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any],
                      let returned = value["number"] as? Int else { deliveredValidJSON = false; return }
                eventNumbers.append(returned)
                if returned == expected.last { delivered.signal() }
            }
        }
        check(delivered.wait(timeout: .now() + 5) == .success, "Background encoding completes synthetic event delivery")
        callbacks.sync {}
        check(deliveredValidJSON && eventNumbers == expected, "Different-sized events retain FIFO order and valid Unicode JSON")

        var boundary = CampusStateBridgeBoundary()
        check(boundary.acceptsMutation(0) && !boundary.acceptsMutation(nil), "Native mutations require the dashboard's known generation")
        let oldGeneration = boundary.generation
        boundary.beginImport("import-success")
        try Data("imported-state".utf8).write(to: target, options: .atomic)
        check(!boundary.acceptsMutation(oldGeneration), "An old saveState cannot overwrite a committed import")
        check(!boundary.acceptsMutation(boundary.generation), "Even current-generation saves wait for importResultApplied")
        for type in ["snapshot", "graphBatch", "state", "graphReset", "teamsAttachment"] {
            check(!boundary.allowsDelivery(type: type, generation: oldGeneration), "Queued old \(type) is isolated across import")
        }
        check(boundary.allowsDelivery(type: "assistantResponse", generation: oldGeneration), "Non-state assistant completion survives an import")
        check(boundary.allowsDelivery(type: "assistantModels", generation: oldGeneration), "Model catalog requests can finish without remaining busy")
        check(!boundary.acknowledgeImport("wrong-request", generation: boundary.generation), "Another request cannot acknowledge this import")
        check(!boundary.acknowledgeImport("import-success", generation: oldGeneration), "An old acknowledgement cannot open the import barrier")
        let importedGeneration = boundary.generation
        check(boundary.acknowledgeImport("import-success", generation: importedGeneration), "Matching result acknowledgement opens the barrier")
        check(boundary.acceptsMutation(importedGeneration) && !boundary.acceptsMutation(oldGeneration), "Only saves of the applied imported state can resume")
        check(try String(contentsOf: target, encoding: .utf8) == "imported-state", "Rejected stale messages leave imported disk data intact")

        boundary.beginImport("import-failure")
        let failureGeneration = boundary.generation
        check(failureGeneration > importedGeneration && !boundary.acceptsMutation(importedGeneration), "Failed imports also isolate the old transaction")
        check(boundary.acknowledgeImport("import-failure", generation: failureGeneration), "The authoritative failure result can unlock its own generation")
        for action in ["sync", "syncTeams", "graphSync", "teams-auto-start", "syncSchool", "connectSchool"] {
            check(CampusStateBridgeBoundary.resumesAfterImportFailure(action), "Explicit \(action) can resume after an import failure")
        }
        for action in ["ready", "saveState", "graphBatchProcessed", "requestGraphStatus"] {
            check(!CampusStateBridgeBoundary.resumesAfterImportFailure(action), "\(action) never silently resumes paused producers")
        }
        boundary.replaceState()
        check(!boundary.acceptsMutation(failureGeneration), "Account reset rejects pre-reset autosaves")
        check(!boundary.allowsDelivery(type: "graphBatch", generation: failureGeneration), "Account reset rejects queued batches from before sign-out")
        boundary.beginImport("reload-recovery")
        boundary.dashboardReloaded()
        check(boundary.acceptsMutation(boundary.generation), "A fresh authoritative dashboard handshake recovers a failed result delivery")

        let encodingFailed = DispatchSemaphore(value: 0)
        events.encode(["invalid": Date()], failure: { encodingFailed.signal() }) { _ in }
        check(encodingFailed.wait(timeout: .now() + 5) == .success, "Encoding failure reports completion instead of silently stranding a barrier")
        print("PASS: \(checks) native queue checks; burst writes: 300 -> \(writes.count)")
    }
}
