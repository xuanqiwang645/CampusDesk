import Foundation

@main
struct StateValidationSmokeTests {
    static func main() throws {
        var passed = 0
        func check(_ condition: Bool, _ label: String) {
            guard condition else { fputs("FAIL: \(label)\n", stderr); exit(1) }
            passed += 1
        }
        func rejects(_ label: String, _ operation: () throws -> Void) {
            do { try operation(); check(false, label) }
            catch { passed += 1 }
        }
        let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
        let validator = try CampusStateValidator(resources: root.appendingPathComponent("Resources"), themeEdition: true)
        let schools = ["seiue": "https://example-school.seiue.com/", "managebac": "https://example-school.managebac.cn/"]
        // This is the original native first-launch shape, before JS adds defaults.
        let legacy: [String: Any] = ["version": 1, "settings": [String: Any](),
            "snapshots": ["seiue": [String: Any](), "managebac": [String: Any](), "teams": [String: Any]()],
            "manualTasks": [Any](), "taskChecks": [String: Any](), "feedbackRead": [String: Any](), "gradeHistory": [Any]()]
        check(CampusSecurity.validStateEnvelope(legacy), "Native envelope accepts the old missing-inbox state for migration")
        let valid = try validator.validate(legacy, schools: schools)
        check(valid["changeLog"] is [Any], "Shared schema migrates the missing inbox")
        check((valid["gradeUpdates"] as? [Any])?.isEmpty == true, "Old states start with an empty grade notification inbox")
        check((valid["gradeUpdateRead"] as? [String: Any])?.isEmpty == true, "Old states start without unread bookkeeping")
        check((valid["gradeUpdateBaselines"] as? [Any])?.isEmpty == true && (valid["gradeUpdateCaptures"] as? [Any])?.isEmpty == true,
              "Old snapshots are not fabricated into new grade notifications")
        var oversizedInbox = valid
        oversizedInbox["gradeUpdates"] = Array(repeating: [String: Any](), count: 201)
        check(!CampusSecurity.validStateEnvelope(oversizedInbox), "Native envelope bounds grade notifications before full validation")
        check((valid["settings"] as? [String: Any])?["setupWizardCompleted"] as? Bool == false, "Theme schema defaults are available natively")
        check((valid["settings"] as? [String: Any])?["seiueURL"] as? String == schools["seiue"], "Foundation URL bridge preserves the configured school origin")
        var withSnapshot = valid
        let schoolURL = "https://example-school.seiue.com/timetable"
        withSnapshot["snapshots"] = ["seiue": [schoolURL: ["source": "seiue", "url": schoolURL, "capturedAt": "2026-09-20T00:00:00Z", "schedule": [["id": "lesson", "date": "2026-09-20", "start": "08:00", "end": "08:40", "title": "Math"]]]], "managebac": [:], "teams": [:]]
        check(try validator.validate(withSnapshot, schools: schools)["snapshots"] is [String: Any], "Real source URLs and nested lessons pass the shared schema")
        var unsafeURLState = valid
        var unsafeSettings = valid["settings"] as! [String: Any]
        unsafeSettings["seiueURL"] = "https://example-school.seiue.com/?%61ccess_token=synthetic"
        unsafeURLState["settings"] = unsafeSettings
        rejects("Native URLSearchParams bridge rejects encoded credential query keys") { _ = try validator.validate(unsafeURLState, schools: schools) }
        var invalid = valid
        var badSettings = valid["settings"] as! [String: Any]
        badSettings["ecIdentityNames"] = [String(repeating: "A", count: 101)]
        invalid["settings"] = badSettings
        check(CampusSecurity.validStateEnvelope(invalid), "Regression fixture passes only the shallow envelope")
        rejects("Full native schema rejects a 101-character wizard alias") { _ = try validator.validate(invalid, schools: schools) }
        var badTimezone = valid
        var timezoneSettings = valid["settings"] as! [String: Any]; timezoneSettings["timezone"] = "Not/AZone"; badTimezone["settings"] = timezoneSettings
        rejects("Native schema rejects invalid time zones") { _ = try validator.validate(badTimezone) }
        var brokenSnapshot = valid
        brokenSnapshot["snapshots"] = ["seiue": ["https://example-school.seiue.com/": ["source": "seiue", "url": "https://example-school.seiue.com/", "capturedAt": "not-a-date"]], "managebac": [:], "teams": [:]]
        rejects("Native schema rejects malformed nested snapshots") { _ = try validator.validate(brokenSnapshot, schools: schools) }

        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("CampusDesk-state-tests-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let current = temporary.appendingPathComponent("state.json"), previous = temporary.appendingPathComponent("state.previous.json")
        let mark: [String: Any] = ["score": 0, "maxScore": 20, "percentage": 0, "gradeLabel": ""]
        let impact: [String: Any] = ["comparable": false, "courseBefore": NSNull(), "courseAfter": NSNull(),
            "bandedBefore": NSNull(), "bandedAfter": NSNull(), "linearBefore": NSNull(), "linearAfter": NSNull()]
        var withGradeNotice = valid
        withGradeNotice["gradeUpdates"] = [["id": "synthetic-grade-update", "source": "managebac", "kind": "new",
            "title": "Synthetic quiz", "course": "Synthetic course", "courseId": "7001", "term": "Practice Term (current)",
            "url": "https://example-school.managebac.cn/student/classes/7001/core_tasks/8101",
            "capturedAt": "2032-04-08T01:00:00Z", "before": NSNull(), "after": mark, "impact": impact]]
        withGradeNotice["gradeUpdateRead"] = ["synthetic-grade-update": true]
        withGradeNotice["gradeUpdateBaselines"] = [mark.merging(["key": "synthetic-grade-baseline", "scope": "synthetic-grade-scope", "capturedAt": "2032-04-08T01:00:00Z"]) { _, new in new }]
        withGradeNotice["gradeUpdateCaptures"] = [["key": "synthetic-grade-scope", "capturedAt": "2032-04-08T01:00:00Z"]]
        let noticeFile = temporary.appendingPathComponent("grade-notifications.json")
        _ = try validator.write(withGradeNotice, to: noticeFile, previous: nil, schools: schools)
        let noticeRoundTrip = try validator.read(noticeFile, schools: schools)
        let savedNotice = (noticeRoundTrip["gradeUpdates"] as? [[String: Any]])?.first
        check((savedNotice?["after"] as? [String: Any])?["score"] as? Int == 0, "Native persistence preserves an explicit zero assignment grade")
        check((noticeRoundTrip["gradeUpdateRead"] as? [String: Bool])?["synthetic-grade-update"] == true,
              "Read notifications remain read after a native disk round trip")
        check((noticeRoundTrip["gradeUpdateBaselines"] as? [Any])?.count == 1 && (noticeRoundTrip["gradeUpdateCaptures"] as? [Any])?.count == 1,
              "Grade baselines survive native persistence and prevent first-sync floods after restart")
        let noticeBackup = try validator.exportBackup(noticeRoundTrip, schools: schools)
        check((try validator.importBackup(noticeBackup, schools: schools).state["gradeUpdates"] as? [Any])?.count == 1,
              "Grade notification history survives an identified backup round trip")
        _ = try validator.write(valid, to: current, previous: previous, schools: schools)
        check((try validator.read(current, schools: schools))["changeLog"] is [Any], "Initial state survives a native disk round trip")
        var withTask = valid
        withTask["manualTasks"] = [["id": "manual-keep", "title": "Preserve my task", "course": "个人待办", "dueLabel": "", "status": "open", "createdAt": "2026-09-20T00:00:00Z"]]
        _ = try validator.write(withTask, to: current, previous: previous, schools: schools)
        let beforeCurrent = try Data(contentsOf: current), beforePrevious = try Data(contentsOf: previous)
        rejects("Invalid new state cannot be persisted") { _ = try validator.write(invalid, to: current, previous: previous, schools: schools) }
        check(try Data(contentsOf: current) == beforeCurrent && Data(contentsOf: previous) == beforePrevious, "Rejected write preserves both current and previous bytes")
        try CampusStateValidator.writePrivate(try CampusStateValidator.encode(invalid), to: current)
        rejects("Malformed primary fails the complete disk reader") { _ = try validator.read(current, schools: schools) }
        let recovered = try validator.read(previous, schools: schools)
        _ = try validator.write(recovered, to: current, previous: previous, schools: schools)
        check(try Data(contentsOf: previous) == beforePrevious, "Malformed primary never overwrites the last readable recovery point")

        let preparedTarget = temporary.appendingPathComponent("prepared-state.json")
        let preparedPrevious = temporary.appendingPathComponent("prepared-previous.json")
        var mutableDraft = withTask
        let preparedCommit = try validator.prepare(mutableDraft, schools: schools)
        mutableDraft["manualTasks"] = []
        _ = try validator.writePrepared(preparedCommit, to: preparedTarget, previous: preparedPrevious)
        check((try validator.read(preparedTarget, schools: schools)["manualTasks"] as? [Any])?.count == 1,
              "A prepared commit is an immutable validated snapshot, not a later UI draft")
        let cachedBytes = try Data(contentsOf: preparedTarget)
        _ = try validator.write(valid, to: preparedTarget, previous: preparedPrevious, schools: schools)
        check(try Data(contentsOf: preparedPrevious) == cachedBytes, "Exact last-commit bytes are reused as a validated recovery point")
        try CampusStateValidator.writePrivate(try CampusStateValidator.encode(withTask), to: preparedTarget)
        _ = try validator.write(valid, to: preparedTarget, previous: preparedPrevious, schools: schools)
        check((try validator.read(preparedPrevious, schools: schools)["manualTasks"] as? [Any])?.count == 1,
              "External valid edits are validated and backed up instead of using stale cached bytes")
        let externalRecovery = try Data(contentsOf: preparedPrevious)
        try CampusStateValidator.writePrivate(try CampusStateValidator.encode(invalid), to: preparedTarget)
        _ = try validator.writePrepared(preparedCommit, to: preparedTarget, previous: preparedPrevious)
        check(try Data(contentsOf: preparedPrevious) == externalRecovery, "A changed corrupt primary cannot enter the cached recovery path")
        let otherValidator = try CampusStateValidator(resources: root.appendingPathComponent("Resources"), themeEdition: false)
        rejects("Prepared state cannot bypass another validator's edition checks") {
            _ = try otherValidator.writePrepared(preparedCommit, to: preparedTarget, previous: preparedPrevious)
        }

        let envelope = try validator.exportBackup(withTask, schools: schools)
        check(envelope["app"] as? String == "CampusDesk" && envelope["edition"] as? String == "theme", "Export identifies the app and edition")
        check(try validator.importBackup(envelope, schools: schools).legacy == false, "Identified backup imports directly")
        rejects("Raw legacy state requires explicit approval") { _ = try validator.importBackup(legacy, schools: schools) }
        check(try validator.importBackup(legacy, allowLegacy: true, schools: schools).legacy, "Legacy compatibility is explicit")
        var foreign = envelope; foreign["app"] = "OtherApp"
        rejects("Foreign identity cannot use legacy fallback") { _ = try validator.importBackup(foreign, allowLegacy: true, schools: schools) }
        foreign = envelope; foreign["edition"] = "standard"
        rejects("A different edition is not silently imported") { _ = try validator.importBackup(foreign, schools: schools) }
        let recoveryPoint = try validator.preserveBeforeImport(withTask, directory: temporary, schools: schools)
        let archiveBytes = try Data(contentsOf: recoveryPoint)
        _ = try validator.write(valid, to: current, previous: previous, schools: schools)
        _ = try validator.write(valid, to: current, previous: previous, schools: schools)
        check(try Data(contentsOf: recoveryPoint) == archiveBytes, "Import recovery point survives repeated rolling backup writes")
        let archive = try validator.importBackup(CampusStateValidator.readObject(recoveryPoint), schools: schools)
        check((archive.state["manualTasks"] as? [[String: Any]])?.first?["title"] as? String == "Preserve my task", "Pre-import recovery retains personal tasks")

        // Assignment occurs only on commit success, as in the native import
        // handler. Simulate every failure boundary without touching real data.
        _ = try validator.write(withTask, to: current, previous: previous, schools: schools)
        var displayed = withTask
        let importOriginal = try Data(contentsOf: current)
        var prepared = false
        rejects("Invalid imports cannot prepare or commit") {
            displayed = try validator.commitImport(invalid, replacing: displayed, to: current, previous: previous, schools: schools) { prepared = true }
        }
        check(!prepared && (displayed["manualTasks"] as? [[String: Any]])?.count == 1, "Validation failure leaves memory unchanged and skips binding revocation")
        rejects("Binding revocation failure cannot commit the import") {
            displayed = try validator.commitImport(valid, replacing: displayed, to: current, previous: previous, schools: schools) {
                throw CampusStateValidationError(message: "Synthetic identity revocation failure")
            }
        }
        check(try Data(contentsOf: current) == importOriginal && (displayed["manualTasks"] as? [[String: Any]])?.count == 1,
              "Preparation failure preserves the original disk and displayed state")
        let blockedPrevious = temporary.appendingPathComponent("blocked-previous", isDirectory: true)
        try FileManager.default.createDirectory(at: blockedPrevious, withIntermediateDirectories: false)
        rejects("Disk failure after preparation cannot acknowledge an import") {
            displayed = try validator.commitImport(valid, replacing: displayed, to: current, previous: blockedPrevious, schools: schools) { prepared = true }
        }
        check(try prepared && Data(contentsOf: current) == importOriginal && (displayed["manualTasks"] as? [[String: Any]])?.count == 1,
              "Failed atomic write preserves original disk and memory after preparation")
        displayed = try validator.commitImport(valid, replacing: displayed, to: current, previous: previous, schools: schools) { prepared = true }
        let committedDisk = try validator.read(current, schools: schools)
        check((displayed["manualTasks"] as? [[String: Any]])?.isEmpty == true && (committedDisk["manualTasks"] as? [[String: Any]])?.isEmpty == true,
              "Only a completed disk commit changes displayed and saved state together")
        let attributes = try FileManager.default.attributesOfItem(atPath: current.path)
        check((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600, "Committed state retains private permissions")
        check(!(try FileManager.default.contentsOfDirectory(atPath: temporary.path)).contains(where: { $0.hasPrefix(".CampusDesk-write-") }),
              "Failed and successful atomic commits leave no temporary payloads")

        var browserState = valid
        browserState["snapshots"] = ["seiue": [:], "managebac": [:], "teams": ["browser:A:scope": ["coverage": "browser", "accountId": "A"]]]
        check(CampusTeamsAccountState.needsReset(browserState, browserAccount: "B"), "Imported owner A is detected even when the local binding already says B")
        check(!CampusTeamsAccountState.needsReset(browserState, browserAccount: "A"), "A confirmed matching account keeps its cache")
        browserState["snapshots"] = ["teams": ["legacy": ["coverage": "visible"]]]
        check(CampusTeamsAccountState.needsReset(browserState, browserAccount: "B"), "Unbound legacy cache cannot mix into an authenticated account")
        browserState["changeLog"] = [["source": "teams", "title": "Private old-account message"], ["source": "managebac", "title": "Keep school history"]]
        browserState["taskChecks"] = ["teams:old": true, "manual-keep": true]
        let reset = CampusTeamsAccountState.reset(browserState)
        check((reset["changeLog"] as? [[String: Any]])?.count == 1 && (reset["changeLog"] as? [[String: Any]])?.first?["source"] as? String == "managebac", "Account reset removes Teams history and preserves other sources")
        check((reset["taskChecks"] as? [String: Bool]) == ["manual-keep": true], "Account reset preserves personal completion flags")
        print("PASS: \(passed) native state and backup checks")
    }
}
