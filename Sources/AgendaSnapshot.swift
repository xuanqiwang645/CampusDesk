import Foundation
import JavaScriptCore

/// Computes a small display-only projection on its owning background queue.
/// Input is an immutable state that has already passed the native validator.
final class CampusAgendaSnapshotBuilder {
    private let context: JSContext
    private var cachedReader: (input: NSDictionary, render: JSValue)?

    init(resources: URL, themeEdition: Bool) throws {
        guard let context = JSContext() else { throw CampusAgendaSnapshotError.unavailable }
        self.context = context
        context.setObject(themeEdition, forKeyedSubscript: "CampusDeskThemeEdition" as NSString)
        for name in ["core.js", "agenda.js"] {
            let url = resources.appendingPathComponent(name)
            context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
            guard context.exception == nil else { throw CampusAgendaSnapshotError.unavailable }
        }
        context.evaluateScript("""
        function __campusAgendaReader(encoded) {
            const read = CampusAgenda.widgetSnapshotReader(JSON.parse(encoded));
            return now => JSON.stringify(read(now));
        }
        """)
        guard context.exception == nil else { throw CampusAgendaSnapshotError.unavailable }
    }

    // Keep the inputs to CampusCore.getTasks/getSchedule and the calendar.
    // Unrelated histories, Teams posts and feedback can be several MiB.
    private func reader(for state: [String: Any]) throws -> JSValue {
        guard let sources = state["snapshots"] as? [String: [String: [String: Any]]],
              let settings = state["settings"] as? [String: Any] else { throw CampusAgendaSnapshotError.invalid }
        var input = state.filter { ["manualTasks", "personalEvents", "taskChecks", "schoolCalendar"].contains($0.key) }
        input["settings"] = settings.filter {
            ["timezone", "selfStudy", "scheduleWeekAnchor", "scheduleHolidays", "scheduleOverrides",
             "customLessons", "teamsDueOverrides", "gpaTermDates"].contains($0.key)
        }
        input["snapshots"] = sources.mapValues { pages in
            pages.mapValues { page in
                page.filter { ["accountId", "url", "capturedAt", "schedule", "calendarDates", "periods", "tasks", "courses"].contains($0.key) }
            }
        }
        let comparable = input as NSDictionary
        if let cachedReader, cachedReader.input.isEqual(comparable) { return cachedReader.render }
        let bytes = try JSONSerialization.data(withJSONObject: comparable)
        guard bytes.count <= 25 * 1024 * 1024, let encoded = String(data: bytes, encoding: .utf8),
              let render = context.objectForKeyedSubscript("__campusAgendaReader")?.call(withArguments: [encoded]),
              context.exception == nil, render.isObject else { throw CampusAgendaSnapshotError.invalid }
        cachedReader = (comparable, render)
        return render
    }

    func snapshot(state: [String: Any], now: Date = Date()) throws -> Data {
        context.exception = nil
        guard let value = try reader(for: state).call(withArguments: [now.timeIntervalSince1970 * 1000])?.toString(),
              context.exception == nil else { throw CampusAgendaSnapshotError.invalid }
        let data = Data(value.utf8)
        guard data.count <= 262_144,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["schemaVersion"] as? Int == 1,
              let items = object["items"] as? [[String: Any]], items.count <= 100 else {
            throw CampusAgendaSnapshotError.invalid
        }
        return data
    }
}

enum CampusAgendaSnapshotError: LocalizedError {
    case unavailable, invalid
    var errorDescription: String? {
        switch self {
        case .unavailable: return "行事历组件文件无法加载，请重新安装完整应用。"
        case .invalid: return "行事历摘要未能更新，请重新打开 CampusDesk 后重试。"
        }
    }
}

enum CampusAgendaLink {
    static func isTasks(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme == "campusdesk-theme" && parts.host == "tasks" &&
            parts.user == nil && parts.password == nil && parts.port == nil &&
            (parts.path.isEmpty || parts.path == "/") && parts.query == nil && parts.fragment == nil
    }

    static func day(from url: URL) -> String? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "campusdesk-theme", parts.host == "calendar",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.path.isEmpty || parts.path == "/", parts.fragment == nil else { return nil }
        let queries = parts.queryItems ?? []
        guard queries.count == 1, queries.first?.name == "date", let day = queries.first?.value,
              day.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return nil }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let date = formatter.date(from: day), formatter.string(from: date) == day,
              day >= "1900-01-01", day <= "2199-12-31" else { return nil }
        return day
    }
}
