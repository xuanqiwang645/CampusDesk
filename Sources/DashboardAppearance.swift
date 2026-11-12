import AppKit
import WebKit

/// Only these presentation preferences may enter the dashboard bootstrap.
struct CampusDashboardAppearanceSettings {
    static let themes = ["sage", "ocean", "ember", "midnight"]
    static let dayThemes = ["sage", "ocean", "ember"]
    let mode: String
    let theme: String
    let dayTheme: String

    init(_ settings: [String: Any]) {
        mode = settings["appearanceMode"] as? String == "system" ? "system" : "manual"
        let savedTheme = settings["colorTheme"] as? String ?? "sage"
        theme = Self.themes.contains(savedTheme) ? savedTheme : "sage"
        let savedDayTheme = settings["dayColorTheme"] as? String ?? theme
        dayTheme = Self.dayThemes.contains(savedDayTheme) ? savedDayTheme : "sage"
    }

    var dictionary: [String: String] {
        ["appearanceMode": mode, "colorTheme": theme, "dayColorTheme": dayTheme]
    }

    func resolvedTheme(systemDark: Bool) -> String {
        mode == "system" ? (systemDark ? "midnight" : dayTheme) : theme
    }
}

/// Observe the application, whose appearance is never overridden. A manual
/// dashboard window appearance must not become our idea of the system setting.
@MainActor
final class CampusDashboardAppearance {
    private static let bootstrapPrefix = "/* CampusDesk appearance bootstrap */"
    private weak var window: NSWindow?
    private let onSystemChange: (Bool) -> Void
    private var observation: NSKeyValueObservation?
    private var lastSystemDark: Bool

    init(window: NSWindow, settings: CampusDashboardAppearanceSettings, onSystemChange: @escaping (Bool) -> Void) {
        self.window = window
        self.onSystemChange = onSystemChange
        lastSystemDark = Self.systemIsDark
        apply(settings: settings)
        observation = NSApp.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.refresh() }
        }
    }

    static func isDark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }

    static var systemIsDark: Bool { isDark(NSApp.effectiveAppearance) }

    static func paperColor(theme: String) -> NSColor {
        let rgb: UInt32 = ["sage": 0xf5f5f0, "ocean": 0xeef5fb, "ember": 0xfaf3eb, "midnight": 0x111a20][theme] ?? 0xf5f5f0
        return NSColor(srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
                       blue: CGFloat(rgb & 255) / 255, alpha: 1)
    }

    func apply(settings: CampusDashboardAppearanceSettings) {
        apply(mode: settings.mode, theme: settings.theme)
    }

    @discardableResult func apply(message: [String: Any]) -> Bool {
        guard let mode = message["mode"] as? String, ["manual", "system"].contains(mode),
              let theme = message["theme"] as? String, CampusDashboardAppearanceSettings.themes.contains(theme) else { return false }
        apply(mode: mode, theme: theme)
        return true
    }

    private func apply(mode: String, theme: String) {
        let name: NSAppearance.Name? = mode == "system" ? nil : (theme == "midnight" ? .darkAqua : .aqua)
        if window?.appearance?.name != name { window?.appearance = name.flatMap(NSAppearance.init(named:)) }
    }

    /// Also called after ready, wake and reactivation: WebKit may have been
    /// suspended, or an earlier event may have arrived before its receiver.
    func refresh(force: Bool = false) {
        let dark = Self.systemIsDark
        guard force || dark != lastSystemDark else { return }
        lastSystemDark = dark
        onSystemChange(dark)
    }

    static func installBootstrap(in controller: WKUserContentController, settings: CampusDashboardAppearanceSettings) {
        // Values are normalized enums, never arbitrary saved data or school content.
        let payload = String(data: try! JSONSerialization.data(withJSONObject: settings.dictionary, options: [.sortedKeys]), encoding: .utf8)!
        let source = bootstrapPrefix + """
        window.CampusDeskNativeAppearance=true;
        window.CampusDeskSystemAppearance='\(systemIsDark ? "dark" : "light")';
        window.CampusDeskInitialAppearanceSettings=\(payload);
        (function(){
          var settings=window.CampusDeskInitialAppearanceSettings;
          var theme=settings.appearanceMode==='system'?(window.CampusDeskSystemAppearance==='dark'?'midnight':settings.dayColorTheme):settings.colorTheme;
          function apply(){
            if(!document.documentElement)return false;
            document.documentElement.dataset.colorTheme=theme;
            return true;
          }
          if(!apply()){
            var observer=new MutationObserver(function(){if(apply())observer.disconnect();});
            observer.observe(document,{childList:true});
          }
        })();
        """
        // WebKit's bridged NSArray can be backed by the live script list.
        // Materialize a Swift array before removing anything from that list.
        let scripts = controller.userScripts.map { $0 }
        let old = scripts.filter { $0.source.hasPrefix(bootstrapPrefix) }
        guard old.count != 1 || old[0].source != source else { return }
        // A reload must use current preferences, not the ones captured at launch.
        // Keep every bootstrap owned by another feature intact.
        controller.removeAllUserScripts()
        for script in scripts where !script.source.hasPrefix(bootstrapPrefix) { controller.addUserScript(script) }
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
}
