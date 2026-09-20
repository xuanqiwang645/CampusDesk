import Foundation

/// Public builds contain no school-specific endpoint. Configuration is bundled
/// at build time and never inferred from imported data or a remote page.
struct CampusSchoolConfiguration {
    let homes: [String: String]
    static let sources = ["seiue", "managebac"]
    static let help = "请在源码 Resources/SchoolConfig.json 配置学校 HTTPS 根地址后重新构建应用；未配置的学校系统不会连接，Teams 不受影响。"

    init(_ values: [String: Any] = [:]) {
        var result = [String: String]()
        for source in Self.sources {
            if let value = values[source] as? String, let home = Self.validatedHome(value, source: source) { result[source] = home }
        }
        homes = result
    }
    static func load(resources: URL?) -> CampusSchoolConfiguration {
        guard let url = resources?.appendingPathComponent("SchoolConfig.json"),
              let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 8192,
              let data = try? Data(contentsOf: url), data.count <= 8192,
              let values = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return Self() }
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
