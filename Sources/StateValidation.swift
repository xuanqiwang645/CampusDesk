import Foundation
import JavaScriptCore
import Darwin

struct CampusStateValidationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// The disk reader and writer run the dashboard's actual schema, including its
/// migrations. An envelope-only check cannot establish that a backup is usable.
final class CampusStateValidator {
    /// Only this validator can produce a prepared commit. The serialized bytes
    /// belong to the validated snapshot, never to a later mutable UI state.
    struct PreparedState {
        let state: [String: Any]
        fileprivate let data: Data
        fileprivate let schools: [String: String]
        fileprivate let owner: UUID
    }
    private let context: JSContext
    private let lock = NSRecursiveLock()
    private let identity = UUID()
    private var lastCommit: (path: String, data: Data, schools: [String: String])?

    init(resources: URL, themeEdition: Bool) throws {
        guard let context = JSContext(),
              let script = try? String(contentsOf: resources.appendingPathComponent("core.js"), encoding: .utf8) else {
            throw CampusStateValidationError(message: "无法加载数据校验文件，请重新安装完整应用。")
        }
        self.context = context
        // JavaScriptCore has Intl but no DOM URL classes. Supply only the URL
        // fields used by core.js; Foundation performs parsing, never networking.
        let urlCache = NSCache<NSString, NSString>()
        urlCache.countLimit = 2048
        urlCache.totalCostLimit = 2 * 1024 * 1024
        let parseURL: @convention(block) (String) -> String? = { raw in
            if let cached = urlCache.object(forKey: raw as NSString) { return cached as String }
            guard let encoded = Self.urlJSON(raw) else { return nil }
            urlCache.setObject(encoded as NSString, forKey: raw as NSString, cost: raw.utf8.count + encoded.utf8.count)
            return encoded
        }
        context.setObject(parseURL, forKeyedSubscript: "__campusParseURL" as NSString)
        context.setObject(themeEdition, forKeyedSubscript: "CampusDeskThemeEdition" as NSString)
        context.evaluateScript("""
        class URLSearchParams {
          constructor(value) {
            const decode = value => { try { return decodeURIComponent(value.replace(/\\+/g, ' ')); } catch (_) { return value; } };
            this.names = String(value || '').replace(/^\\?/, '').split('&').filter(Boolean).map(part => decode(part.split('=')[0]));
          }
          keys() { return this.names.values(); }
        }
        class URL {
          constructor(value) {
            const encoded = __campusParseURL(String(value));
            if (!encoded) throw new TypeError('Invalid URL');
            Object.assign(this, JSON.parse(encoded));
            this.searchParams = new URLSearchParams(this.search);
          }
        }
        """)
        context.evaluateScript(script, withSourceURL: resources.appendingPathComponent("core.js"))
        guard context.exception == nil,
              context.objectForKeyedSubscript("CampusCore")?.isObject == true else {
            throw CampusStateValidationError(message: "数据校验文件无法运行，请重新安装完整应用。")
        }
        context.evaluateScript("""
        function __campusStateOperation(operation, encoded, schools, allowLegacy) {
          try {
            CampusCore.configureSchools(JSON.parse(schools));
            const input = JSON.parse(encoded);
            const value = operation === 'export' ? CampusCore.exportBackup(input)
              : operation === 'import' ? CampusCore.importBackup(input, {allowLegacy: allowLegacy})
              : CampusCore.validateState(input);
            return JSON.stringify({ok: true, encoded: JSON.stringify(value)});
          } catch (error) { return JSON.stringify({ok: false, error: String(error.message || error)}); }
        }
        """)
        guard context.exception == nil else {
            throw CampusStateValidationError(message: "数据校验器未能初始化。")
        }
    }

    func validate(_ state: [String: Any], schools: [String: String] = [:]) throws -> [String: Any] {
        try run("validate", value: state, schools: schools)
    }

    func prepare(_ state: [String: Any], schools: [String: String] = [:]) throws -> PreparedState {
        let result = try runEncoded("validate", value: state, schools: schools)
        return PreparedState(state: result.state, data: result.data, schools: schools, owner: identity)
    }

    func exportBackup(_ state: [String: Any], schools: [String: String] = [:]) throws -> [String: Any] {
        try run("export", value: state, schools: schools)
    }

