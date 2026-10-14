import Foundation

@main enum WidgetSnapshotSmoke {
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("CampusWidgetTests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("agenda.json")
        let now = CampusWidgetSnapshot.timestamp("2026-10-10T02:00:00Z")!
        func item(_ id: String, _ kind: String, _ start: String?, _ end: String? = nil, completed: Bool = false, date: String = "2026-10-10", allDay: Bool = false) -> [String: Any] {
            ["id": id, "title": id, "kind": kind, "source": "personal", "date": date, "startAt": start as Any? ?? NSNull(), "endAt": end as Any? ?? NSNull(), "allDay": allDay, "completed": completed]
        }
        var document: [String: Any] = ["schemaVersion": 1, "generatedAt": "2026-10-10T01:00:00.000Z", "day": "2026-10-10", "timezone": "Asia/Shanghai", "counts": ["today": 5, "upcoming": 5, "overdue": 1], "items": [
            item("expired-course", "course", "2026-10-10T00:00:00Z", "2026-10-10T01:00:00Z"),
            item("next-course", "course", "2026-10-10T03:00:00Z", "2026-10-10T04:00:00Z"),
            item("overdue-task", "task", "2026-10-10T01:00:00Z"),
            item("future-task", "task", "2026-10-10T08:00:00Z"),
            item("done", "task", "2026-10-10T01:00:00Z", completed: true)
        ]]
        var checks = 0
        func check(_ value: @autoclosure () -> Bool, _ message: String) {
            guard value() else { fatalError(message) }; checks += 1
        }
        func save() throws { try JSONSerialization.data(withJSONObject: document).write(to: url, options: .atomic) }
        try save()
        guard let snapshot = CampusWidgetSnapshot.read(from: url) else { fatalError("valid projection rejected") }
        check(snapshot.visibleItems(deadlines: true, now: now).map(\.id) == ["overdue-task", "future-task"], "deadline order and completed filtering")
        check(!snapshot.visibleItems(deadlines: false, now: now).contains { $0.id == "expired-course" }, "finished class must disappear")
        check(snapshot.visibleItems(deadlines: false, now: now).contains { $0.id == "next-course" }, "next class retained")
        check(snapshot.courses(now: now).map(\.id) == ["next-course"], "next-class widget ignores completed lessons and tasks")
        check(snapshot.courses(now: now.addingTimeInterval(3600)).first?.isOngoing(at: now.addingTimeInterval(3600)) == true, "class becomes ongoing at exact start")
        check(snapshot.courses(now: now.addingTimeInterval(7200)).isEmpty, "class stops being ongoing at exact end")
        let future = snapshot.items.first { $0.id == "future-task" }!
        let overdue = snapshot.items.first { $0.id == "overdue-task" }!
        check(future.deadlineStatus(at: now)?.remainingText == "剩 6 小时", "deadline countdown uses exact remaining interval")
        check(future.deadlineStatus(at: future.start!)?.remainingText == "现在截止", "exact deadline does not display a negative or zero-hour duration")
        check(future.deadlineStatus(at: future.start!.addingTimeInterval(-1))?.remainingText == "剩 1 分钟", "sub-minute future deadline rounds up")
        check(overdue.deadlineStatus(at: now)?.urgency == .overdue, "overdue has separate urgency")
        check(overdue.deadlineStatus(at: now)?.pressure == 1, "overdue pressure clamps at full")
        check(future.deadlineStatus(at: now.addingTimeInterval(-86400 * 8))?.pressure == 0, "distant deadline pressure clamps at zero")
        check(snapshot.items.first { $0.id == "done" }?.deadlineStatus(at: now) == nil, "completed task has no active urgency")
        check(snapshot.visibleItems(deadlines: false, now: now.addingTimeInterval(86_400)).isEmpty, "midnight must not show yesterday as today")
        check(!snapshot.isStale(at: now), "recent snapshot not stale")
        check(snapshot.isStale(at: now.addingTimeInterval(86_400)), "stale snapshot visible to user")
        check(!snapshot.isExpired(at: CampusWidgetSnapshot.timestamp("2026-10-17T15:59:59Z")!), "cached final day is included until Beijing midnight")
        check(snapshot.isExpired(at: CampusWidgetSnapshot.timestamp("2026-10-17T16:00:00Z")!), "projection expires at the end of its eight inclusive dates")
        check(snapshot.visibleItems(deadlines: true, now: now.addingTimeInterval(86400 * 9)).isEmpty, "expired projection cannot claim old tasks are current")
        check(CampusWidgetSnapshot.dayString(CampusWidgetSnapshot.timestamp("2026-10-09T17:00:00Z")!) == "2026-10-10", "Beijing midnight independent of host zone")
        check(!CampusWidgetSnapshot.validDay("2026-02-30") && CampusWidgetSnapshot.validDay("2028-02-29"), "strict calendar day validation")
        check(CampusWidgetSnapshot.link(day: "2026-10-10").absoluteString == "campusdesk-theme://calendar?date=2026-10-10", "bounded calendar deep link")
        document["items"] = [
            item("finished-course", "course", "2026-10-10T00:00:00Z", "2026-10-10T01:00:00Z"),
            item("current-course", "course", "2026-10-10T01:30:00Z", "2026-10-10T02:30:00Z"),
            item("tomorrow-course", "course", "2026-10-11T00:00:00Z", "2026-10-11T01:00:00Z", date: "2026-10-11"),
            item("done-course", "course", "2026-10-10T03:00:00Z", "2026-10-10T04:00:00Z", completed: true),
            item("school-all-day", "school", "2026-10-09T16:00:00Z", "2026-10-10T16:00:00Z", allDay: true),
            item("current-personal-event", "personal", "2026-10-10T01:00:00Z", "2026-10-10T03:00:00Z"),
            item("finished-school-event", "school", "2026-10-10T00:00:00Z", "2026-10-10T01:00:00Z"),
            item("finished-personal-event", "personal", "2026-10-10T00:00:00Z", "2026-10-10T01:00:00Z"),
            item("past-single-event", "personal", "2026-10-10T01:00:00Z"),
            item("yesterday-school-event", "school", "2026-10-08T16:00:00Z", "2026-10-09T16:00:00Z", date: "2026-10-09", allDay: true),
            item("tomorrow-school-event", "school", "2026-10-11T02:00:00Z", "2026-10-11T03:00:00Z", date: "2026-10-11"),
            item("done-personal-event", "personal", "2026-10-10T04:00:00Z", completed: true),
            item("older-overdue", "task", "2026-10-09T08:00:00Z", date: "2026-10-09"),
            item("recent-overdue", "task", "2026-10-10T01:00:00Z"),
            item("nearest-homework", "task", "2026-10-10T03:00:00Z"),
            item("later-homework", "task", "2026-10-11T03:00:00Z", date: "2026-10-11"),
            item("undated-homework", "task", nil),
            item("done-homework", "task", "2026-10-10T00:00:00Z", completed: true)
        ]
        try save()
        guard let overview = CampusWidgetSnapshot.read(from: url) else { fatalError("mixed overview projection rejected") }
        check(overview.courses(now: now).map(\.id) == ["current-course", "tomorrow-course"], "course section retains tomorrow and excludes finished or completed lessons")
        check(overview.courses(now: now.addingTimeInterval(1800)).map(\.id) == ["tomorrow-course"], "after today's last class ends the next day's class remains available")
        check(overview.calendarEvents(now: now).map(\.id) == ["school-all-day", "current-personal-event", "tomorrow-school-event"], "calendar section contains active or future school and personal events only")
        check(overview.calendarEvents(now: now.addingTimeInterval(3600)).map(\.id) == ["school-all-day", "tomorrow-school-event"], "calendar event disappears at its exact ending time")
        check(overview.calendarEvents(now: CampusWidgetSnapshot.timestamp("2026-10-10T16:00:00Z")!).map(\.id) == ["tomorrow-school-event"], "all-day calendar event disappears at Beijing midnight")
        let homework = overview.homework(now: now)
        check(homework.map(\.id) == ["recent-overdue", "older-overdue", "nearest-homework", "later-homework", "undated-homework"], "homework prioritizes recent overdue work, then nearest deadlines, then undated tasks")
        check(homework.allSatisfy { $0.kind == "task" && !$0.completed }, "homework section excludes courses, calendar events and completed work")
        check(homework.last?.start == nil && homework.last?.deadlineStatus(at: now) == nil, "missing deadline stays missing without a fabricated date or countdown")
        check(overview.visibleItems(deadlines: true, now: now).map(\.id) == homework.map(\.id), "dedicated deadline widget uses the same complete homework selection")
        let expired = now.addingTimeInterval(86400 * 9)
        check(overview.courses(now: expired).isEmpty && overview.calendarEvents(now: expired).isEmpty && overview.homework(now: expired).isEmpty, "all three sections reject an expired projection")
        let symlink = directory.appendingPathComponent("link.json")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: url)
        check(CampusWidgetSnapshot.read(from: symlink) == nil, "reject symlink snapshot")
        check(CampusWidgetSnapshot.load(from: symlink).issue == .invalid, "symlink failure is distinguished from missing data")
        check(CampusWidgetSnapshot.load(from: directory.appendingPathComponent("absent.json")).issue == .missing, "missing projection has actionable empty state")
        check(CampusWidgetSnapshot.load(from: nil).issue == .unavailable, "unresolved home directory produces explicit unavailable state")
        document["timezone"] = "America/New_York"; try save()
        check(CampusWidgetSnapshot.read(from: url) == nil, "reject inconsistent source timezone")
        document["timezone"] = "Asia/Shanghai"; document["schemaVersion"] = 2; try save()
        check(CampusWidgetSnapshot.read(from: url) == nil, "reject incompatible schema")
        document["schemaVersion"] = 1; document["items"] = [item("duplicate", "task", nil), item("duplicate", "task", nil)]; try save()
        check(CampusWidgetSnapshot.read(from: url) == nil, "reject duplicate row identities")
        document["items"] = Array(repeating: item("too-many", "task", nil), count: 101); try save()
        check(CampusWidgetSnapshot.read(from: url) == nil, "reject oversized row count")
        try Data(repeating: 0x20, count: CampusWidgetSnapshot.maximumBytes + 1).write(to: url)
        check(CampusWidgetSnapshot.read(from: url) == nil, "reject oversized file before JSON allocation")
        check(CampusWidgetSnapshot.load(from: url).issue == .invalid, "oversized file reports invalid rather than asking to sync again")
        print("PASS \(checks) native WidgetKit snapshot checks")
    }
}
