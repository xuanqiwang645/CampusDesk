import Foundation
import JavaScriptCore

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
        let teamsURL = "https://teams.microsoft.com/v2/"
        func teamsPage(_ account: String, _ title: String) -> [String: Any] {
            ["url": teamsURL, "source": "teams", "coverage": "graph", "accountId": account,
             "capturedAt": "2026-10-10T01:00:00Z", "tasks": [["id": "teams:same-id", "title": title,
             "requirements": "Deadline: 2026-10-11 17:00", "status": "open", "officialAssignment": true]]]
        }
        func diskItems() throws -> [[String: Any]] {
            let object = try JSONSerialization.jsonObject(with: Data(contentsOf: target)) as! [String: Any]
            return object["items"] as! [[String: Any]]
        }
        state["snapshots"] = ["seiue": [:], "managebac": [:], "teams": [teamsURL: teamsPage("account-A", "First exercise")]]
        state = try validator.validate(state)
        check(try publisher.publish(state: state, now: now), "A newly synced account reaches the widget")
        check(try diskItems().first?["startAt"] as? String == "2026-10-11T09:00:00.000Z", "Widget input retains assignment text used for deadline resolution")
        var settings = state["settings"] as! [String: Any]
        settings["teamsDueOverrides"] = ["teams:same-id": "2026-10-12T00:00:00Z"]
        state["settings"] = settings
        check(try publisher.publish(state: state, now: now), "Changing deadline settings invalidates the cached agenda")
        check(try diskItems().first?["startAt"] as? String == "2026-10-12T00:00:00.000Z", "Saved override replaces the inferred deadline")
        state["snapshots"] = ["seiue": [:], "managebac": [:], "teams": [teamsURL: teamsPage("account-B", "Replacement exercise")]]
        settings["teamsDueOverrides"] = [:] as [String: String]
        state["settings"] = settings
        state = try validator.validate(state)
        check(try publisher.publish(state: state, now: now), "Account replacement with a reused source URL and task ID refreshes the widget")
        check(try diskItems().compactMap { $0["title"] as? String } == ["Replacement exercise"], "Only the replacement account remains on disk")
        try FileManager.default.removeItem(at: target)
        check(try publisher.publish(state: state, now: now), "Unchanged input recreates a missing widget file")
        // Use production Core to prepare an analyzed record, then verify that
        // native input pruning retains exactly the fields required by its gate.
        state["snapshots"] = ["seiue": [:], "managebac": [:], "teams": [teamsURL: [
            "url": teamsURL, "source": "teams", "coverage": "visible", "accountId": "synthetic-analysis",
            "capturedAt": "2026-10-10T01:00:00Z", "tasks": [], "posts": [[
                "id": "teams:analysis-fixture", "title": "Science fair", "text": "All students must attend the science fair.\nDeadline: 2026-10-11 17:00",
                "kind": "general", "url": teamsURL, "officialAssignment": false
            ]]
        ]]]
        settings["teamsAnalysisEnabled"] = true
        state["settings"] = settings
        state = try validator.validate(state)
        let pending = try JSONSerialization.jsonObject(with: builder.snapshot(state: state, now: now)) as! [String: Any]
        check((pending["items"] as! [[String: Any]]).isEmpty, "Pending Teams analysis cannot leak into native widgets")
        let analysisContext = JSContext()!
        analysisContext.evaluateScript(try String(contentsOf: resources.appendingPathComponent("core.js"), encoding: .utf8))
        analysisContext.setObject(String(data: try JSONSerialization.data(withJSONObject: state), encoding: .utf8)!, forKeyedSubscript: "fixtureJSON" as NSString)
        let preparedJSON = analysisContext.evaluateScript("""
        var fixtureState = JSON.parse(fixtureJSON);
        var fixtureInput = CampusCore.getTeamsAnalysisInputs(fixtureState)[0];
        fixtureState = CampusCore.applyTeamsAnalysisResults(fixtureState, {model: CampusCore.teamsAnalysisModel(fixtureState), results: [{
          id:fixtureInput.id, fingerprint:fixtureInput.fingerprint, classification:'actionable', status:'ready', summary:'Synthetic activity',
          tasks:[{category:'activity',title:'Join science fair',evidence:'All students must attend the science fair.',deadlineText:'Deadline: 2026-10-11 17:00',participationEvidence:'All students must attend the science fair.'}]
        }]});
        JSON.stringify(fixtureState);
        """)?.toString()
        check(analysisContext.exception == nil && preparedJSON != nil, "JavaScriptCore computes and accepts the same source fingerprint without browser APIs")
        state = try validator.validate(JSONSerialization.jsonObject(with: Data(preparedJSON!.utf8)) as! [String: Any])
        let analyzed = try JSONSerialization.jsonObject(with: builder.snapshot(state: state, now: now)) as! [String: Any]
        let analyzedItems = analyzed["items"] as! [[String: Any]]
        check(analyzedItems.count == 1 && analyzedItems[0]["title"] as? String == "Join science fair", "Analyzed activity reaches the native widget through the shared task gate")
        check(analyzedItems[0]["startAt"] as? String == "2026-10-11T09:00:00.000Z", "Widget deadline is derived from verified source text")
        check(analyzedItems[0]["analysisEvidence"] == nil && analyzedItems[0]["accountId"] == nil, "AI evidence and identities never cross into the display-only widget file")
        var analysisSources = state["snapshots"] as! [String: [String: [String: Any]]]
        var analysisPage = analysisSources["teams"]![teamsURL]!
        var analysisPosts = analysisPage["posts"] as! [[String: Any]]
        analysisPosts[0]["text"] = "The science fair has been cancelled."
        analysisPage["posts"] = analysisPosts; analysisSources["teams"]![teamsURL] = analysisPage; state["snapshots"] = analysisSources
        let stale = try JSONSerialization.jsonObject(with: builder.snapshot(state: state, now: now)) as! [String: Any]
        check((stale["items"] as! [[String: Any]]).isEmpty, "Source edits invalidate both the cached native reader and its old AI task")
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
