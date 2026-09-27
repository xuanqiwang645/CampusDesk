import Foundation
import Security

/// Serializes this process's keychain calls because the legacy macOS keychain
/// interaction policy is process-wide. This changes no item ACL or saved policy.
enum CampusKeychain {
    private static let lock = NSRecursiveLock()

    static func copyMatching(_ query: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?, allowInteraction: Bool = true) -> OSStatus {
        result?.pointee = nil
        return perform(allowInteraction: allowInteraction) {
            SecItemCopyMatching(query, result)
        }
    }

    static func update(_ query: CFDictionary, _ attributes: CFDictionary, allowInteraction: Bool = true) -> OSStatus {
        perform(allowInteraction: allowInteraction) {
            SecItemUpdate(query, attributes)
        }
    }

    static func add(_ attributes: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?, allowInteraction: Bool = true) -> OSStatus {
        result?.pointee = nil
        return perform(allowInteraction: allowInteraction) {
            SecItemAdd(attributes, result)
        }
    }

    static func delete(_ query: CFDictionary, allowInteraction: Bool = true) -> OSStatus {
        perform(allowInteraction: allowInteraction) {
            SecItemDelete(query)
        }
    }

    // Injectable hooks let native tests cover policy changes and failures without
    // accessing a real keychain. All operations, including interactive callers,
    // must use this lock so they cannot race a temporary noninteractive scope.
    static func perform(
        allowInteraction: Bool,
        getInteraction: (UnsafeMutablePointer<DarwinBoolean>) -> OSStatus = { SecKeychainGetUserInteractionAllowed($0) },
        setInteraction: (Bool) -> OSStatus = { SecKeychainSetUserInteractionAllowed($0) },
        _ operation: () -> OSStatus
    ) -> OSStatus {
        lock.lock()
        defer { lock.unlock() }
        guard !allowInteraction else { return operation() }

        // These legacy APIs are required for file-based keychain ACL prompts;
        // data-protection authentication query flags alone do not cover them.
        var previous = DarwinBoolean(false)
        let readStatus = getInteraction(&previous)
        guard readStatus == errSecSuccess else { return readStatus }

        var operationStatus: OSStatus = errSecSuccess
        var restoreStatus: OSStatus = errSecSuccess
        do {
            // Restore even if disabling failed, and before releasing the lock.
            defer { restoreStatus = setInteraction(previous.boolValue) }
            let disableStatus = setInteraction(false)
            if disableStatus == errSecSuccess {
                operationStatus = operation()
            } else {
                operationStatus = disableStatus
            }
        }
        return operationStatus == errSecSuccess ? restoreStatus : operationStatus
    }
}
