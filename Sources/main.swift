import Cocoa
import WebKit

let sourceHomes: [String: String] = ["seiue": "https://yly.seiue.com/", "managebac": "https://beijing101.managebac.cn/"]
let sourceHosts: [String: String] = ["seiue": "yly.seiue.com", "managebac": "beijing101.managebac.cn"]
let processPool = WKProcessPool()

func schoolURL(_ raw: String, source: String) -> URL? {
    guard let url = URL(string: raw), url.scheme == "https", url.host == sourceHosts[source], url.user == nil, url.password == nil, url.port == nil || url.port == 443 else { return nil }
    return url
}
func json(_ value: Any) -> String? {
    guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) else { return nil }
    return text
}
func schoolConfig() -> WKWebViewConfiguration {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.processPool = processPool
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    return config
}

// Check again in the page itself: navigation may change after the native URL check.
func extractionScript(_ script: String, source: String) -> String {
    let object = source == "seiue" ? "CampusSeiue" : "CampusManageBac"
    let origin = "https://" + sourceHosts[source]!
    return "(function(){if(location.origin !== '\(origin)') throw new Error('Unexpected origin');\n" + script + "\nreturn JSON.stringify(window." + object + ".extract());})();"
}

enum StateReadError: LocalizedError {
    case invalid
    var errorDescription: String? { "文件不是有效的 CampusDesk 备份，或超过 20 MB。" }
}

func readSavedState(_ url: URL) throws -> [String: Any] {
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size <= 20_000_000 else { throw StateReadError.invalid }
    let data = try Data(contentsOf: url)
    guard data.count <= 20_000_000, let candidate = try JSONSerialization.jsonObject(with: data) as? [String: Any], candidate["version"] as? Int == 1 else { throw StateReadError.invalid }
    return candidate
}

