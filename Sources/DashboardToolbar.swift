import AppKit

/// The web dashboard owns the state and actions. AppKit owns the toolbar material,
/// button tracking, unread badge, and keyboard focus.
@MainActor
final class DashboardToolbar: NSObject, NSToolbarDelegate {
    private static let notifications = NSToolbarItem.Identifier("grade-notifications-button")
    private static let focus = NSToolbarItem.Identifier("focus-button")
    private static let sync = NSToolbarItem.Identifier("sync-button")

    private let toolbar = NSToolbar(identifier: "CampusDesk.Dashboard")
    private var items = [NSToolbarItem.Identifier: NSToolbarItem]()
    private weak var window: NSWindow?
    private let onAction: (String) -> Void

    init?(window: NSWindow, onAction: @escaping (String) -> Void) {
        #if compiler(<6.2)
        return nil
        #else
        guard #available(macOS 26.0, *) else { return nil }
        self.window = window
        self.onAction = onAction
        super.init()

        add(Self.notifications, title: "成绩更新", symbol: "bell", action: #selector(openNotifications))
        add(Self.focus, title: "专注模式", symbol: "scope", action: #selector(toggleFocus))
        add(Self.sync, title: "同步数据", symbol: "arrow.triangle.2.circlepath", action: #selector(syncData))
        toolbar.delegate = self
        toolbar.allowsUserCustomization = false
        toolbar.allowsDisplayModeCustomization = false
        toolbar.autosavesConfiguration = false
        toolbar.displayMode = .iconOnly
        window.toolbarStyle = .unified
        window.toolbar = toolbar
        toolbar.isVisible = true
        #endif
    }

    private func add(_ id: NSToolbarItem.Identifier, title: String, symbol: String, action: Selector) {
        let item = NSToolbarItem(itemIdentifier: id)
        let button = NSButton(title: title, target: self, action: action)
        #if compiler(>=6.2)
        button.bezelStyle = .toolbar
        #endif
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        button.imagePosition = .imageLeading
        if id == Self.focus {
            button.setButtonType(.pushOnPushOff)
            button.setAccessibilityRole(.checkBox)
        }
        button.identifier = .init(id.rawValue)
        button.setAccessibilityIdentifier(id.rawValue)
        item.view = button
        item.isBordered = true
        item.label = title
        item.paletteLabel = title
        item.target = self
        item.action = action
        item.autovalidates = false
        item.isEnabled = false
        items[id] = item
    }

    func update(_ state: [String: Any]) {
        guard let sync = items[Self.sync], let focus = items[Self.focus],
              let notifications = items[Self.notifications],
              let syncLabel = state["syncLabel"] as? String, let focusLabel = state["focusLabel"] as? String,
              let notificationsLabel = state["notificationsLabel"] as? String else { return }
        let disabled = state["actionsDisabled"] as? Bool == true
        for (item, label) in [(sync, syncLabel), (focus, focusLabel), (notifications, notificationsLabel)] {
            item.label = label
            item.title = label
            item.paletteLabel = label
            let spoken = item === notifications ? state["notificationsAccessibilityLabel"] as? String ?? label : label
            item.toolTip = spoken
            item.view?.toolTip = spoken
            item.view?.setAccessibilityLabel(spoken)
            item.isEnabled = !disabled && !(item === sync && state["syncDisabled"] as? Bool == true)
        }
        let pressed = state["focusPressed"] as? Bool == true
        (focus.view as? NSButton)?.state = pressed ? .on : .off
        focus.view?.setAccessibilityValue(NSNumber(value: pressed))
        notifications.view?.setAccessibilityExpanded(state["notificationsExpanded"] as? Bool == true)
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            let count = max(0, state["unreadCount"] as? Int ?? 0)
            notifications.badge = count > 99 ? .text("99+") : count > 0 ? .count(count) : nil
        }
        #endif
    }

    func focusNotifications() {
        if let button = items[Self.notifications]?.view { window?.makeFirstResponder(button) }
    }

    private func perform(_ id: NSToolbarItem.Identifier) {
        if items[id]?.isEnabled == true { onAction(id.rawValue) }
    }

    @objc private func openNotifications() { perform(Self.notifications) }
    @objc private func toggleFocus() { perform(Self.focus) }
    @objc private func syncData() { perform(Self.sync) }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.flexibleSpace, Self.notifications, Self.focus, Self.sync]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        items[id]
    }
}
