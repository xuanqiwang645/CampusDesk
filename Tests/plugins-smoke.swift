import AppKit
import WebKit

@main struct PluginSmoke {
    static func check(_ value: @autoclosure () -> Bool, _ message: String) {
        if !value() { fputs("FAIL: \(message)\n", stderr); exit(1) }
    }
    static func main() {
        _ = NSApplication.shared
        let suite = "local.campusdesk.tests.plugins." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let host = CampusPluginHostView(frame: NSRect(x: 0, y: 0, width: 1000, height: 700))
        let context = CampusPluginContext(surfaceHost: host)
        let plugin = CampusLiquidGlassPlugin(defaults: defaults)
        plugin.activate(in: context)
        let valid: [String: Any] = ["viewport": ["width": 1000.0, "height": 700.0], "theme": "ocean", "surfaces": [["x": 10.0, "y": 20.0, "width": 200.0, "height": 100.0]]]
        check(CampusGlassRect.parse(valid, bounds: host.bounds)?.first?.frame == CGRect(x: 10, y: 20, width: 200, height: 100), "DOM coordinates map to native points")
        var invalid = valid; invalid["surfaces"] = [["x": Double.nan, "y": 0.0, "width": 1.0, "height": 1.0]]
        check(CampusGlassRect.parse(invalid, bounds: host.bounds) == nil, "Nonfinite geometry is rejected")
        invalid["surfaces"] = Array(repeating: ["x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0], count: 49)
        check(CampusGlassRect.parse(invalid, bounds: host.bounds) == nil, "Surface count is bounded")
        plugin.configure(["transparency": 50.0, "radius": 28.0, "style": "clear"])
        plugin.receiveLayout(valid)
        check(plugin.settings["transparency"] as? Double == 50, "Transparency setting persists")
        plugin.configure(["transparency": Double.infinity, "radius": -1.0, "style": "unknown"])
        check(plugin.settings["transparency"] as? Double == 50 && plugin.settings["radius"] as? Double == 28, "Malformed settings cannot overwrite valid values")
        #if compiler(>=6.2)
        if #available(macOS 26.0, *), plugin.active {
            let container = host.subviews.compactMap { $0 as? NSGlassEffectContainerView }.first!
            check(container.alphaValue == 0.5, "Opacity applies to the complete material container")
            let glass = container.contentView!.subviews.first as! NSGlassEffectView
            check(glass.frame == CGRect(x: 10, y: 20, width: 200, height: 100), "Native surface follows DOM geometry")
            check(glass.contentView?.subviews.isEmpty == true, "No text is captured inside native glass")
            plugin.configure(["transparency": 100.0]); check(container.alphaValue == 0, "100 percent hides glass")
        }
        #endif
        plugin.configure(["transparency": 100.0])
        plugin.configure(["enabled": false])
        check(!plugin.active && host.subviews.isEmpty, "Disable removes native material and background")
        let restored = CampusLiquidGlassPlugin(defaults: defaults)
        check(restored.settings["enabled"] as? Bool == false && restored.settings["transparency"] as? Double == 100 || !plugin.supported, "Plugin preferences survive restart")
        print("Plugin native smoke tests passed")
    }
}
