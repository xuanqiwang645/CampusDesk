import AppKit
import WebKit

struct CampusPluginManifest {
    let id: String
    let name: String
    let version: String
    let apiVersion: Int
    let capabilities: [String]
    var json: [String: Any] { ["id": id, "name": name, "version": version, "apiVersion": apiVersion, "capabilities": capabilities] }
}

/// API v1 for host-registered, bundled presentation plugins. The context has no
/// school state, credentials, file access or network request facilities.
protocol CampusDeskPlugin: AnyObject {
    var manifest: CampusPluginManifest { get }
    var supported: Bool { get }
    var active: Bool { get }
    var settings: [String: Any] { get }
    func activate(in context: CampusPluginContext)
    func configure(_ values: [String: Any])
    func receiveLayout(_ body: [String: Any])
    func deactivate()
}

final class CampusPluginContext {
    let surfaceHost: NSView
    init(surfaceHost: NSView) { self.surfaceHost = surfaceHost }
}

final class CampusPresentationWebView: WKWebView {
    override var isOpaque: Bool { false }
}

final class CampusPluginHostView: NSView {
    override var isFlipped: Bool { true }
}

final class CampusPluginManager {
    static let apiVersion = 1
    private let context: CampusPluginContext
    private var plugins: [String: CampusDeskPlugin] = [:]
    private weak var webView: WKWebView?

    init(webView: WKWebView, host: NSView) {
        self.webView = webView
        context = CampusPluginContext(surfaceHost: host)
        register(CampusLiquidGlassPlugin())
    }

    func register(_ plugin: CampusDeskPlugin) {
        precondition(plugin.manifest.apiVersion == Self.apiVersion && plugins[plugin.manifest.id] == nil)
        plugins[plugin.manifest.id] = plugin
        plugin.activate(in: context)
    }

    func receive(_ body: [String: Any]) {
        guard let operation = body["operation"] as? String else { return }
        if operation == "status" { plugins.values.forEach { $0.activate(in: context) }; publish(); return }
        guard let id = body["pluginId"] as? String, let plugin = plugins[id] else { return }
        if operation == "configure", let values = body["settings"] as? [String: Any] { plugin.configure(values); publish() }
        else if operation == "layout", plugin.active { plugin.receiveLayout(body) }
    }

    func publish() {
        let payload: [String: Any] = ["apiVersion": Self.apiVersion, "plugins": plugins.values.map {
            var row = $0.manifest.json
            row["supported"] = $0.supported; row["active"] = $0.active; row["settings"] = $0.settings
            return row
        }]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.CampusDeskPlugins?.receive(\(json));", completionHandler: nil)
    }

    func deactivateAll() { plugins.values.forEach { $0.deactivate() } }
}

struct CampusGlassRect {
    let frame: CGRect
    static func parse(_ body: [String: Any], bounds: CGRect) -> [CampusGlassRect]? {
        guard let viewport = body["viewport"] as? [String: Any], let width = viewport["width"] as? Double,
              let height = viewport["height"] as? Double, width.isFinite, height.isFinite,
              (200...20_000).contains(width), (100...20_000).contains(height),
              let rows = body["surfaces"] as? [[String: Any]], rows.count <= 48 else { return nil }
        let sx = bounds.width / width, sy = bounds.height / height
        var result: [CampusGlassRect] = []
        for row in rows {
            guard let x = row["x"] as? Double, let y = row["y"] as? Double,
                  let w = row["width"] as? Double, let h = row["height"] as? Double,
                  [x, y, w, h].allSatisfy({ $0.isFinite && abs($0) <= 40_000 }), w > 0, h > 0 else { return nil }
            let frame = CGRect(x: x * sx, y: y * sy, width: w * sx, height: h * sy)
            if frame.intersects(bounds) { result.append(CampusGlassRect(frame: frame)) }
        }
        return result
    }
}

