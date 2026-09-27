import Foundation
import Security

/// Status probes and normal requests never prompt. Only the explicit recovery
/// action may authorize an existing item. Secrets never leave the native layer.
final class AssistantKeyStore {
    enum State: String { case missing, stored, locked, unavailable }
    typealias Query = [String: Any]

    private let service: String
    private let currentAccount: () -> String
    private let selectAccount: (String) -> Void
    private let copyMatching: (Query) -> (OSStatus, CFTypeRef?)
    private let authorizeMatching: ((Query) -> (OSStatus, CFTypeRef?))?
    private let add: (Query) -> OSStatus
    private let remove: (Query) -> OSStatus
    private let makeAccount: () -> String
    private var accessFailure: (account: String, state: State)?
    private let lock = NSRecursiveLock()

    init(service: String, currentAccount: @escaping () -> String, selectAccount: @escaping (String) -> Void,
         copyMatching: @escaping (Query) -> (OSStatus, CFTypeRef?), add: @escaping (Query) -> OSStatus,
         remove: @escaping (Query) -> OSStatus, makeAccount: @escaping () -> String = { "api-key." + UUID().uuidString },
         authorizeMatching: ((Query) -> (OSStatus, CFTypeRef?))? = nil) {
        self.service = service; self.currentAccount = currentAccount; self.selectAccount = selectAccount
        self.copyMatching = copyMatching; self.add = add; self.remove = remove; self.makeAccount = makeAccount
        self.authorizeMatching = authorizeMatching
    }

    private func query(account: String) -> Query {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    private func failure(_ status: OSStatus) -> AssistantError {
        [errSecInteractionNotAllowed, errSecAuthFailed, errSecUserCanceled].contains(status) ? .keyAccess : .keyStore
    }

    func state() -> State {
        lock.lock(); defer { lock.unlock() }
        let account = currentAccount()
        var lookup = query(account: account)
        lookup[kSecReturnAttributes as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        let (status, _) = copyMatching(lookup)
        if status == errSecItemNotFound { accessFailure = nil; return .missing }
        if status == errSecSuccess {
            return accessFailure?.account == account ? accessFailure!.state : .stored
        }
        return failure(status) == .keyAccess ? .locked : .unavailable
    }

    func read() throws -> String {
        try read(using: copyMatching)
    }

    private func read(using lookupItem: (Query) -> (OSStatus, CFTypeRef?)) throws -> String {
        lock.lock(); defer { lock.unlock() }
        let account = currentAccount()
        var lookup = query(account: account)
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        let (status, result) = lookupItem(lookup)
        if status == errSecItemNotFound { accessFailure = nil; throw AssistantError.missingKey }
        guard status == errSecSuccess else {
            let error = failure(status)
            accessFailure = (account, error == .keyAccess ? .locked : .unavailable)
            throw error
        }
        guard let data = result as? Data, let key = String(data: data, encoding: .utf8),
              (8...512).contains(key.count), CampusSecurity.isSafeHTTPHeaderValue(key) else {
            accessFailure = (account, .unavailable); throw AssistantError.keyStore
        }
        accessFailure = nil
        return key
    }

    func restoreAccess() throws {
        lock.lock(); defer { lock.unlock() }
        // A transient lock may already have cleared. Do not authorize or rotate
        // a working credential, and never prompt from a send/status operation.
        do { _ = try read(); return }
        catch AssistantError.keyAccess { }
        catch { throw error }
        guard let authorizeMatching else { throw AssistantError.keyAccess }
        let key = try read(using: authorizeMatching)
        // A legacy ad-hoc build owned the old ACL. After the user's one-time
        // authorization, copy into an item owned by the stable credential helper.
        // Save is transactional: a failed write leaves the original available.
        try save(key)
    }

    func save(_ rawKey: String) throws {
        lock.lock(); defer { lock.unlock() }
        let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (8...512).contains(key.count), CampusSecurity.isSafeHTTPHeaderValue(key) else { throw AssistantError.invalidKey }
        let previousAccount = currentAccount(), replacementAccount = makeAccount()
        // Save creates a fresh item owned by this signing identity. It
        // never weakens an old item's ACL. Publish the new
        // account only after a successful secure write; failed saves keep the old
        // item and pointer intact. The pointer is metadata, never a secret.
        guard replacementAccount != previousAccount, !replacementAccount.isEmpty else { throw AssistantError.keyStore }
        var item = query(account: replacementAccount)
        item[kSecValueData as String] = Data(key.utf8)
        item[kSecAttrLabel as String] = "CampusDesk DeepSeek API key"
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = add(item)
        guard status == errSecSuccess else { throw failure(status) }
        selectAccount(replacementAccount)
        accessFailure = nil
        // Only an explicit successful replacement may retire its previous item.
        // A protected legacy item is left untouched if silent deletion is denied.
        _ = remove(query(account: previousAccount))
    }

    @discardableResult func delete() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let status = remove(query(account: currentAccount()))
        guard status == errSecSuccess || status == errSecItemNotFound else { return false }
        accessFailure = nil
        return true
    }
}
