import Foundation

/// Public builds contain no school-specific endpoint. A private, per-user
/// configuration in Application Support can override the bundled defaults so
/// upgrading the app does not remove the user's school login entry points.
struct CampusSchoolConfiguration {
    let homes: [String: String]
    static let sources = ["seiue", "managebac"]
    static let help = "尚未配置学校登录地址。请在 Application Support/CampusDesk/SchoolConfig.json 中填写学校 HTTPS 根地址后重新打开应用；Teams 不受影响。"

    init(_ values: [String: Any] = [:]) {
        var result = [String: String]()
        for source in Self.sources {
            if let value = values[source] as? String, let home = Self.validatedHome(value, source: source) { result[source] = home }
        }
        homes = result
    }
    private static func read(_ url: URL?) -> [String: Any]? {
        guard let url,
              let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
              values.isRegularFile == true, let size = values.fileSize, size <= 8192,
              let data = try? Data(contentsOf: url), data.count <= 8192,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object
    }
    static func load(resources: URL?, userConfig: URL? = nil) -> CampusSchoolConfiguration {
        var values = read(resources?.appendingPathComponent("SchoolConfig.json")) ?? [:]
        if let local = read(userConfig) {
            // Only the two known keys can override the public defaults. Empty
            // values deliberately disable one provider without affecting the other.
            for source in sources where local[source] != nil { values[source] = local[source] }
        }
        return Self(values)
    }
    var frontend: [String: String] {
        Dictionary(uniqueKeysWithValues: Self.sources.map { ($0, homes[$0] ?? "") })
    }
    static func validatedHome(_ raw: String, source: String) -> String? {
        guard raw.count <= 2048,
              raw.range(of: "^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::443)?/?$", options: [.regularExpression, .caseInsensitive]) != nil,
              let parts = URLComponents(string: raw), parts.scheme?.lowercased() == "https",
              let host = parts.host?.lowercased(), host.count <= 253,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.port == nil || parts.port == 443,
              parts.path.isEmpty || parts.path == "/",
              host.split(separator: ".", omittingEmptySubsequences: false).allSatisfy({
                  !$0.isEmpty && $0.count <= 63 && $0.range(of: "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$", options: .regularExpression) != nil
              }) else { return nil }
        let domains = source == "seiue" ? ["seiue.com"] : source == "managebac" ? ["managebac.com", "managebac.cn"] : []
        guard domains.contains(where: { host == $0 || host.hasSuffix("." + $0) }) else { return nil }
        return "https://" + host + "/"
    }
}