final class CampusLiquidGlassPlugin: CampusDeskPlugin {
    let manifest = CampusPluginManifest(id: "campusdesk.liquid-glass", name: "Liquid Glass", version: "1.0.0", apiVersion: 1, capabilities: ["presentation.surfaces"])
    private weak var context: CampusPluginContext?
    private var container: NSView?
    private var backdrop: CampusGlassBackdrop?
    private let defaults: UserDefaults
    private let key = "plugins.campusdesk.liquid-glass.v1"
    private var values: [String: Any]
    var supported: Bool {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) { return true }
        #endif
        return false
    }
    var active: Bool { supported && values["enabled"] as? Bool == true && !NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency }
    var settings: [String: Any] { values }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        values = ["enabled": true, "transparency": 20.0, "radius": 24.0, "style": "regular"]
        if let saved = defaults.dictionary(forKey: key) { configure(saved) }
    }

    func activate(in context: CampusPluginContext) {
        self.context = context
        updateVisibility()
    }

    func configure(_ settings: [String: Any]) {
        if let enabled = settings["enabled"] as? Bool { values["enabled"] = enabled }
        for (name, range) in [("transparency", 0.0...100.0), ("radius", 0.0...52.0)] {
            if let number = settings[name] as? Double, number.isFinite, range.contains(number) { values[name] = number }
        }
        if let style = settings["style"] as? String, ["regular", "clear"].contains(style) { values["style"] = style }
        defaults.set(values, forKey: key)
        updateVisibility()
    }

    private func updateVisibility() {
        guard let context else { return }
        if !active { deactivate(); return }
        if backdrop == nil {
            let view = CampusGlassBackdrop(frame: context.surfaceHost.bounds)
            view.autoresizingMask = [.width, .height]
            context.surfaceHost.addSubview(view)
            backdrop = view
        }
        #if compiler(>=6.2)
        if #available(macOS 26.0, *), container == nil {
            let view = NSGlassEffectContainerView(frame: context.surfaceHost.bounds)
            view.autoresizingMask = [.width, .height]
            view.spacing = 8
            let content = CampusPluginHostView(frame: view.bounds)
            content.autoresizingMask = [.width, .height]
            view.contentView = content
            context.surfaceHost.addSubview(view)
            container = view
        }
        #endif
        // Fade the complete native material, never the foreground WebKit text.
        container?.alphaValue = 1 - (values["transparency"] as? Double ?? 20) / 100
    }

    func receiveLayout(_ body: [String: Any]) {
        guard active, let context, let rectangles = CampusGlassRect.parse(body, bounds: context.surfaceHost.bounds) else { return }
        let theme = body["theme"] as? String ?? "sage"
        backdrop?.theme = ["sage", "ocean", "ember", "midnight"].contains(theme) ? theme : "sage"
        #if compiler(>=6.2)
        if #available(macOS 26.0, *), let effects = container as? NSGlassEffectContainerView, let content = effects.contentView {
            while content.subviews.count > rectangles.count { content.subviews.last?.removeFromSuperview() }
            while content.subviews.count < rectangles.count {
                let glass = NSGlassEffectView(frame: .zero)
                glass.contentView = NSView(frame: .zero)
                content.addSubview(glass)
            }
            for (index, rect) in rectangles.enumerated() {
                guard let glass = content.subviews[index] as? NSGlassEffectView else { continue }
                glass.frame = rect.frame
                glass.cornerRadius = min(CGFloat(values["radius"] as? Double ?? 24), min(rect.frame.width, rect.frame.height) / 2)
                glass.style = values["style"] as? String == "clear" ? .clear : .regular
            }
        }
        #endif
    }

    func deactivate() {
        container?.removeFromSuperview(); container = nil
        backdrop?.removeFromSuperview(); backdrop = nil
    }
}

/// A fixed background avoids continuous GPU work. Native glass samples only
/// these colors; all letters and charts stay above it in the WKWebView.
final class CampusGlassBackdrop: NSView {
    var theme = "sage" { didSet { if theme != oldValue { needsDisplay = true } } }
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        let dark = theme == "midnight" || effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let colors: [NSColor]
        if dark { colors = [NSColor(calibratedRed: 0.06, green: 0.11, blue: 0.16, alpha: 1), NSColor(calibratedRed: 0.14, green: 0.27, blue: 0.30, alpha: 1)] }
        else if theme == "ocean" { colors = [NSColor(calibratedRed: 0.85, green: 0.94, blue: 1, alpha: 1), NSColor(calibratedRed: 0.62, green: 0.82, blue: 0.93, alpha: 1)] }
        else if theme == "ember" { colors = [NSColor(calibratedRed: 1, green: 0.93, blue: 0.84, alpha: 1), NSColor(calibratedRed: 0.96, green: 0.78, blue: 0.66, alpha: 1)] }
        else { colors = [NSColor(calibratedRed: 0.91, green: 0.96, blue: 0.89, alpha: 1), NSColor(calibratedRed: 0.65, green: 0.84, blue: 0.78, alpha: 1)] }
        NSGradient(colors: colors)?.draw(in: bounds, angle: 35)
        colors.last?.withAlphaComponent(0.5).setFill()
        NSBezierPath(ovalIn: CGRect(x: bounds.width * 0.5, y: -bounds.height * 0.3, width: bounds.width * 0.8, height: bounds.height)).fill()
    }
}
