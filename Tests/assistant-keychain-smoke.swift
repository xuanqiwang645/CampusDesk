import Foundation
import Security

// Every credential and Keychain operation in this executable is synthetic.
// Never call the default Keychain hooks or contact a model from this fixture.
@main
struct AssistantKeychainSmoke {
    static func main() {
        var passed = 0
        func check(_ value: Bool, _ label: String) {
            guard value else { fputs("FAIL: \(label)\n", stderr); exit(1) }
            passed += 1
        }
        checkInteractionScope(check)
        checkStoreReads(check)
        checkStoreWrites(check)
        checkAccessRecovery(check)
        print("PASS: \(passed) synthetic assistant Keychain checks; no real Keychain or network operations")
    }

    static func checkStoreReads(_ check: (Bool, String) -> Void) {
        let states: [(OSStatus, AssistantKeyStore.State)] = [
            (errSecSuccess, .stored), (errSecItemNotFound, .missing),
            (errSecInteractionNotAllowed, .locked), (errSecAuthFailed, .locked),
            (errSecUserCanceled, .locked), (errSecNotAvailable, .unavailable)
        ]
        for (status, expected) in states {
            let fake = SyntheticAssistantKeychain()
            fake.lookupStatus = status
            let store = fake.makeStore()
            check(store.state() == expected, "Metadata status distinguishes stored, missing, locked, and unavailable")
            check(fake.lookups.count == 1, "Each status probe performs one metadata lookup")
            let query = fake.lookups[0]
            check(query[kSecReturnAttributes as String] as? Bool == true && query[kSecReturnData as String] == nil, "Status never requests secret data")
            check(query[kSecAttrService as String] as? String == fake.service && query[kSecAttrAccount as String] as? String == fake.account, "Lookup is scoped to the assistant service and active account")
            check(query[kSecClass as String] as? String == kSecClassGenericPassword as String && query[kSecMatchLimit as String] as? String == kSecMatchLimitOne as String, "Lookup requests exactly one generic-password item")
            check(fake.events == ["lookup"], "Metadata status cannot write, delete, or switch accounts")
        }

        let fake = SyntheticAssistantKeychain(), sample = "synthetic-key-for-fixtures"
        let store = fake.makeStore()
        fake.lookupResult = Data(sample.utf8) as CFData
        check((try? store.read()) == sample, "An accessible synthetic key is returned only to the caller")
        check(fake.lookups.count == 1, "Reading a key performs exactly one secret lookup")
        check(fake.lookups[0][kSecReturnData as String] as? Bool == true && fake.lookups[0][kSecReturnAttributes as String] == nil, "The send read uses a data-only query")

        for (status, code) in [(errSecItemNotFound, "missingKey"), (errSecInteractionNotAllowed, "keyAccess"), (errSecAuthFailed, "keyAccess"), (errSecUserCanceled, "keyAccess"), (errSecNotAvailable, "keyStore")] {
            fake.lookupStatus = status
            check(errorCode { _ = try store.read() } == code, "A failed secret read returns its bounded error code")
            if code == "keyAccess" || code == "keyStore" {
                fake.lookupStatus = errSecSuccess
                fake.lookupResult = [kSecAttrAccount as String: fake.account] as CFDictionary
                check(store.state() == (code == "keyAccess" ? .locked : .unavailable), "Successful metadata probes do not erase a remembered secret-access failure")
            }
        }

        fake.lookupStatus = errSecSuccess
        let malformed: [CFTypeRef?] = [nil, "not-data" as CFString, Data([0xff, 0xfe]) as CFData, Data("short".utf8) as CFData, Data("bad\r\nheader".utf8) as CFData, Data(String(repeating: "x", count: 513).utf8) as CFData]
        for value in malformed {
            fake.lookupResult = value
            check(errorCode { _ = try store.read() } == "keyStore", "Malformed or unsafe credential data fails closed")
        }
        fake.lookupResult = Data(sample.utf8) as CFData
        check((try? store.read()) == sample && store.state() == .stored, "A later successful read clears a remembered access failure")
        fake.lookupStatus = errSecInteractionNotAllowed
        _ = errorCode { _ = try store.read() }
        fake.account = "api-key.other-synthetic-account"
        fake.lookupStatus = errSecSuccess
        check(store.state() == .stored, "An old account access failure does not lock a newly selected account")
        check(fake.adds.isEmpty && fake.removals.isEmpty, "Reading metadata and secrets never mutates the Keychain")
    }

