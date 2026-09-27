import Foundation

/// Small, native trust-boundary checks shared by the Theme Edition bridge and
/// its local-data readers. The dashboard still performs full schema migration;
/// these checks keep malformed IPC and disk input away from privileged code.
enum CampusSecurity {
    static let maximumStateBytes = 26_214_400
    private static let secretQueryNames: Set<String> = [
        "access_token", "refresh_token", "id_token", "token", "client_secret",
        "password", "passwd", "assertion", "code", "code_verifier", "authorization",
        "auth_token", "oauth_token", "oauth_verifier", "session_token", "sessionid",
        "session_state", "authkey", "sig", "signature", "ticket", "jwt", "samlresponse",
        "api_key", "apikey"
    ]
    private static let unsafeObjectKeys: Set<String> = ["__proto__", "prototype", "constructor"]

    static func safeHTTPSURL(_ raw: String) -> URL? {
        guard raw.utf8.count <= 4096,
              raw.rangeOfCharacter(from: .controlCharacters) == nil,
              !raw.contains("\\"), !raw.contains(where: { $0.isWhitespace }),
              let parts = URLComponents(string: raw),
              parts.scheme?.lowercased() == "https",
              let host = parts.host?.lowercased(), !host.hasSuffix("."),
              host.utf8.count <= 253,
              parts.user == nil, parts.password == nil,
              parts.port == nil || parts.port == 443,
              let url = parts.url else { return nil }

        // School and Microsoft hosts are DNS names. Reject Unicode/encoded host
        // spellings and malformed labels so host checks cannot be parser-dependent.
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard !labels.isEmpty, labels.allSatisfy({ label in
            label.utf8.count <= 63 && label.range(of: "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$", options: .regularExpression) != nil
        }) else { return nil }

        if (parts.queryItems ?? []).contains(where: { secretQueryNames.contains($0.name.lowercased()) }) { return nil }
        if let fragment = parts.fragment?.removingPercentEncoding,
           fragment.range(of: "(?:^|[?&#])(?:access_token|refresh_token|id_token|token|client_secret|password|passwd|assertion|code|code_verifier|authorization|auth_token|oauth_token|oauth_verifier|session_token|sessionid|session_state|authkey|sig|signature|ticket|jwt|samlresponse|api_key|apikey)=", options: [.regularExpression, .caseInsensitive]) != nil {
            return nil
        }
        return url
    }

    static func isDashboardResourceURL(_ url: URL, resources: URL) -> Bool {
        guard url.isFileURL, url.query == nil else { return false }
        let expected = resources.appendingPathComponent("index.html", isDirectory: false).standardizedFileURL
        // Compare both lexical and resolved paths: a symlink under Resources may
        // otherwise make an outside HTML file appear to have a trusted origin.
        return isRegularNonSymlinkFile(expected, maximumBytes: 10_000_000) &&
            url.standardizedFileURL.path == expected.path &&
            url.resolvingSymlinksInPath().standardizedFileURL.path == expected.resolvingSymlinksInPath().standardizedFileURL.path
    }

    static func isRegularNonSymlinkFile(_ url: URL, maximumBytes: Int) -> Bool {
        guard url.isFileURL,
              let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber, size.intValue >= 0, size.intValue <= maximumBytes,
              url.standardizedFileURL.path == url.resolvingSymlinksInPath().standardizedFileURL.path else { return false }
        return true
    }

    static func isSafeHTTPHeaderValue(_ value: String) -> Bool {
        !value.isEmpty && value.unicodeScalars.allSatisfy { (0x21...0x7e).contains(Int($0.value)) }
    }

    static func validStateEnvelope(_ state: [String: Any]) -> Bool {
        guard JSONSerialization.isValidJSONObject(state),
              let data = try? JSONSerialization.data(withJSONObject: state), data.count <= maximumStateBytes,
              state["version"] as? Int == 1,
              let settings = state["settings"] as? [String: Any],
              let snapshots = state["snapshots"] as? [String: Any],
              snapshots["seiue"] as? [String: Any] != nil,
              snapshots["managebac"] as? [String: Any] != nil,
              (snapshots["teams"] == nil || snapshots["teams"] is [String: Any]),
              (snapshots["seiue"] as? [String: Any])?.count ?? 0 <= 250,
              (snapshots["managebac"] as? [String: Any])?.count ?? 0 <= 250,
              (snapshots["teams"] as? [String: Any])?.count ?? 0 <= 500,
              let tasks = state["manualTasks"] as? [Any], tasks.count <= 3000,
              let grades = state["gradeHistory"] as? [Any], grades.count <= 120,
              let changes = state["changeLog"] as? [Any], changes.count <= 600 else { return false }

        if let provider = settings["aiProvider"] as? String,
           !["off", "ollama", "deepseek", "hybrid", "auto"].contains(provider) { return false }
        if let mode = settings["teamsMode"] as? String, !["browser", "graph"].contains(mode) { return false }
        if let browser = settings["teamsBrowser"] as? String, !["chrome", "edge"].contains(browser) { return false }

        var remainingNodes = 1_000_000
        return inspectJSON(state, depth: 0, remainingNodes: &remainingNodes)
    }

    private static func inspectJSON(_ value: Any, depth: Int, remainingNodes: inout Int) -> Bool {
        guard depth <= 40, remainingNodes > 0 else { return false }
        remainingNodes -= 1
        if let object = value as? [String: Any] {
            for (key, child) in object {
                guard key.utf8.count <= 4096, !unsafeObjectKeys.contains(key),
                      inspectJSON(child, depth: depth + 1, remainingNodes: &remainingNodes) else { return false }
            }
            return true
        }
        if let array = value as? [Any] {
            guard array.count <= 10_000 else { return false }
            return array.allSatisfy { inspectJSON($0, depth: depth + 1, remainingNodes: &remainingNodes) }
        }
        if let string = value as? String { return string.utf8.count <= 1_000_000 }
        if value is NSNull { return true }
        if let number = value as? NSNumber { return number.doubleValue.isFinite }
        return false
    }
}
