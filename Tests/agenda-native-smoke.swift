import Foundation

@main
struct AgendaNativeSmoke {
    static func main() throws {
        var count = 0
        func check(_ condition: Bool, _ label: String) {
            guard condition else { fputs("FAIL: \(label)\n", stderr); exit(1) }
            count += 1
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        let resources = root.appendingPathComponent("Resources")
        let validator = try CampusStateValidator(resources: resources, themeEdition: true)
        var state = try validator.validate(["version": 1, "settings": [String: Any](),
            "snapshots": ["seiue": [String: Any](), "managebac": [String: Any](), "teams": [String: Any]()],
            "manualTasks": [Any](), "taskChecks": [String: Any](), "feedbackRead": [String: Any](), "gradeHistory": [Any]()])
        state["manualTasks"] = [["id": "manual-fixture", "title": "Finish local test", "course": "个人待办", "status": "open", "dueAt": "2026-10-10T10:30:00Z", "createdAt": "2026-10-09T01:00:00Z"]]
        state = try validator.validate(state)
        let builder = try CampusAgendaSnapshotBuilder(resources: resources, themeEdition: true)
        let now = ISO8601DateFormatter().date(from: "2026-10-10T04:00:00Z")!
        let data = try builder.snapshot(state: state, now: now)
        let snapshot = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let items = snapshot["items"] as! [[String: Any]]
        check(snapshot["schemaVersion"] as? Int == 1, "Native JavaScriptCore produces versioned widget data")
        check(snapshot["day"] as? String == "2026-10-10", "Snapshot day follows school timezone")
        check(items.contains { $0["title"] as? String == "Finish local test" }, "Saved personal deadline reaches widget projection")
        check(items.count <= 100 && data.count <= 262_144, "Widget projection remains bounded")
        check(!items.contains { $0["url"] != nil || $0["description"] != nil || $0["accountId"] != nil }, "Widget data excludes account and source details")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-agenda-smoke-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let target = directory.appendingPathComponent("agenda.json")
        let publisher = CampusAgendaPublication(resources: resources, target: target)
        check(try publisher.publish(state: state, now: now), "First durable state publishes a widget file")
        check(!(try publisher.publish(state: state, now: now.addingTimeInterval(60))), "Unrelated repeat saves do not reload WidgetKit")
        check(try publisher.publish(state: state, now: now.addingTimeInterval(120), force: true), "Explicit refresh can update the projection")
        let attributes = try FileManager.default.attributesOfItem(atPath: target.path)
        let folderAttributes = try FileManager.default.attributesOfItem(atPath: directory.path)
        check((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Widget summary is private to the user")
        check((folderAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o700, "Widget summary directory is private")
        state["manualTasks"] = [Any]()
        check(try publisher.publish(state: state, now: now.addingTimeInterval(180)), "Removal immediately republishes a clean projection")
        let cleared = try JSONSerialization.jsonObject(with: Data(contentsOf: target)) as! [String: Any]
        check((cleared["items"] as? [[String: Any]])?.isEmpty == true, "Removed tasks are absent from the disk summary")
        check(!(try publisher.publish(state: state, now: now.addingTimeInterval(240))), "Duplicate cleared state is coalesced")
        check(try publisher.publish(state: state, now: now.addingTimeInterval(3600)), "Active app refreshes stale projection timestamp")
        check(CampusAgendaLink.day(from: URL(string: "campusdesk-theme://calendar?date=2026-10-10")!) == "2026-10-10", "Widget link routes a valid day")
        check(CampusAgendaLink.isTasks(URL(string: "campusdesk-theme://tasks")!), "Widget homework opens tasks without a fabricated date")
        for invalid in ["https://tasks", "campusdesk-theme://user@tasks", "campusdesk-theme://tasks:80", "campusdesk-theme://tasks/open", "campusdesk-theme://tasks?url=https://example.com", "campusdesk-theme://tasks#x"] {
            check(!CampusAgendaLink.isTasks(URL(string: invalid)!), "Reject unsupported task links")
        }
        for invalid in ["https://calendar?date=2026-10-10", "campusdesk-theme://calendar?date=2026-02-30", "campusdesk-theme://calendar?date=2026-10-10&date=2026-10-11", "campusdesk-theme://calendar?date=2026-10-10&url=https://example.com", "campusdesk-theme://calendar/open?date=2026-10-10", "campusdesk-theme://user@calendar?date=2026-10-10", "campusdesk-theme://calendar?date=2026-10-10#x"] {
            check(CampusAgendaLink.day(from: URL(string: invalid)!) == nil, "Unsupported deep link is ignored")
        }
        print("PASS: \(count) native agenda projection and link checks")
    }
}