    func importBackup(_ backup: [String: Any], allowLegacy: Bool = false, schools: [String: String] = [:]) throws -> (state: [String: Any], legacy: Bool) {
        let result = try run("import", value: backup, schools: schools, allowLegacy: allowLegacy)
        guard let state = result["state"] as? [String: Any], let legacy = result["legacy"] as? Bool else {
            throw CampusStateValidationError(message: "备份格式无效。")
        }
        return (state, legacy)
    }

    func read(_ url: URL, schools: [String: String] = [:]) throws -> [String: Any] {
        try validate(Self.readObject(url), schools: schools)
    }

    static func readObject(_ url: URL) throws -> [String: Any] {
        guard CampusSecurity.isRegularNonSymlinkFile(url, maximumBytes: CampusSecurity.maximumStateBytes) else {
            throw CampusStateValidationError(message: "文件不是有效的 CampusDesk 数据，或超过 25 MiB。")
        }
        let data = try Data(contentsOf: url)
        guard data.count <= CampusSecurity.maximumStateBytes,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CampusStateValidationError(message: "文件不是有效的 JSON 对象。")
        }
        return object
    }

    /// Validate the new state and the old recovery point before either write.
    /// An invalid primary can never replace a known-good previous state.
    @discardableResult func write(_ state: [String: Any], to url: URL, previous: URL?, schools: [String: String] = [:]) throws -> [String: Any] {
        try writePrepared(prepare(state, schools: schools), to: url, previous: previous)
    }

    @discardableResult func writePrepared(_ prepared: PreparedState, to url: URL, previous: URL?) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        guard prepared.owner == identity else { throw CampusStateValidationError(message: "数据校验上下文已变更，请重新保存。") }
        if let previous, CampusSecurity.isRegularNonSymlinkFile(url, maximumBytes: CampusSecurity.maximumStateBytes) {
            // Only reuse the last successful validation when the *actual bytes*
            // and school configuration still match. External edits/corruption
            // must pass the full schema before they can become a recovery point.
            if let cached = lastCommit, cached.path == url.path, cached.schools == prepared.schools,
               let disk = try? Data(contentsOf: url), disk == cached.data {
                try Self.writePrivate(cached.data, to: previous)
            } else if let validPrevious = try? prepare(Self.readObject(url), schools: prepared.schools) {
                try Self.writePrivate(validPrevious.data, to: previous)
            }
        }
        try Self.writePrivate(prepared.data, to: url)
        lastCommit = (url.path, prepared.data, prepared.schools)
        return prepared.state
    }

    func preserveBeforeImport(_ state: [String: Any], directory: URL, schools: [String: String] = [:]) throws -> URL {
        let envelope = try exportBackup(state, schools: schools)
        let target = directory.appendingPathComponent("state.before-import-" + UUID().uuidString + ".json")
        try Self.writePrivate(try Self.encode(envelope), to: target)
        return target
    }

    /// The caller keeps its current in-memory state until this entire operation
    /// returns. Preparation may revoke account bindings only after recovery is safe.
    func commitImport(_ candidate: [String: Any], replacing current: [String: Any], to url: URL,
                      previous: URL?, schools: [String: String] = [:], prepare: () throws -> Void) throws -> [String: Any] {
        let prepared = try self.prepare(candidate, schools: schools)
        _ = try preserveBeforeImport(current, directory: url.deletingLastPathComponent(), schools: schools)
        try prepare()
        return try writePrepared(prepared, to: url, previous: previous)
    }

    static func encode(_ object: [String: Any]) throws -> Data {
        guard JSONSerialization.isValidJSONObject(object) else { throw CampusStateValidationError(message: "数据不是有效的 JSON。") }
        // State dictionaries have no order contract. Sorting every nested key
        // on each sync page is expensive and adds no validation or durability.
        let data = try JSONSerialization.data(withJSONObject: object)
        guard data.count <= CampusSecurity.maximumStateBytes else { throw CampusStateValidationError(message: "数据超过 25 MiB，未覆盖磁盘备份。") }
        return data
    }

    static func writePrivate(_ data: Data, to url: URL) throws {
        let staged = url.deletingLastPathComponent().appendingPathComponent(".CampusDesk-write-" + UUID().uuidString + ".tmp")
        guard FileManager.default.createFile(atPath: staged.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
            throw CampusStateValidationError(message: "无法建立安全写入文件，原文件保持不变。")
        }
        defer { try? FileManager.default.removeItem(at: staged) }
        try data.write(to: staged)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: staged.path)
        let result = staged.path.withCString { source in url.path.withCString { target in Darwin.rename(source, target) } }
        guard result == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    }

    private func run(_ operation: String, value: [String: Any], schools: [String: String], allowLegacy: Bool = false) throws -> [String: Any] {
        try runEncoded(operation, value: value, schools: schools, allowLegacy: allowLegacy).state
    }

    private func runEncoded(_ operation: String, value: [String: Any], schools: [String: String], allowLegacy: Bool = false) throws -> (state: [String: Any], data: Data) {
        let data = try Self.encode(value)
        let schoolData = try JSONSerialization.data(withJSONObject: schools)
        guard let encoded = String(data: data, encoding: .utf8), let schoolJSON = String(data: schoolData, encoding: .utf8) else {
            throw CampusStateValidationError(message: "无法读取数据文本。")
        }
        lock.lock(); defer { lock.unlock() }
        context.exception = nil
        guard let returned = context.objectForKeyedSubscript("__campusStateOperation")?.call(withArguments: [operation, encoded, schoolJSON, allowLegacy])?.toString(),
              context.exception == nil,
              let response = try JSONSerialization.jsonObject(with: Data(returned.utf8)) as? [String: Any] else {
            throw CampusStateValidationError(message: "无法完成数据格式校验。")
        }
        guard response["ok"] as? Bool == true, let encodedResult = response["encoded"] as? String else {
            throw CampusStateValidationError(message: response["error"] as? String ?? "数据格式无效。")
        }
        // JavaScript has already serialized the fully validated object. Reuse
        // those bytes rather than walking/serializing megabytes again in Swift.
        let resultData = Data(encodedResult.utf8)
        guard resultData.count <= CampusSecurity.maximumStateBytes else {
            throw CampusStateValidationError(message: "数据超过 25 MiB，未覆盖磁盘备份。")
        }
        guard let result = try JSONSerialization.jsonObject(with: resultData) as? [String: Any] else {
            throw CampusStateValidationError(message: "无法读取已校验的数据。")
        }
        return (result, resultData)
    }

    private static func urlJSON(_ raw: String) -> String? {
        guard raw.utf8.count <= 16_384,
              var parts = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(), let host = parts.host?.lowercased(), !host.isEmpty else { return nil }
        parts.scheme = scheme; parts.host = host
        if scheme == "https" && parts.port == 443 { parts.port = nil }
        if scheme == "http" && parts.port == 80 { parts.port = nil }
        if parts.path.isEmpty { parts.path = "/" }
        guard let href = parts.url?.absoluteString else { return nil }
        let port = parts.port.map(String.init) ?? ""
        let values: [String: String] = ["href": href, "protocol": scheme + ":", "hostname": host,
            "username": parts.user ?? "", "password": parts.password ?? "", "port": port,
            "origin": scheme + "://" + host + (port.isEmpty ? "" : ":" + port), "pathname": parts.percentEncodedPath,
            "search": parts.percentEncodedQuery.map { "?" + $0 } ?? "", "hash": parts.percentEncodedFragment.map { "#" + $0 } ?? ""]
        guard let data = try? JSONSerialization.data(withJSONObject: values) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

enum CampusTeamsAccountState {
    static func needsReset(_ state: [String: Any], browserAccount: String) -> Bool {
        let snapshots = (state["snapshots"] as? [String: Any])?["teams"] as? [String: [String: Any]] ?? [:]
        return snapshots.values.contains { snapshot in
            snapshot["coverage"] as? String != "browser" || snapshot["accountId"] as? String != browserAccount
        }
    }

    static func reset(_ state: [String: Any]) -> [String: Any] {
        var result = state
        var snapshots = result["snapshots"] as? [String: Any] ?? [:]
        snapshots["teams"] = [String: Any](); result["snapshots"] = snapshots
        for key in ["taskChecks", "feedbackRead"] {
            if let values = result[key] as? [String: Any] { result[key] = values.filter { !$0.key.hasPrefix("teams:") } }
        }
        if var settings = result["settings"] as? [String: Any] {
            settings["teamsDueOverrides"] = [String: Any](); result["settings"] = settings
        }
        result["changeLog"] = (result["changeLog"] as? [[String: Any]] ?? []).filter { $0["source"] as? String != "teams" }
        return result
    }
}
