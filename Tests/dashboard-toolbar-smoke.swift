import AppKit

@main struct DashboardToolbarSmoke {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        app.finishLaunching()
        let window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 900, height: 200),
                              styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        defer { window.orderOut(nil) }
        var actions = [String]()
        guard let dashboard = DashboardToolbar(window: window, onAction: { actions.append($0) }) else {
            precondition(window.toolbar == nil)
            print("SKIP: native dashboard toolbar unavailable on this SDK or system")
            return
        }
        guard let toolbar = window.toolbar else { fatalError("Toolbar was not attached") }
        window.orderBack(nil)
        let buttons = Dictionary(uniqueKeysWithValues: toolbar.items.compactMap { item -> (String, NSButton)? in
            guard let button = item.view as? NSButton else { return nil }
            return (item.itemIdentifier.rawValue, button)
        })
        let grade = buttons["grade-notifications-button"]!, focus = buttons["focus-button"]!, sync = buttons["sync-button"]!
        precondition(buttons.count == 3 && !grade.isEnabled && !focus.isEnabled && !sync.isEnabled)
        precondition(toolbar.isVisible && !toolbar.allowsUserCustomization)
        var state: [String: Any] = ["notificationsLabel": "Grade updates", "notificationsAccessibilityLabel": "Grade updates, 108 unread",
                                    "notificationsExpanded": true, "unreadCount": 108, "focusLabel": "Exit focus", "focusPressed": true,
                                    "syncLabel": "Sync data", "syncDisabled": true]
        dashboard.update(state)
        window.displayIfNeeded()
        precondition(grade.title == "Grade updates" && grade.accessibilityLabel() == "Grade updates, 108 unread")
        precondition(grade.isAccessibilityExpanded() && focus.state == .on && focus.accessibilityValue() as? NSNumber == 1)
        precondition(focus.title == "Exit focus" && !sync.isEnabled && sync.title == "Sync data")
        if #available(macOS 26.0, *) {
            #if compiler(>=6.2)
            let item = toolbar.items.first { $0.view === grade }!
            precondition(item.badge?.text == "99+")
            #endif
        }
        dashboard.focusNotifications()
        precondition(window.firstResponder === grade)
        sync.performClick(nil)
        grade.performClick(nil)
        focus.performClick(nil)
        state["notificationsExpanded"] = false
        state["unreadCount"] = 0
        state["focusPressed"] = false
        state["syncDisabled"] = false
        state["syncLabel"] = "同步数据"
        dashboard.update(state)
        precondition(!grade.isAccessibilityExpanded() && focus.state == .off && sync.isEnabled && sync.title == "同步数据")
        sync.performClick(nil)
        precondition(actions == ["grade-notifications-button", "focus-button", "sync-button"])
        state["actionsDisabled"] = true
        dashboard.update(state)
        precondition(!grade.isEnabled && !focus.isEnabled && !sync.isEnabled)
        print("PASS: dashboard toolbar actions, focus, accessibility state, badge and labels")
    }
}