final class SchoolBrowser: NSObject, WKNavigationDelegate, WKUIDelegate {
    let source: String
    let window: NSWindow
    let web: WKWebView
    let address = NSTextField(labelWithString: "")
    var onCapture: ((WKWebView, String) -> Void)?
    init(source: String) {
        self.source = source
        web = WKWebView(frame: .zero, configuration: schoolConfig())
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1160, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init()
        window.title = source == "seiue" ? "希悦 · 学校原网页" : "ManageBac · 学校原网页"
        window.isReleasedWhenClosed = false
        window.center()
        web.navigationDelegate = self
        web.uiDelegate = self
        let back = NSButton(title: "返回", target: self, action: #selector(goBack))
        let home = NSButton(title: "首页", target: self, action: #selector(goHome))
        let refresh = NSButton(title: "刷新", target: self, action: #selector(reloadPage))
        let capture = NSButton(title: "读取当前页到看板", target: self, action: #selector(capturePage))
        address.lineBreakMode = .byTruncatingMiddle
        address.textColor = .secondaryLabelColor
        let toolbar = NSStackView(views: [back, home, refresh, address, capture])
        toolbar.orientation = .horizontal
        toolbar.spacing = 10
        toolbar.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        let stack = NSStackView(views: [toolbar, web])
        stack.orientation = .vertical
        stack.spacing = 0
        stack.alignment = .leading
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor), stack.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor),
            toolbar.widthAnchor.constraint(equalTo: stack.widthAnchor), web.widthAnchor.constraint(equalTo: stack.widthAnchor), toolbar.heightAnchor.constraint(equalToConstant: 48)
        ])
    }
    func show(url: URL? = nil) {
        if let url = url { web.load(URLRequest(url: url)) }
        else if web.url == nil { goHome() }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func goBack() { web.goBack() }
    @objc func goHome() { web.load(URLRequest(url: URL(string: sourceHomes[source]!)!)) }
    @objc func reloadPage() { web.reload() }
    @objc func capturePage() { onCapture?(web, source) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        address.stringValue = webView.url?.absoluteString ?? ""
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, ["https", "about"].contains(url.scheme ?? "") else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "https" { web.load(action.request) }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "确定"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
}

final class SyncWorker: NSObject, WKNavigationDelegate {
    let source: String
    let web: WKWebView
    // A real-sized attached view keeps the calendar's responsive layout measurable.
    let renderWindow: NSWindow
    var queue: [URL] = []
    var visited = Set<String>()
    var busy = false
    var token = UUID()
    var perPageToken = UUID()
    var activeNavigation: WKNavigation?
    var pageCount = 0
    var readablePages = 0
    var failedPages = 0
    var pageLimitReached = false
    var onSnapshot: (([String: Any]) -> Void)?
    var onStatus: ((String, Bool) -> Void)?
    let script: String
    init(source: String, resources: URL) {
        self.source = source
        self.script = (try? String(contentsOf: resources.appendingPathComponent(source + ".js"), encoding: .utf8)) ?? ""
        self.web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 960), configuration: schoolConfig())
        self.renderWindow = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 960), styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        renderWindow.isReleasedWhenClosed = false
        renderWindow.contentView = web
        web.navigationDelegate = self
    }
    func start() {
        guard !busy else { return }
        guard !script.isEmpty else { onStatus?("缺少页面读取组件，请重新安装应用", false); return }
        busy = true; token = UUID(); visited.removeAll(); queue.removeAll(); pageCount = 0; readablePages = 0; failedPages = 0; pageLimitReached = false
        queue.append(URL(string: sourceHomes[source]!)!)
        onStatus?("正在读取学校页面…", true)
        next()
    }
    func cancel() { token = UUID(); perPageToken = UUID(); activeNavigation = nil; busy = false; queue.removeAll(); web.stopLoading() }
    func next() {
        guard busy else { return }
        if queue.isEmpty || pageCount >= 55 {
            pageLimitReached = pageCount >= 55 && !queue.isEmpty
            busy = false
            activeNavigation = nil
            let message: String
            if readablePages == 0 {
                message = failedPages > 0 ? "本轮未能读取学校数据，保留缓存；请检查网络或打开原页" : "页面暂无可识别数据，保留缓存；请打开原页检查登录与页面"
            } else if pageLimitReached {
                message = "已检查 55 页；更多历史反馈可打开原页读取"
            } else if failedPages > 0 {
                message = "已读取 \(readablePages) 页；\(failedPages) 页失败，保留这些页面的缓存"
            } else {
                message = "本轮读取完成（\(pageCount) 页）"
            }
            onStatus?(message, false)
            return
        }
        let url = queue.removeFirst()
        if visited.contains(url.absoluteString) { next(); return }
        visited.insert(url.absoluteString); pageCount += 1
        perPageToken = UUID()
        let expected = perPageToken
        onStatus?("正在读取第 \(pageCount) 页…", true)
        activeNavigation = web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25))
        DispatchQueue.main.asyncAfter(deadline: .now() + 35) { [weak self] in
            guard let self = self, self.busy, self.perPageToken == expected else { return }
            self.perPageToken = UUID(); self.activeNavigation = nil; self.failedPages += 1; self.web.stopLoading()
            self.onStatus?("页面超时，保留缓存并继续", true)
            self.next()
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard busy, navigation === activeNavigation else { return }
        let expected = perPageToken
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.extract(expected: expected, attempt: 0) }
    }
    func extract(expected: UUID, attempt: Int) {
        guard busy, perPageToken == expected else { return }
        guard let raw = web.url?.absoluteString, schoolURL(raw, source: source) != nil else { cancel(); onStatus?("请打开学校网页登录，再点刷新", false); return }
        web.evaluateJavaScript(extractionScript(script, source: source)) { [weak self] value, error in
            guard let self = self, self.busy, self.perPageToken == expected else { return }
            guard error == nil, let raw = value as? String, let data = raw.data(using: .utf8), let snapshot = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                self.perPageToken = UUID(); self.failedPages += 1; self.onStatus?("页面读取失败，保留上次数据", true); self.next(); return
            }
            if snapshot["loginRequired"] as? Bool == true {
                self.onSnapshot?(snapshot); self.busy = false; self.perPageToken = UUID(); self.onStatus?("登录已失效，请打开学校网页重新登录", false); return
            }
            let keys = self.source == "seiue" ? ["schedule", "calendarDates"] : ["courses", "tasks", "feedback", "links"]
            let empty = keys.allSatisfy { (snapshot[$0] as? [Any] ?? []).isEmpty } && !(snapshot["officialGPA"] is [String: Any])
            if empty && attempt < 3 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.extract(expected: expected, attempt: attempt + 1) }
                return
            }
            if !empty { self.readablePages += 1 }
            self.onSnapshot?(snapshot)
            if self.source == "managebac" { self.enqueue(snapshot["links"] as? [[String: Any]] ?? []) }
            self.perPageToken = UUID()
            let runToken = self.token
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
                guard let self = self, self.token == runToken else { return }
                self.next()
            }
        }
    }
    func enqueue(_ links: [[String: Any]]) {
        let sorted = links.sorted { ($0["kind"] as? String == "feedback" ? 1 : 0) < ($1["kind"] as? String == "feedback" ? 1 : 0) }
        for link in sorted {
            guard let raw = link["url"] as? String, let url = schoolURL(raw, source: source) else { continue }
            let path = url.path
            let readOnly = ["/student/home", "/student/grades", "/student/reports", "/student/academics"].contains(path) || path.range(of: "^/student/classes/[0-9]+(?:/core_tasks(?:/[0-9]+)?)?/?$", options: .regularExpression) != nil
            guard readOnly, !visited.contains(raw), !queue.contains(where: { $0.absoluteString == raw }) else { continue }
            if link["kind"] as? String == "feedback" { queue.append(url) }
            else { queue.insert(url, at: 0) }
            if queue.count > 150 { queue = Array(queue.prefix(150)) }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { if navigation === activeNavigation { navigationFailed(error) } }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { if navigation === activeNavigation { navigationFailed(error) } }
    func navigationFailed(_ error: Error) {
        guard busy, (error as NSError).code != NSURLErrorCancelled else { return }
        perPageToken = UUID(); activeNavigation = nil; failedPages += 1; onStatus?("网络不可用，保留缓存", true); next()
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame == false {
            let scheme = action.request.url?.scheme ?? ""
            decisionHandler(["https", "about"].contains(scheme) ? .allow : .cancel)
            return
        }
        guard let url = action.request.url, url.scheme == "https" else { decisionHandler(.cancel); return }
        if url.host != sourceHosts[source] { decisionHandler(.cancel); cancel(); onStatus?("需要登录：请打开学校网页", false); return }
        decisionHandler(.allow)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var dashboard: WKWebView!
    var statusItem: NSStatusItem!
    var browsers: [String: SchoolBrowser] = [:]
    var workers: [String: SyncWorker] = [:]
    var refreshTimer: Timer?
    var state: [String: Any] = [:]
    var canSaveState = true
    var ready = false
    var refreshMinutes = 15
    let resources = Bundle.main.resourceURL!
    let dataFolder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CampusDesk", isDirectory: true)
    var stateURL: URL { dataFolder.appendingPathComponent("state.json") }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        do {
            try FileManager.default.createDirectory(at: dataFolder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: dataFolder.path)
            if FileManager.default.fileExists(atPath: stateURL.path) {
                do { state = try readSavedState(stateURL) }
                catch {
                    let preserved = dataFolder.appendingPathComponent("state.unreadable-" + UUID().uuidString + ".json")
                    // Never overwrite an unreadable file until a separate copy exists.
                    try FileManager.default.copyItem(at: stateURL, to: preserved)
                    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: preserved.path)
                    let previous = dataFolder.appendingPathComponent("state.previous.json")
                    if let recovered = try? readSavedState(previous) { state = recovered }
                    let alert = NSAlert(); alert.messageText = state.isEmpty ? "上次数据无法读取" : "已恢复上一次备份"
                    alert.informativeText = "无法读取的文件已另存为 \(preserved.lastPathComponent)，可在 Application Support/CampusDesk 找到。" + (state.isEmpty ? "本次将从空看板开始，也可导入导出的备份。" : "最新一次修改可能需要重新填写。")
                    alert.runModal()
                }
            }
        } catch {
            canSaveState = false
            let alert = NSAlert(); alert.messageText = "无法读取上次数据"; alert.informativeText = "原文件保留在 Application Support/CampusDesk。请先导出备份或检查磁盘权限。\n\(error.localizedDescription)"; alert.runModal()
        }
        createMenus()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "campus")
        dashboard = WKWebView(frame: .zero, configuration: config)
        dashboard.navigationDelegate = self
        dashboard.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1220, height: 850), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "CampusDesk · 学习看板"
        window.minSize = NSSize(width: 900, height: 640)
        window.isReleasedWhenClosed = false
        window.contentView = dashboard
        window.center(); window.makeKeyAndOrderFront(nil)
        dashboard.loadFileURL(resources.appendingPathComponent("index.html"), allowingReadAccessTo: resources)
        for source in ["seiue", "managebac"] {
            let worker = SyncWorker(source: source, resources: resources)
            worker.onSnapshot = { [weak self] snapshot in self?.emit(["type": "snapshot", "snapshot": snapshot]) }
            worker.onStatus = { [weak self] message, busy in self?.status(source, message, busy) }
            workers[source] = worker
        }
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(wokeUp), name: NSWorkspace.didWakeNotification, object: nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func createMenus() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); let appMenu = NSMenu()
        appMenu.addItem(withTitle: "显示学习看板", action: #selector(showDashboard), keyEquivalent: "1").target = self
        appMenu.addItem(withTitle: "刷新学校数据", action: #selector(sync), keyEquivalent: "r").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 CampusDesk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let edit = NSMenuItem(); let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editMenu; menu.addItem(edit); NSApp.mainMenu = menu
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "◷ 学习看板"
        let tray = NSMenu()
        tray.addItem(withTitle: "打开学习看板", action: #selector(showDashboard), keyEquivalent: "").target = self
        tray.addItem(withTitle: "刷新学校数据", action: #selector(sync), keyEquivalent: "").target = self
        tray.addItem(withTitle: "打开希悦", action: #selector(openSeiue), keyEquivalent: "").target = self
        tray.addItem(withTitle: "打开 ManageBac", action: #selector(openManageBac), keyEquivalent: "").target = self
        tray.addItem(.separator()); tray.addItem(withTitle: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = tray
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showDashboard(); return true }
    @objc func showDashboard() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func sync() { for worker in workers.values { worker.start() } }
    @objc func wokeUp() { DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.sync() } }
    @objc func openSeiue() { openSource("seiue", raw: nil) }
    @objc func openManageBac() { openSource("managebac", raw: nil) }
    func openSource(_ source: String, raw: String?) {
        guard sourceHomes[source] != nil else { return }
        if browsers[source] == nil {
            let browser = SchoolBrowser(source: source)
            browser.onCapture = { [weak self] web, source in self?.capture(web, source: source) }
            browsers[source] = browser
        }
        browsers[source]?.show(url: raw.flatMap { schoolURL($0, source: source) })
    }
    func capture(_ web: WKWebView, source: String) {
        guard let raw = web.url?.absoluteString, schoolURL(raw, source: source) != nil, let script = workers[source]?.script else { status(source, "请先打开已登录的学校页面", false); return }
        web.evaluateJavaScript(extractionScript(script, source: source)) { [weak self] value, error in
            guard error == nil, let text = value as? String, let data = text.data(using: .utf8), let snapshot = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { self?.status(source, "读取失败，请等待页面加载完成再试", false); return }
            self?.emit(["type": "snapshot", "snapshot": snapshot])
            let loginRequired = snapshot["loginRequired"] as? Bool == true
            let warnings = snapshot["warnings"] as? [String] ?? []
            self?.status(source, loginRequired ? "请在学校页面登录后再读取" : (warnings.first.map { "已读取当前页；" + $0 } ?? "已读取当前页"), false)
        }
    }
    func emit(_ value: [String: Any]) {
        guard ready, let payload = json(value) else { return }
        dashboard.evaluateJavaScript("window.CampusDesk.receive(" + payload + ");", completionHandler: nil)
    }
    func status(_ source: String, _ message: String, _ busy: Bool) { emit(["type": "status", "source": source, "message": message, "busy": busy]) }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === dashboard, message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, url.isFileURL,
              url.standardizedFileURL.path == resources.appendingPathComponent("index.html").standardizedFileURL.path,
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "ready": ready = true; emit(["type": "state", "state": state]); configureTimer(); DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.sync() }
        case "saveState":
            if let candidate = body["state"] as? [String: Any], candidate["version"] as? Int == 1, let encoded = json(candidate), encoded.utf8.count <= 20_000_000 {
                // Keep current edits exportable even if this session cannot write its state file.
                state = candidate; configureTimer()
                guard canSaveState else { status("app", "本次无法保存到磁盘，请导出备份并检查数据目录权限", false); return }
                do {
                    if FileManager.default.fileExists(atPath: stateURL.path), (try? readSavedState(stateURL)) != nil {
                        let backup = dataFolder.appendingPathComponent("state.previous.json")
                        try Data(contentsOf: stateURL).write(to: backup, options: .atomic)
                        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
                    }
                    try Data(encoded.utf8).write(to: stateURL, options: .atomic)
                    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
                } catch { status("app", "保存失败：" + error.localizedDescription, false) }
            }
        case "openSource": if let source = body["source"] as? String { openSource(source, raw: body["url"] as? String) }
        case "sync": sync()
        case "setMenuTitle": if let title = body["title"] as? String { statusItem.button?.title = String(title.prefix(32)) }
        case "exportData": exportData()
        case "importData": importData()
        case "clearSession": if let source = body["source"] as? String { clearSession(source) }
        default: break
        }
    }
    func configureTimer() {
        let value = (state["settings"] as? [String: Any])?["refreshMinutes"] as? Int ?? 15
        let clamped = max(5, min(120, value))
        if refreshTimer != nil && clamped == refreshMinutes { return }
        refreshMinutes = clamped; refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(clamped * 60), repeats: true) { [weak self] _ in self?.sync() }
    }
    func exportData() {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "CampusDesk-backup.json"; panel.allowedFileTypes = ["json"]
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let self = self, let url = panel.url, let text = json(self.state) else { return }
            do {
                try Data(text.utf8).write(to: url, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
                self.status("app", "备份已导出（不包含登录凭据）", false)
            }
            catch { self.status("app", "导出失败：" + error.localizedDescription, false) }
        }
    }
    func importData() {
        let panel = NSOpenPanel(); panel.allowedFileTypes = ["json"]; panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let self = self, let url = panel.url else { return }
            do {
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 5_000_000 else { self.status("app", "导入文件不能超过 5 MB", false); return }
                let candidate = try readSavedState(url)
                self.emit(["type": "import", "state": candidate])
            } catch { self.status("app", "导入失败：" + error.localizedDescription, false) }
        }
    }
    func clearSession(_ source: String) {
        guard let host = sourceHosts[source] else { return }
        let alert = NSAlert(); alert.messageText = "退出此学校系统？"; alert.informativeText = "将清除此应用中的登录状态，下次需重新登录。已缓存的课表、任务和成绩仍会保留。"; alert.addButton(withTitle: "退出登录"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            self?.workers[source]?.cancel()
            self?.browsers[source]?.web.stopLoading()
            self?.browsers[source]?.window.close(); self?.browsers[source] = nil
            let store = WKWebsiteDataStore.default()
            store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
                let domain = source == "managebac" ? "managebac.cn" : "seiue.com"
                let selected = records.filter { $0.displayName == host || $0.displayName == domain || $0.displayName.hasSuffix("." + domain) }
                store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: selected) { self?.status(source, "已退出，请重新登录", false) }
            }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, url.isFileURL, url.standardizedFileURL.path.hasPrefix(resources.standardizedFileURL.path + "/") else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
