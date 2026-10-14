import Foundation
import Darwin

enum CampusWidgetReadIssue: Equatable {
    case missing, permission, invalid, unavailable
    var title: String {
        switch self {
        case .missing: return "打开 CampusDesk"
        case .permission: return "暂时无法读取日程"
        case .invalid: return "日程摘要需要重建"
        case .unavailable: return "日程暂不可用"
        }
    }
    var detail: String {
        switch self {
        case .missing: return "在行事历中点刷新小组件"
        case .permission: return "请打开应用刷新；仍失败请重新添加组件"
        case .invalid: return "打开应用刷新小组件即可重建"
        case .unavailable: return "点击打开应用后重试"
        }
    }
}

struct CampusWidgetLoadResult {
    let snapshot: CampusWidgetSnapshot?
    let issue: CampusWidgetReadIssue?
}

struct CampusWidgetDeadlineStatus {
    enum Urgency { case overdue, urgent, soon, normal, relaxed }
    let urgency: Urgency
    let label: String
    let remainingText: String
    // A fixed seven-day deadline pressure scale, never a completion percentage.
    let pressure: Double
}

struct CampusWidgetItem: Decodable, Identifiable {
    let id: String
    let title: String
    let kind: String
    let source: String
    let date: String
    let startAt: String?
    let endAt: String?
    let allDay: Bool
    let completed: Bool
    let location: String?

    var start: Date? { startAt.flatMap(CampusWidgetSnapshot.timestamp) }
    var end: Date? { endAt.flatMap(CampusWidgetSnapshot.timestamp) }
    var isTask: Bool { kind == "task" }

    func isOngoing(at now: Date) -> Bool {
        guard !completed, !allDay, !isTask, let start, let end else { return false }
        return start <= now && now < end
    }

    func deadlineStatus(at now: Date) -> CampusWidgetDeadlineStatus? {
        guard isTask, !completed, let start else { return nil }
        let remaining = start.timeIntervalSince(now)
        let urgency: CampusWidgetDeadlineStatus.Urgency
        let label: String
        switch remaining {
        case ..<0: urgency = .overdue; label = "已逾期"
        case ...3600: urgency = .urgent; label = "紧急"
        case ...86400: urgency = .soon; label = "较急"
        case ...259200: urgency = .normal; label = "正常"
        default: urgency = .relaxed; label = "充裕"
        }
        let minutes = Int(ceil(abs(remaining) / 60))
        let duration: String
        if minutes < 60 { duration = "\(max(1, minutes)) 分钟" }
        else if minutes < 1440 { duration = "\(minutes / 60) 小时" + (minutes % 60 > 0 ? " \(minutes % 60) 分钟" : "") }
        else { duration = "\(minutes / 1440) 天" + ((minutes % 1440) / 60 > 0 ? " \((minutes % 1440) / 60) 小时" : "") }
        let text = remaining == 0 ? "现在截止" : (remaining < 0 ? "已逾期 " : "剩 ") + duration
        return .init(urgency: urgency, label: label, remainingText: text, pressure: 1 - min(1, max(0, remaining) / (7 * 86400)))
    }
}

struct CampusWidgetSnapshot: Decodable {
    struct Counts: Decodable { let today: Int; let upcoming: Int; let overdue: Int }
    let schemaVersion: Int
    let generatedAt: String
    let day: String
    let timezone: String
    let items: [CampusWidgetItem]
    let counts: Counts