    static func checkStoreWrites(_ check: (Bool, String) -> Void) {
        let fake = SyntheticAssistantKeychain(), store = fake.makeStore()
        let previous = fake.account, replacement = fake.nextAccount
        fake.removeStatus = errSecInteractionNotAllowed
        check(errorCode { try store.save("  synthetic-new-key  \n") } == nil, "Explicit replacement succeeds even when retiring the old protected item is denied")
        check(fake.account == replacement, "Successful save switches to the replacement account")
        check(fake.events == ["add", "select", "remove"], "The replacement pointer commits only after secure add succeeds")
        check(fake.adds.count == 1 && fake.removals.count == 1, "Successful explicit replacement adds one item and attempts one old-item retirement")
        let item = fake.adds[0]
        check(item[kSecAttrAccount as String] as? String == replacement && fake.removals[0][kSecAttrAccount as String] as? String == previous, "Save adds a fresh account and retirement targets only its prior account")
        check(item[kSecAttrService as String] as? String == fake.service, "Save stays within the assistant service")
        check(item[kSecValueData as String] as? Data == Data("synthetic-new-key".utf8), "Save trims the explicitly supplied synthetic key")
        check(item[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String, "Saved keys remain device-only and require an unlocked Keychain")
        check(fake.lookups.isEmpty, "Replacing a key does not read the previous secret")

        for (status, code) in [(errSecInteractionNotAllowed, "keyAccess"), (errSecAuthFailed, "keyAccess"), (errSecNotAvailable, "keyStore")] {
            let failed = SyntheticAssistantKeychain(), oldAccount = "api-key"
            failed.addStatus = status
            check(errorCode { try failed.makeStore().save("synthetic-new-key") } == code, "A failed add reports a safe credential error")
            check(failed.account == oldAccount && failed.events == ["add"], "Failed replacement retains the old account and never deletes it")
        }
        for value in ["", "short", "key with spaces", "key\r\nInjected:true", String(repeating: "x", count: 513)] {
            let invalid = SyntheticAssistantKeychain()
            check(errorCode { try invalid.makeStore().save(value) } == "invalidKey", "Invalid replacement keys are rejected before secure storage")
            check(invalid.events.isEmpty, "Invalid input does not query or modify credentials")
        }
        for candidate in ["", "api-key"] {
            let invalidAccount = SyntheticAssistantKeychain()
            invalidAccount.nextAccount = candidate
            check(errorCode { try invalidAccount.makeStore().save("synthetic-new-key") } == "keyStore", "A replacement must use a fresh nonempty account")
            check(invalidAccount.events.isEmpty && invalidAccount.account == "api-key", "Invalid account generation cannot modify the previous item")
        }
        for (status, expected) in [(errSecSuccess, true), (errSecItemNotFound, true), (errSecInteractionNotAllowed, false), (errSecNotAvailable, false)] {
            let deletion = SyntheticAssistantKeychain()
            deletion.removeStatus = status
            check(deletion.makeStore().delete() == expected, "Explicit delete reports whether the active item was removed or absent")
            check(deletion.events == ["remove"] && deletion.removals[0][kSecAttrAccount as String] as? String == deletion.account, "Delete targets only the selected assistant account")
        }
    }

    static func checkAccessRecovery(_ check: (Bool, String) -> Void) {
        let working = SyntheticAssistantKeychain()
        working.lookupResult = Data("synthetic-existing-key".utf8) as CFData
        check(errorCode { try working.makeStore().restoreAccess() } == nil, "A working key needs no migration")
        check(working.events == ["lookup"], "A cleared transient lock does not prompt or mutate credentials")

        let legacy = SyntheticAssistantKeychain()
        legacy.lookupStatus = errSecInteractionNotAllowed
        legacy.authorizedResult = Data("synthetic-legacy-key".utf8) as CFData
        check(errorCode { try legacy.makeStore().restoreAccess() } == nil, "Explicit authorization restores a legacy key without re-entry")
        check(legacy.events == ["lookup", "authorize", "add", "select", "remove"], "Authorized migration commits the replacement before retiring the legacy item")
        check(legacy.adds.first?[kSecValueData as String] as? Data == Data("synthetic-legacy-key".utf8), "Recovery preserves the exact saved credential")
        legacy.lookupStatus = errSecSuccess
        legacy.lookupResult = Data("synthetic-legacy-key".utf8) as CFData
        let relaunched = legacy.makeStore()
        check((try? relaunched.read()) == "synthetic-legacy-key", "A fresh store uses the persisted replacement account after relaunch")

        for status in [errSecUserCanceled, errSecAuthFailed, errSecInteractionNotAllowed] {
            let denied = SyntheticAssistantKeychain()
            denied.lookupStatus = errSecInteractionNotAllowed; denied.authorizeStatus = status
            check(errorCode { try denied.makeStore().restoreAccess() } == "keyAccess", "Cancelled or denied recovery reports access failure")
            check(denied.events == ["lookup", "authorize"] && denied.account == "api-key", "Denied recovery preserves the original item and pointer")
        }
        let failed = SyntheticAssistantKeychain()
        failed.lookupStatus = errSecInteractionNotAllowed
        failed.authorizedResult = Data("synthetic-legacy-key".utf8) as CFData
        failed.addStatus = errSecNotAvailable
        check(errorCode { try failed.makeStore().restoreAccess() } == "keyStore", "Migration reports a failed replacement write")
        check(failed.account == "api-key" && failed.removals.isEmpty, "A failed migration cannot delete the only usable key")
        for status in [errSecItemNotFound, errSecNotAvailable] {
            let unavailable = SyntheticAssistantKeychain(); unavailable.lookupStatus = status
            _ = errorCode { try unavailable.makeStore().restoreAccess() }
            check(unavailable.events == ["lookup"], "Missing items and temporary service errors cannot trigger authorization")
        }
    }

    static func errorCode(_ operation: () throws -> Void) -> String? {
        do { try operation(); return nil }
        catch let error as AssistantError { return error.code }
        catch { return "unexpectedError" }
    }

    static func checkInteractionScope(_ check: (Bool, String) -> Void) {
        for previous in [true, false] {
            var events: [String] = []
            let result = CampusKeychain.perform(allowInteraction: false, getInteraction: { pointer in
                events.append("get"); pointer.pointee = DarwinBoolean(previous); return errSecSuccess
            }, setInteraction: { value in events.append("set:\(value)"); return errSecSuccess }) {
                events.append("operation"); return errSecSuccess
            }
            check(result == errSecSuccess, "Silent operation succeeds with an injected Keychain")
            check(events == ["get", "set:false", "operation", "set:\(previous)"], "The previous interaction policy is restored in order")
        }

        var calls: [String] = []
        let readFailure = CampusKeychain.perform(allowInteraction: false, getInteraction: { _ in
            calls.append("get"); return errSecNotAvailable
        }, setInteraction: { _ in calls.append("set"); return errSecSuccess }) {
            calls.append("operation"); return errSecSuccess
        }
        check(readFailure == errSecNotAvailable, "Policy-read failure propagates")
        check(calls == ["get"], "No operation runs when policy cannot be read")

        calls = []
        let disableFailure = CampusKeychain.perform(allowInteraction: false, getInteraction: { pointer in
            pointer.pointee = DarwinBoolean(true); return errSecSuccess
        }, setInteraction: { value in calls.append("set:\(value)"); return value ? errSecSuccess : errSecAuthFailed }) {
            calls.append("operation"); return errSecSuccess
        }
        check(disableFailure == errSecAuthFailed, "Cannot disable interaction: return the failure")
        check(calls == ["set:false", "set:true"], "Cannot disable interaction: skip the operation and restore policy")

        for operationResult in [errSecSuccess, errSecItemNotFound] {
            calls = []
            let restoreFailure = CampusKeychain.perform(allowInteraction: false, getInteraction: { pointer in
                pointer.pointee = DarwinBoolean(true); return errSecSuccess
            }, setInteraction: { value in calls.append("set:\(value)"); return value ? errSecNotAvailable : errSecSuccess }) {
                calls.append("operation"); return operationResult
            }
            check(restoreFailure == (operationResult == errSecSuccess ? errSecNotAvailable : operationResult), "Restore failure cannot turn a failed operation into success")
            check(calls == ["set:false", "operation", "set:true"], "Policy restoration is attempted after either operation outcome")
        }

        calls = []
        let interactive = CampusKeychain.perform(allowInteraction: true, getInteraction: { _ in
            calls.append("unexpected get"); return errSecNotAvailable
        }, setInteraction: { _ in calls.append("unexpected set"); return errSecNotAvailable }) {
            calls.append("operation"); return errSecSuccess
        }
        check(interactive == errSecSuccess && calls == ["operation"], "Explicit interactive callers share the lock without changing policy")

        var interactionAllowed = true
        var nestedObservedSilentPolicy = false
        let getPolicy: (UnsafeMutablePointer<DarwinBoolean>) -> OSStatus = { pointer in
            pointer.pointee = DarwinBoolean(interactionAllowed); return errSecSuccess
        }
        let setPolicy: (Bool) -> OSStatus = { value in interactionAllowed = value; return errSecSuccess }
        let nested = CampusKeychain.perform(allowInteraction: false, getInteraction: getPolicy, setInteraction: setPolicy) {
            CampusKeychain.perform(allowInteraction: false, getInteraction: getPolicy, setInteraction: setPolicy) {
                nestedObservedSilentPolicy = !interactionAllowed
                return errSecItemNotFound
            }
        }
        check(nested == errSecItemNotFound && nestedObservedSilentPolicy, "Nested calls are safe and remain noninteractive")
        check(interactionAllowed, "The outermost call restores the original policy after nested calls")

        let workers = DispatchGroup(), observations = ConcurrentKeychainOperations()
        for index in 0..<12 {
            workers.enter()
            DispatchQueue.global().async {
                _ = CampusKeychain.perform(allowInteraction: index.isMultiple(of: 2), getInteraction: { pointer in
                    pointer.pointee = DarwinBoolean(true); return errSecSuccess
                }, setInteraction: { _ in errSecSuccess }) {
                    observations.begin()
                    Thread.sleep(forTimeInterval: 0.002)
                    observations.end()
                    return errSecSuccess
                }
                workers.leave()
            }
        }
        check(workers.wait(timeout: .now() + 5) == .success, "Concurrent synthetic operations finish without deadlocking")
        check(observations.completed == 12 && observations.maximumActive == 1, "Interactive and noninteractive Keychain operations use one lock")
    }
}

private final class SyntheticAssistantKeychain {
    let service = "unit.test.assistant.deepseek"
    var account = "api-key"
    var nextAccount = "api-key.synthetic-replacement"
    var lookupStatus = errSecSuccess, addStatus = errSecSuccess, removeStatus = errSecSuccess
    var lookupResult: CFTypeRef?
    var authorizeStatus = errSecSuccess
    var authorizedResult: CFTypeRef?
    var lookups: [AssistantKeyStore.Query] = [], adds: [AssistantKeyStore.Query] = [], removals: [AssistantKeyStore.Query] = []
    var events: [String] = []

    func makeStore() -> AssistantKeyStore {
        AssistantKeyStore(service: service, currentAccount: { self.account }, selectAccount: { value in
            self.events.append("select"); self.account = value
        }, copyMatching: { query in
            self.events.append("lookup"); self.lookups.append(query); return (self.lookupStatus, self.lookupResult)
        }, add: { query in
            self.events.append("add"); self.adds.append(query); return self.addStatus
        }, remove: { query in
            self.events.append("remove"); self.removals.append(query); return self.removeStatus
        }, makeAccount: { self.nextAccount }, authorizeMatching: { query in
            self.events.append("authorize")
            return (self.authorizeStatus, self.authorizedResult)
        })
    }
}

private final class ConcurrentKeychainOperations: @unchecked Sendable {
    private let lock = NSLock()
    private var active = 0
    private(set) var completed = 0
    private(set) var maximumActive = 0

    func begin() {
        lock.lock(); defer { lock.unlock() }
        active += 1; maximumActive = max(maximumActive, active)
    }

    func end() {
        lock.lock(); defer { lock.unlock() }
        active -= 1; completed += 1
    }
}
