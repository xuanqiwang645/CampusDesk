import Foundation
import Security
import CryptoKit

/// Both ends verify the other binary before any credential crosses a pipe.
enum AssistantCredentialIdentity {
    static let helperIdentifier = "local.campusdesk.mac.credentials"
    #if CREDENTIAL_TEST_FIXTURE
    static let appIdentifier = "local.campusdesk.tests.signing-continuity"
    static let service = "local.campusdesk.tests.signing-continuity"
    #else
    static let appIdentifier = "local.campusdesk.mac.themeedition"
    static let service = appIdentifier + ".assistant.deepseek"
    #endif

    static func signingInfo(_ code: SecCode) -> [String: Any]? {
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess, let staticCode else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess else { return nil }
        return info as? [String: Any]
    }

    static func requirement(for identifier: String) -> SecRequirement? {
        var code: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess, let code,
              let info = signingInfo(code),
              let certificates = info[kSecCodeInfoCertificates as String] as? [SecCertificate],
              let certificate = certificates.first else { return nil }
        let fingerprint = Insecure.SHA1.hash(data: SecCertificateCopyData(certificate) as Data).map { String(format: "%02x", $0) }.joined()
        var requirement: SecRequirement?
        let text = "identifier \"\(identifier)\" and certificate leaf = H\"\(fingerprint)\""
        guard SecRequirementCreateWithString(text as CFString, SecCSFlags(), &requirement) == errSecSuccess else { return nil }
        return requirement
    }

    static func validHelper(at url: URL) -> Bool {
        guard let requirement = requirement(for: helperIdentifier) else { return false }
        var code: SecStaticCode?
        return SecStaticCodeCreateWithPath(url as CFURL, SecCSFlags(), &code) == errSecSuccess
            && code.map { SecStaticCodeCheckValidity($0, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess } == true
    }

    static func authorizedParent(_ pid: pid_t) -> Bool {
        var ownCode: SecCode?
        guard pid > 1, let requirement = requirement(for: appIdentifier),
              SecCodeCopySelf(SecCSFlags(), &ownCode) == errSecSuccess, let ownCode,
              let ownInfo = signingInfo(ownCode),
              let ownExecutable = ownInfo[kSecCodeInfoMainExecutable as String] as? URL else { return false }
        // Bundle.main can resolve the enclosing app's main executable when a
        // helper lives inside .app/Contents. Security identifies the actual code.
        let ownURL = ownExecutable.resolvingSymlinksInPath()
        var parent: SecCode?
        let attributes = [kSecGuestAttributePid as String: pid] as CFDictionary
        guard SecCodeCopyGuestWithAttributes(nil, attributes, SecCSFlags(), &parent) == errSecSuccess, let parent,
              SecCodeCheckValidity(parent, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess,
              let info = signingInfo(parent), let executable = info[kSecCodeInfoMainExecutable as String] as? URL else { return false }
        let expected = executable.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Helpers/CampusDeskCredentials").resolvingSymlinksInPath()
        return expected == ownURL && getppid() == pid
    }
}
