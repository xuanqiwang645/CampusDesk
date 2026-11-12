import AppKit
import UniformTypeIdentifiers
import CoreServices

@main
enum PatchApplication {
    static func main() {
        let app = NSApplication.shared
        let delegate = PatchAppDelegate()
        app.delegate = delegate; app.setActivationPolicy(.regular); app.run()
        withExtendedLifetime(delegate) {}
    }
}

final class PatchAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var target: URL?
    private var engine: PatchEngine?
    private var variants = [String: PatchManifest]()
    private var resources: URL?
    private var installing = false
    private var finishing = false
    private var cleanupSuppressed = false
    private var result: PatchResult?
    private let status = NSTextField(wrappingLabelWithString: "正在读取补丁…")
    private let targetLabel = NSTextField(wrappingLabelWithString: "")
    private let installButton = NSButton(title: "安装更新", target: nil, action: nil)
    private let chooseButton = NSButton(title: "选择原应用…", target: nil, action: nil)
    private let backupButton = NSButton(title: "查看备份", target: nil, action: nil)
    private let progress = NSProgressIndicator()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu(), appMenu = NSMenu(), windowMenu = NSMenu(title: "窗口")
        let appItem = NSMenuItem(); appItem.submenu = appMenu; menu.addItem(appItem)
        appMenu.addItem(withTitle: "退出更新补丁", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let windowItem = NSMenuItem(title: "窗口", action: nil, keyEquivalent: ""); windowItem.submenu = windowMenu; menu.addItem(windowItem)
        windowMenu.addItem(withTitle: "关闭", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 580, height: 310), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "CampusDesk 更新补丁"; window.center(); window.delegate = self
        window.isReleasedWhenClosed = false
        let content = NSStackView(); content.orientation = .vertical; content.alignment = .leading; content.spacing = 16
        content.edgeInsets = NSEdgeInsets(top: 28, left: 28, bottom: 28, right: 28)
        let title = NSTextField(labelWithString: "原位更新，保留数据与登录")
        title.font = .systemFont(ofSize: 24, weight: .semibold)
        let detail = NSTextField(wrappingLabelWithString: "自动匹配普通版与主题版旧版本，原位更新至 v2.0.0 Tarantula。备份并核验资料与登录会话；升级成功后更新器自动退出并移入废纸篓。")
        detail.textColor = .secondaryLabelColor
        targetLabel.font = .monospacedSystemFont(ofSize: 12, weight: .regular); targetLabel.textColor = .secondaryLabelColor
        targetLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        progress.style = .spinning; progress.controlSize = .small; progress.isDisplayedWhenStopped = false
        let stateRow = NSStackView(views: [progress, status]); stateRow.orientation = .horizontal; stateRow.alignment = .centerY; stateRow.spacing = 10
        let buttons = NSStackView(views: [chooseButton, backupButton, installButton]); buttons.orientation = .horizontal; buttons.spacing = 12
        for view in [title, detail, targetLabel, stateRow, buttons] { content.addArrangedSubview(view) }
        window.contentView = NSView(); window.contentView?.addSubview(content); content.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([content.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor), content.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor), content.topAnchor.constraint(equalTo: window.contentView!.topAnchor), content.bottomAnchor.constraint(lessThanOrEqualTo: window.contentView!.bottomAnchor)])
        installButton.target = self; installButton.action = #selector(install); installButton.bezelStyle = .rounded; installButton.keyEquivalent = "\r"
        chooseButton.target = self; chooseButton.action = #selector(choose); chooseButton.bezelStyle = .rounded
        backupButton.target = self; backupButton.action = #selector(showBackup); backupButton.bezelStyle = .rounded; backupButton.isHidden = true
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        do {
            guard let resources = Bundle.main.resourceURL else { throw PatchError.invalid("补丁内容缺失。") }
            self.resources = resources
            let catalog = try JSONDecoder().decode(PatchCatalog.self, from: Data(contentsOf: resources.appendingPathComponent("PatchCatalog.json")))
            guard catalog.formatVersion == 2, catalog.variants.count == 2,
                  Set(catalog.variants.map(\.bundleID)) == Set(PatchEdition.allCases.map(\.rawValue)),
                  Set(catalog.variants.map(\.signingCertificateSHA1)).count == 1, let first = catalog.variants.first else { throw PatchError.invalid("通用补丁内容不完整。") }
            try PatchFiles.checkSignature(Bundle.main.bundleURL, certificate: first.signingCertificateSHA1)
            guard getuid() != 0 else { throw PatchError.invalid("请用原来使用 CampusDesk 的用户打开补丁，无需以 root 运行。") }
            for variant in catalog.variants { variants[variant.bundleID] = variant }
            let roots = [FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications"), URL(fileURLWithPath: "/Applications")]
            let common = roots.flatMap { root in ((try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []).filter { $0.pathExtension.lowercased() == "app" } }
            var found = Set(common.filter { ((try? PatchFiles.info($0)["CFBundleIdentifier"] as? String) ?? nil).map { variants[$0] != nil } == true }.map { $0.standardizedFileURL })
            for edition in PatchEdition.allCases { for app in NSRunningApplication.runningApplications(withBundleIdentifier: edition.rawValue) { if let url = app.bundleURL { found.insert(url.standardizedFileURL) } } }
            if found.count == 1 { setTarget(found.first!) }
            else { status.stringValue = found.isEmpty ? "请选择原来的 CampusDesk 普通版或主题版。" : "发现多个 CampusDesk，请选择本次要更新的原应用。"; installButton.isEnabled = false }
        } catch { fail(error); installButton.isEnabled = false; chooseButton.isEnabled = false }
    }
    private func setTarget(_ url: URL) {
        do {
            guard let id = try PatchFiles.info(url)["CFBundleIdentifier"] as? String, let manifest = variants[id],
                  let edition = PatchEdition(rawValue: id), let resources else { throw PatchError.invalid("请选择 CampusDesk 普通版或主题版。") }
            let engine = try PatchEngine(manifest: manifest, archive: resources.appendingPathComponent(edition.archiveName)); self.engine = engine
            let oldBuild = try engine.validateTarget(url)
            target = url; targetLabel.stringValue = url.path
            status.stringValue = "\(edition.label) Build \(oldBuild) → v\(engine.manifest.version) Tarantula · Build \(engine.manifest.build)"
            installButton.isEnabled = true
        } catch { target = nil; targetLabel.stringValue = url.path; status.stringValue = error.localizedDescription; installButton.isEnabled = false }
    }
    @objc private func choose() {
        let panel = NSOpenPanel(); panel.title = "选择原来的 CampusDesk"; panel.canChooseDirectories = false; panel.canChooseFiles = true
        panel.allowedContentTypes = [.applicationBundle]; panel.treatsFilePackagesAsDirectories = false
        panel.beginSheetModal(for: window) { [weak self] response in if response == .OK, let url = panel.url { self?.setTarget(url) } }
    }
    @objc private func install() {
        if result != nil { finishAndClean(); return }
        guard let engine, let target, !installing else { return }
        installing = true; chooseButton.isEnabled = false; installButton.isEnabled = false; progress.startAnimation(nil)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let hooks = PatchHooks(progress: { text in DispatchQueue.main.async { self?.status.stringValue = text } }, ensureStopped: { url in
                try Self.stopApplication(bundleID: engine.edition.rawValue)
            })
            do {
                let result = try engine.install(target: target, hooks: hooks)
                DispatchQueue.main.async {
                    guard let self else { return }; self.result = result; self.installing = false; self.progress.stopAnimation(nil)
                    self.status.stringValue = result.alreadyCurrent ? "当前已是最新版。更新器即将自动退出并清理。" : "更新完成，资料和会话校验一致。即将打开 CampusDesk 并清理更新器。"
                    self.installButton.title = "打开 CampusDesk"; self.installButton.isEnabled = true
                    self.backupButton.isHidden = result.backup == nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.finishAndClean() }
                }
            } catch { DispatchQueue.main.async { self?.installing = false; self?.progress.stopAnimation(nil); self?.chooseButton.isEnabled = true; self?.installButton.isEnabled = true; self?.fail(error) } }
        }
    }
    private static func stopApplication(bundleID: String) throws {
        // Other copies with this exact bundle ID share this user's data store.
        // Quit all of them, while leaving the classic edition and browsers alone.
        func matching() -> [NSRunningApplication] { NSRunningApplication.runningApplications(withBundleIdentifier: bundleID) }
        let running = matching()
        for app in running {
            let accepted = DispatchQueue.main.sync { app.terminate() }
            guard accepted else { throw PatchError.invalid("CampusDesk 未能正常退出，请结束当前操作后重试。") }
        }
        let deadline = Date().addingTimeInterval(25)
        while !matching().isEmpty, Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        guard matching().isEmpty else { throw PatchError.invalid("CampusDesk 仍在运行，原应用未替换。请正常退出后重试。") }
    }
    private func fail(_ error: Error) {
        status.stringValue = error.localizedDescription
        let alert = NSAlert(); alert.messageText = "补丁未安装"; alert.informativeText = error.localizedDescription; alert.addButton(withTitle: "知道了")
        alert.beginSheetModal(for: window)
    }
    private func finishAndClean() {
        guard let result, !finishing else { return }; finishing = true
        LSRegisterURL(result.target as CFURL, true)
        guard NSWorkspace.shared.open(result.target) else {
            finishing = false; cleanupSuppressed = true
            status.stringValue = "新版已安装，但尚未打开。已保留补丁和备份，可处理系统提示后重试。"
            return
        }
        cleanupSuppressed = false
        do { try PatchCleanup.launch(updater: Bundle.main.bundleURL, backup: result.backup) }
        catch {
            let alert = NSAlert(); alert.messageText = "升级已完成"
            alert.informativeText = "自动清理未能启动，补丁文件已保留，不影响新版使用。可将更新器手动移入废纸篓。"
            alert.addButton(withTitle: "知道了"); alert.runModal()
        }
        NSApp.terminate(nil)
    }
    @objc private func showBackup() { if let backup = result?.backup { NSWorkspace.shared.open(backup) } }
    func windowShouldClose(_ sender: NSWindow) -> Bool { if result != nil && !finishing && !cleanupSuppressed { finishAndClean(); return false }; return !installing }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if installing { return .terminateCancel }
        if result != nil && !finishing && !cleanupSuppressed { DispatchQueue.main.async { self.finishAndClean() }; return .terminateCancel }
        return .terminateNow
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
