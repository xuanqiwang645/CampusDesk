import AppKit
import WebKit

/// Only this test process sees synthetic system appearances. We never write
/// NSApp.appearance, defaults, or the user's macOS appearance preference.
@MainActor private final class AppearanceFixtureApplication: NSApplication {
    private var syntheticAppearance: NSAppearance?
    override var effectiveAppearance: NSAppearance { syntheticAppearance ?? super.effectiveAppearance }
    func setSyntheticAppearance(_ value: NSAppearance?) {
        willChangeValue(forKey: "effectiveAppearance")
        syntheticAppearance = value
        didChangeValue(forKey: "effectiveAppearance")
    }
}

@main struct DashboardAppearanceSmoke {
    @MainActor static func main() {
        let app = AppearanceFixtureApplication.shared as! AppearanceFixtureApplication
        app.setActivationPolicy(.prohibited)
        app.finishLaunching()
        let initialAppAppearance = app.appearance
        let initialSystemDark = CampusDashboardAppearance.systemIsDark
        let window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 900, height: 250),
                              styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        var checks = 0
        func check(_ value: Bool, _ message: String) { precondition(value, message); checks += 1 }
        func spin(until predicate: () -> Bool, timeout: TimeInterval = 10) -> Bool {
            let end = Date().addingTimeInterval(timeout)
            while !predicate(), Date() < end { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
            return predicate()
        }

        let defaults = CampusDashboardAppearanceSettings([:])
        check(defaults.dictionary == ["appearanceMode": "manual", "colorTheme": "sage", "dayColorTheme": "sage"], "Old states retain manual Sage")
        let invalid = CampusDashboardAppearanceSettings(["appearanceMode": "<script>", "colorTheme": "bad", "dayColorTheme": "midnight", "private": "must-not-export"])
        check(invalid.dictionary == defaults.dictionary, "Malformed values cannot enter bootstrap")
        let saved = CampusDashboardAppearanceSettings(["appearanceMode": "manual", "colorTheme": "midnight", "dayColorTheme": "ember"])
        check(CampusDashboardAppearanceSettings(["colorTheme": "ocean"]).dayTheme == "ocean", "An existing light palette remains the daytime preference")
        check(CampusDashboardAppearance.isDark(NSAppearance(named: .darkAqua)!) && !CampusDashboardAppearance.isDark(NSAppearance(named: .aqua)!), "Resolve standard AppKit appearances")
        check(CampusDashboardAppearance.isDark(NSAppearance(named: .accessibilityHighContrastDarkAqua)!), "High contrast dark is still dark")
        var changes = [Bool]()
        var eventWeb: WKWebView?
        let appearance = CampusDashboardAppearance(window: window, settings: saved) { dark in
            changes.append(dark)
            let event: [String: Any] = ["type": "systemAppearance", "dark": dark]
            let payload = String(data: try! JSONSerialization.data(withJSONObject: event), encoding: .utf8)!
            eventWeb?.evaluateJavaScript("window.CampusDesk.receive(" + payload + ");", completionHandler: nil)
        }
        check(window.appearance?.name == .darkAqua, "Saved manual dark is applied before the first window display")
        check(app.appearance === initialAppAppearance && CampusDashboardAppearance.systemIsDark == initialSystemDark, "Manual window appearance cannot change the application or system preference")
        for message: [String: Any] in [["mode": "wrong", "theme": "sage"], ["mode": "manual", "theme": "unknown"], ["mode": true, "theme": "midnight"], ["mode": "system"]] {
            check(!appearance.apply(message: message) && window.appearance?.name == .darkAqua, "Invalid bridge payload leaves the window unchanged")
        }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.addUserScript(WKUserScript(source: "window.unrelatedBootstrap='preserved';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        CampusDashboardAppearance.installBootstrap(in: config.userContentController, settings: saved)
        CampusDashboardAppearance.installBootstrap(in: config.userContentController, settings: saved)
        check(config.userContentController.userScripts.count == 2, "Repeated bootstrap installation is idempotent")
        let web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        eventWeb = web
        window.contentView = web
        window.orderBack(nil)
        let fixture = "<!doctype html><html><head><script>window.firstTheme=document.documentElement.dataset.colorTheme;</script><meta name='color-scheme' content='light dark'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; script-src 'unsafe-inline'\"></head><body><script>window.nativeAppearanceEvents=[];window.CampusDesk={receive:function(event){window.nativeAppearanceEvents.push(event);}};window.appearanceFixtureReady=true;</script></body></html>"
        func evaluate(_ script: String) -> Any? {
            var completed = false, value: Any?, error: Error?
            web.evaluateJavaScript(script) { result, failure in value = result; error = failure; completed = true }
            precondition(spin(until: { completed }), "WebKit evaluation timed out")
            precondition(error == nil, "WebKit fixture evaluation failed: \(String(describing: error))")
            return value
        }
        func loadFixture() {
            var loaded = false
            web.loadHTMLString(fixture, baseURL: nil)
            check(spin(until: {
                if !web.isLoading { loaded = evaluate("window.appearanceFixtureReady === true") as? Bool == true }
                return loaded
            }), "Isolated WebKit fixture loaded")
        }
        func mediaIsDark() -> Bool { evaluate("matchMedia('(prefers-color-scheme: dark)').matches") as? Bool == true }
        loadFixture()
        check(evaluate("firstTheme") as? String == "midnight", "The HTML root is dark before any page script, without waiting for dashboard.js")
        let bootstrap = evaluate("({native:CampusDeskNativeAppearance, system:CampusDeskSystemAppearance, settings:CampusDeskInitialAppearanceSettings, unrelated:unrelatedBootstrap})") as! [String: Any]
        check(bootstrap["native"] as? Bool == true && bootstrap["system"] as? String == (initialSystemDark ? "dark" : "light"), "Bootstrap publishes the system appearance independently of the forced window")
        check(bootstrap["settings"] as? [String: String] == saved.dictionary && bootstrap["unrelated"] as? String == "preserved", "Bootstrap contains exactly the normalized settings and retains unrelated scripts")
        check(spin(until: mediaIsDark), "WKWebView sees the manual dark window")
        check(appearance.apply(message: ["mode": "manual", "theme": "ocean"]), "Valid manual light request is accepted")
        check(spin(until: { !mediaIsDark() }), "WKWebView sees manual light without changing system appearance")
        check(changes.isEmpty && CampusDashboardAppearance.systemIsDark == initialSystemDark, "Window changes do not emit false system-appearance events")
        check(appearance.apply(message: ["mode": "system", "theme": "midnight"]) && window.appearance == nil, "System mode removes the manual window override")
        check(spin(until: { mediaIsDark() == initialSystemDark }), "WKWebView returns to inherited system appearance")
        appearance.refresh()
        check(changes.isEmpty, "Unchanged appearance notifications are coalesced")
        appearance.refresh(force: true)
        appearance.refresh(force: true)
        check(changes == [initialSystemDark, initialSystemDark], "Ready and wake can force a fresh authoritative event")

        let imported = CampusDashboardAppearanceSettings(["appearanceMode": "system", "colorTheme": "sage", "dayColorTheme": "ocean"])
        appearance.apply(settings: imported)
        CampusDashboardAppearance.installBootstrap(in: config.userContentController, settings: imported)
        loadFixture()
        check(evaluate("firstTheme") as? String == (initialSystemDark ? "midnight" : "ocean"), "Reload applies the current automatic palette before any page script")
        check(evaluate("CampusDeskInitialAppearanceSettings") as? [String: String] == imported.dictionary, "Reload uses imported/current preferences rather than launch-time settings")
        check(config.userContentController.userScripts.count == 2 && evaluate("unrelatedBootstrap") as? String == "preserved", "Updating the appearance bootstrap neither duplicates nor drops other scripts")
        changes.removeAll()
        appearance.apply(settings: saved)
        for (index, dark) in [!initialSystemDark, initialSystemDark].enumerated() {
            app.setSyntheticAppearance(NSAppearance(named: dark ? .darkAqua : .aqua))
            check(spin(until: { changes.count == index + 1 }), "KVO delivers a real application-appearance change callback")
            check(changes.last == dark && window.appearance?.name == .darkAqua, "Application observation stays independent of the manual dark window")
            check(spin(until: { evaluate("nativeAppearanceEvents.length") as? Int == index + 1 }), "The native appearance callback reaches the live WKWebView")
        }
        let events = evaluate("nativeAppearanceEvents") as! [[String: Any]]
        check(events.allSatisfy { $0["type"] as? String == "systemAppearance" } && events.compactMap { $0["dark"] as? Bool } == [!initialSystemDark, initialSystemDark], "Deep and light native events retain their type, order and boolean values in JavaScript")
        app.setSyntheticAppearance(NSAppearance(named: initialSystemDark ? .darkAqua : .aqua))
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        check(changes.count == 2, "Duplicate KVO delivery does not create an appearance event loop")
        app.setSyntheticAppearance(nil)
        check(app.appearance === initialAppAppearance && CampusDashboardAppearance.systemIsDark == initialSystemDark, "Entire fixture leaves app and system appearance untouched")
        print("PASS: dashboard appearance \(checks) checks (isolated AppKit and WKWebView)")
    }
}