    static let relativePath = "Library/Application Support/CampusDesk Widgets/agenda.json"
    static let maximumBytes = 262_144
    static var beijing: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return calendar
    }

    static func timestamp(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    static func dayString(_ date: Date) -> String {
        let components = beijing.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
    }

    static func fileURL() -> URL? {
        guard let home = getpwuid(getuid())?.pointee.pw_dir else { return nil }
        return URL(fileURLWithPath: String(cString: home), isDirectory: true).appendingPathComponent(relativePath)
    }

    static func read(from url: URL? = fileURL()) -> CampusWidgetSnapshot? {
        load(from: url).snapshot
    }

    static func load(from url: URL? = fileURL()) -> CampusWidgetLoadResult {
        guard let url else { return .init(snapshot: nil, issue: .unavailable) }
        // Read only the app-published projection. Reject symlinks and large files
        // before allocating or decoding; this target has no network entitlement.
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else {
            let issue: CampusWidgetReadIssue
            switch errno {
            case ENOENT: issue = .missing
            case EPERM, EACCES: issue = .permission
            case ELOOP: issue = .invalid
            default: issue = .unavailable
            }
            return .init(snapshot: nil, issue: issue)
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var info = stat()
        guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_size > 0, info.st_size <= maximumBytes,
              let data = try? handle.read(upToCount: maximumBytes + 1), data.count <= maximumBytes,
              let snapshot = try? JSONDecoder().decode(Self.self, from: data),
              snapshot.schemaVersion == 1, snapshot.timezone == "Asia/Shanghai",
              snapshot.items.count <= 100, timestamp(snapshot.generatedAt) != nil,
              snapshot.counts.today >= 0, snapshot.counts.upcoming >= 0, snapshot.counts.overdue >= 0,
              validDay(snapshot.day), Set(snapshot.items.map(\.id)).count == snapshot.items.count,
              snapshot.items.allSatisfy({ item in
                  !item.id.isEmpty && item.id.count <= 700 && !item.title.isEmpty && item.title.count <= 180 &&
                  ["course", "task", "school", "personal"].contains(item.kind) && validDay(item.date) &&
                  (item.location?.count ?? 0) <= 160 && item.source.count <= 100 &&
                  (item.startAt == nil || item.start != nil) && (item.endAt == nil || item.end != nil) &&
                  (item.start == nil || item.end == nil || item.end! >= item.start!)
              }) else { return .init(snapshot: nil, issue: .invalid) }
        return .init(snapshot: snapshot, issue: nil)
    }

    static func validDay(_ value: String) -> Bool {
        guard value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return false }
        let formatter = DateFormatter()
        formatter.calendar = beijing
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = beijing.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let date = formatter.date(from: value) else { return false }
        return formatter.string(from: date) == value && value >= "1900-01-01" && value <= "2199-12-31"
    }

    func isStale(at now: Date) -> Bool {
        guard let generated = Self.timestamp(generatedAt) else { return true }
        return now.timeIntervalSince(generated) > 24 * 60 * 60 || generated.timeIntervalSince(now) > 300
    }

    func isExpired(at now: Date) -> Bool {
        guard let generated = Self.timestamp(generatedAt), let firstDay = Self.timestamp(day + "T00:00:00+08:00"),
              let coverageEnd = Self.beijing.date(byAdding: .day, value: 8, to: firstDay) else { return true }
        return now >= coverageEnd || generated.timeIntervalSince(now) > 300
    }

    func courses(now: Date) -> [CampusWidgetItem] {
        guard !isExpired(at: now) else { return [] }
        return items.filter { item in
            guard item.kind == "course", !item.completed, let start = item.start else { return false }
            return item.end.map { $0 > now } ?? (start >= now)
        }.sorted {
            if $0.isOngoing(at: now) != $1.isOngoing(at: now) { return $0.isOngoing(at: now) }
            if $0.start != $1.start { return $0.start! < $1.start! }
            return $0.id < $1.id
        }
    }

    func calendarEvents(now: Date) -> [CampusWidgetItem] {
        guard !isExpired(at: now) else { return [] }
        let today = Self.dayString(now)
        return items.filter { item in
            guard ["school", "personal"].contains(item.kind), !item.completed, item.date >= today else { return false }
            if let end = item.end { return end > now }
            return item.allDay || item.start.map { $0 >= now } != false
        }.sorted {
            if $0.date != $1.date { return $0.date < $1.date }
            if $0.allDay != $1.allDay { return $0.allDay }
            if $0.start != $1.start { return ($0.start ?? .distantPast) < ($1.start ?? .distantPast) }
            return $0.id < $1.id
        }
    }

    func homework(now: Date) -> [CampusWidgetItem] {
        guard !isExpired(at: now) else { return [] }
        return items.filter { $0.isTask && !$0.completed }.sorted { lhs, rhs in
            // Show recently missed deadlines first, then the nearest upcoming
            // deadline, then tasks whose deadline is unknown. Never invent one.
            let left = lhs.start, right = rhs.start
            if (left == nil) != (right == nil) { return left != nil }
            if let left, let right, left != right {
                let leftOverdue = left < now, rightOverdue = right < now
                if leftOverdue != rightOverdue { return leftOverdue }
                return leftOverdue ? left > right : left < right
            }
            return lhs.id < rhs.id
        }
    }

    func visibleItems(deadlines: Bool, now: Date) -> [CampusWidgetItem] {
        guard !isExpired(at: now) else { return [] }
        if deadlines { return homework(now: now) }
        let today = Self.dayString(now)
        return items.filter { item in
            guard !item.completed else { return false }
            guard item.date == today else { return false }
            if !item.allDay, ["course", "personal"].contains(item.kind), let end = item.end { return end > now }
            return true
        }.sorted { lhs, rhs in
            if !deadlines, lhs.allDay != rhs.allDay { return lhs.allDay }
            let left = lhs.start ?? .distantPast, right = rhs.start ?? .distantPast
            if left != right { return left < right }
            if lhs.title != rhs.title { return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending }
            return lhs.id < rhs.id
        }
    }

    static func link(day: String) -> URL {
        URL(string: "campusdesk-theme://calendar?date=\(validDay(day) ? day : dayString(Date()))")!
    }
}
