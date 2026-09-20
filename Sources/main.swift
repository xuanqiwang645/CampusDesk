import Cocoa
import WebKit

let schoolEndpoints = CampusSchoolConfiguration.load(resources: Bundle.main.resourceURL)
let sourceHomes = schoolEndpoints.homes.merging(["teams": "https://teams.microsoft.com/"]) { _, teams in teams }
let sourceHosts: [String: [String]] = sourceHomes.reduce(into: [:]) { result, entry in
    if let host = URL(string: entry.value)?.host { result[entry.key] = [host] }
}.merging(["teams": ["teams.microsoft.com", "teams.cloud.microsoft"]]) { _, teams in teams }
let sourceLabels = ["seiue": "希悦", "managebac": "ManageBac", "teams": "Microsoft Teams"]
let processPool = WKProcessPool()

func safeHTTPSURL(_ raw: String) -> URL? {
    guard raw.count <= 4096, let url = URL(string: raw), url.scheme?.lowercased() == "https", url.host != nil,
          url.user == nil, url.password == nil, url.port == nil || url.port == 443 else { return nil }
    // Never persist or open OAuth callback credentials as a page or attachment URL.
    let secretKeys: Set<String> = ["access_token", "refresh_token", "id_token", "token", "client_secret", "password", "passwd", "assertion", "code", "authorization", "auth_token", "session_token", "authkey", "sig", "signature", "session_state"]
    let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    if components?.queryItems?.contains(where: { secretKeys.contains($0.name.lowercased()) }) == true { return nil }
    if let fragment = components?.fragment?.removingPercentEncoding,
       fragment.range(of: "(?:^|[?&#])(?:access_token|refresh_token|id_token|token|client_secret|password|passwd|assertion|code|authorization|auth_token|session_token|authkey|sig|signature|session_state)=", options: [.regularExpression, .caseInsensitive]) != nil { return nil }
    return url
}
func schoolURL(_ raw: String, source: String) -> URL? {
    guard let url = safeHTTPSURL(raw), let host = url.host?.lowercased(), sourceHosts[source]?.contains(host) == true else { return nil }
    return url
}
func attachmentURL(_ raw: String) -> URL? {
    guard let url = safeHTTPSURL(raw), let host = url.host?.lowercased() else { return nil }
    let exact = ["teams.microsoft.com", "teams.cloud.microsoft", "onedrive.live.com", "1drv.ms"]
    guard exact.contains(host) || host.hasSuffix(".sharepoint.com") || host.hasSuffix(".sharepoint.cn") else { return nil }
    return url
}
func validatedTeamsPages(_ pages: [[String: Any]]) -> [[String: Any]] {
    var seen = Set<String>()
    var result: [[String: Any]] = []
    for page in pages {
        guard let raw = page["url"] as? String, let url = schoolURL(raw, source: "teams"), seen.insert(url.absoluteString).inserted else { continue }
        let proposedKind = page["kind"] as? String ?? "auto"
        let kind = ["auto", "assignments", "ec"].contains(proposedKind) ? proposedKind : "auto"
        result.append(["url": url.absoluteString, "kind": kind, "label": String((page["label"] as? String ?? "Teams 频道").prefix(160))])
        if result.count == 20 { break }
    }
    return result
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
func extractionScript(_ script: String, source: String, options: [String: Any] = [:]) -> String {
    let object = ["seiue": "CampusSeiue", "managebac": "CampusManageBac", "teams": "CampusTeams"][source]!
    let origins = json((sourceHosts[source] ?? []).map { "https://" + $0 }) ?? "[]"
    let argument = source == "teams" ? (json(options) ?? "{}") : ""
    return "(function(){if(!" + origins + ".includes(location.origin)) throw new Error('Unexpected origin');\n" + script + "\nreturn JSON.stringify(window." + object + ".extract(" + argument + "));})();"
}

enum StateReadError: LocalizedError {
    case invalid
    var errorDescription: String? { "文件不是有效的 CampusDesk 备份，或超过 25 MiB。" }
}

func readSavedState(_ url: URL) throws -> [String: Any] {
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size <= 26_214_400 else { throw StateReadError.invalid }
    let data = try Data(contentsOf: url)
    guard data.count <= 26_214_400, let candidate = try JSONSerialization.jsonObject(with: data) as? [String: Any], candidate["version"] as? Int == 1 else { throw StateReadError.invalid }
    return candidate
}

final class SchoolBrowser: NSObject, WKNavigationDelegate, WKUIDelegate {
    let source: String
    let window: NSWindow
    let web: WKWebView
    let address = NSTextField(labelWithString: "")
    var onCapture: ((WKWebView, String, Bool) -> Void)?
    init(source: String) {
        self.source = source
        web = WKWebView(frame: .zero, configuration: schoolConfig())
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1160, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        super.init()
        window.title = (sourceLabels[source] ?? source) + " · 学校原网页"
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
        address.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
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
    @objc func goHome() {
        guard let home = sourceHomes[source], let url = schoolURL(home, source: source) else {
            address.stringValue = CampusSchoolConfiguration.help; return
        }
        web.load(URLRequest(url: url))
    }
    @objc func reloadPage() { web.reload() }
    @objc func capturePage() { onCapture?(web, source, false) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        address.stringValue = webView.url?.absoluteString ?? ""
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // The visible login window may follow the school's federated HTTPS
        // sign-in redirects. Extraction and background workers remain restricted
        // to the exact configured school origin.
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
    var pageOptions: [String: [String: Any]] = [:]
    var currentOptions: [String: Any] = [:]
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
    func start(pages: [[String: Any]] = []) {
        guard !busy else { return }
        guard source == "teams" || sourceHomes[source] != nil else { onStatus?(CampusSchoolConfiguration.help, false); return }
        guard !script.isEmpty else { onStatus?("缺少页面读取组件，请重新安装应用", false); return }
        busy = true; token = UUID(); visited.removeAll(); queue.removeAll(); pageCount = 0; readablePages = 0; failedPages = 0; pageLimitReached = false
        pageOptions.removeAll(); currentOptions = [:]
        if source == "teams" {
            for page in validatedTeamsPages(pages) {
                guard let raw = page["url"] as? String, let url = schoolURL(raw, source: source) else { continue }
                queue.append(url); pageOptions[url.absoluteString] = page
            }
            guard !queue.isEmpty else { busy = false; onStatus?("请打开 Teams，进入所需频道并点击「关注此频道」", false); return }
        } else {
            guard let home = sourceHomes[source], let url = schoolURL(home, source: source) else {
                busy = false; onStatus?(CampusSchoolConfiguration.help, false); return
            }
            queue.append(url)
        }
        onStatus?(source == "teams" ? "正在读取已关注的 Teams 页面…" : "正在读取学校页面…", true)
        next()
    }
    func cancel() { token = UUID(); perPageToken = UUID(); activeNavigation = nil; busy = false; queue.removeAll(); web.stopLoading() }
    func next() {
        guard busy else { return }
        let pageLimit = source == "teams" ? 20 : 55
        if queue.isEmpty || pageCount >= pageLimit {
            pageLimitReached = pageCount >= pageLimit && !queue.isEmpty
            busy = false
            activeNavigation = nil
            let message: String
            if readablePages == 0 {
                message = failedPages > 0 ? "本轮未能读取学校数据，保留缓存；请检查网络或打开原页" : "页面暂无可识别数据，保留缓存；请打开原页检查登录与页面"
            } else if pageLimitReached {
                message = "已检查 \(pageLimit) 页；更多内容可打开原页读取"
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
        currentOptions = pageOptions[url.absoluteString] ?? [:]
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
        DispatchQueue.main.asyncAfter(deadline: .now() + (source == "teams" ? 5 : 2)) { [weak self] in self?.extract(expected: expected, attempt: 0) }
    }
    func extract(expected: UUID, attempt: Int) {
        guard busy, perPageToken == expected else { return }
        guard let raw = web.url?.absoluteString, schoolURL(raw, source: source) != nil else { cancel(); onStatus?("请打开 \(sourceLabels[source] ?? source) 网页登录，再点刷新", false); return }
        web.evaluateJavaScript(extractionScript(script, source: source, options: currentOptions)) { [weak self] value, error in
            guard let self = self, self.busy, self.perPageToken == expected else { return }
            guard error == nil, let raw = value as? String, let data = raw.data(using: .utf8), let snapshot = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                if self.source == "teams" && attempt < 3 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.extract(expected: expected, attempt: attempt + 1) }
                    return
                }
                self.perPageToken = UUID(); self.failedPages += 1; self.onStatus?("页面读取失败，保留上次数据", true); self.next(); return
            }
            if snapshot["loginRequired"] as? Bool == true {
                self.onSnapshot?(snapshot); self.busy = false; self.perPageToken = UUID(); self.onStatus?("登录已失效，请打开学校网页重新登录", false); return
            }
            let keys = self.source == "seiue" ? ["schedule", "calendarDates"] : (self.source == "teams" ? ["tasks", "posts"] : ["courses", "tasks", "feedback", "links"])
            let empty = keys.allSatisfy { (snapshot[$0] as? [Any] ?? []).isEmpty } && !(snapshot["officialGPA"] is [String: Any])
            let parseError = snapshot["parseError"] as? Bool == true || !(snapshot["parseError"] as? String ?? "").isEmpty
            if (empty || parseError) && attempt < 3 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.extract(expected: expected, attempt: attempt + 1) }
                return
            }
            if parseError { self.failedPages += 1 }
            else if !empty { self.readablePages += 1 }
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
        if schoolURL(url.absoluteString, source: source) == nil { decisionHandler(.cancel); cancel(); onStatus?("需要登录或打开原页：请打开 \(sourceLabels[source] ?? source)", false); return }
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
    var countdownTimer: Timer?
    var countdownEndsAt: Date?
    var countdownLabel = "课间剩余"
    var countdownNextTitle = "上课中"
    var normalMenuTitle = "◷ 学习看板"
    let notifications = CampusNotifications()
    lazy var teamsBrowserBridge = TeamsBrowserBridge(resources: resources)
    lazy var teamsAutoBridge = TeamsAutoBridge(resources: resources)
    var teamsAutoProgress: [String: Any] = [:]
    var teamsLoginRetryTimer: Timer?
    var teamsBrowserAccount: String?
    var attachmentGeneration = UUID()
    var attachmentRequests = Set<String>()
    var attachmentsParsed = 0
    lazy var graphAuth = GraphAuth(resources: resources)
    lazy var teamsGraph = TeamsGraph(tokenProvider: { [weak self] forceRefresh, completion in
        guard let self = self else { completion(.failure(NSError(domain: "CampusDesk", code: -1, userInfo: [NSLocalizedDescriptionKey: "应用已关闭"]))); return }
        self.graphAuth.accessToken(forceRefresh: forceRefresh, completion: completion)
    })
    var graphProgress: [String: Any] = [:]
    var graphGeneration = UUID()
    var graphSigningIn = false
    var pendingGraphBatches = Set<String>()
    var pendingGraphCheckpoint: [String: Any]?
    var state: [String: Any] = [:]
    var graphLocalPartial = false
    var graphLocalWarnings: [String] = []
    var graphSaveFailed = false
    var stateDurable = true
    var canSaveState = true
    var ready = false
    var refreshMinutes = 15
    let resources = Bundle.main.resourceURL!
    let dataFolder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CampusDesk", isDirectory: true)
    var stateURL: URL { dataFolder.appendingPathComponent("state.json") }
    var graphCheckpointURL: URL { dataFolder.appendingPathComponent("Graph-sync.json") }
    var graphIdentityURL: URL { dataFolder.appendingPathComponent("Graph-account.json") }
    var teamsAutoStatusURL: URL { dataFolder.appendingPathComponent("Teams-auto-status.json") }
    var teamsAutoCheckpointURL: URL { dataFolder.appendingPathComponent("teams-auto-session.json") }
    var teamsBrowserIdentityURL: URL { dataFolder.appendingPathComponent("Teams-browser-account.json") }
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
        config.userContentController.addUserScript(WKUserScript(source: "window.CampusSchoolConfig = " + (json(schoolEndpoints.frontend) ?? "{}") + ";", injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
        notifications.onEvent = { [weak self] event in self?.emit(event) }
        notifications.onOpen = { [weak self] raw in self?.openSource("teams", raw: raw) }
        configureGraph()
        configureTeamsAuto()

        for source in ["seiue", "managebac"] {
            let worker = SyncWorker(source: source, resources: resources)
            worker.onSnapshot = { [weak self] snapshot in self?.emit(["type": "snapshot", "snapshot": snapshot]) }
            worker.onStatus = { [weak self] message, busy in self?.status(source, message, busy) }
            workers[source] = worker
        }
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(wokeUp), name: NSWorkspace.didWakeNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(willSleep), name: NSWorkspace.willSleepNotification, object: nil)
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
        tray.addItem(withTitle: "打开 Microsoft Teams", action: #selector(openTeams), keyEquivalent: "").target = self
        tray.addItem(.separator()); tray.addItem(withTitle: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = tray
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showDashboard(); return true }
    func applicationWillTerminate(_ notification: Notification) {
        teamsLoginRetryTimer?.invalidate()
        teamsBrowserBridge.cancel(); teamsAutoBridge.cancel(); teamsGraph.cancel()
        workers.values.forEach { $0.cancel() }
    }
    @objc func showDashboard() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    var teamsPages: [[String: Any]] { validatedTeamsPages((state["settings"] as? [String: Any])?["teamsPages"] as? [[String: Any]] ?? []) }
    var teamsBrowserChoice: String { (state["settings"] as? [String: Any])?["teamsBrowser"] as? String == "edge" ? "edge" : "chrome" }
    var teamsBrowserAutomation: Bool { (state["settings"] as? [String: Any])?["teamsBrowserAutomation"] as? Bool ?? false }
    var teamsAutoDiscover: Bool { (state["settings"] as? [String: Any])?["teamsAutoDiscover"] as? Bool ?? true }
    var teamsMode: String { (state["settings"] as? [String: Any])?["teamsMode"] as? String == "browser" ? "browser" : "graph" }
    var graphIncludeChats: Bool { (state["settings"] as? [String: Any])?["graphIncludeChats"] as? Bool ?? true }
    @objc func sync() {
        for worker in workers.values { worker.start() }
        syncTeams()
    }
    func syncTeams() {
        if teamsMode == "graph" { syncGraph() }
        else if teamsAutoDiscover { startTeamsAuto() }
        else { runTeamsBrowser("sync") }
    }
    @objc func willSleep() {
        stopTeamsAuto(message: "Mac 已休眠，已保留读取结果；唤醒后继续检查")
        teamsBrowserBridge.cancel(); cancelGraphSync()
        workers.values.forEach { $0.cancel() }
    }
    @objc func wokeUp() { updateCountdown(); DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.sync() } }
    @objc func openSeiue() { openSource("seiue", raw: nil) }
    @objc func openManageBac() { openSource("managebac", raw: nil) }
    @objc func openTeams() { openSource("teams", raw: nil) }
    func openSource(_ source: String, raw: String?) {
        guard let home = sourceHomes[source] else {
            if CampusSchoolConfiguration.sources.contains(source) { status(source, CampusSchoolConfiguration.help, false) }
            return
        }
        if source == "teams" {
            if teamsMode == "browser" { openTeamsBrowser(raw: raw) }
            else if let url = schoolURL(raw ?? home, source: "teams") { NSWorkspace.shared.open(url) }
            return
        }
        if let raw = raw, schoolURL(raw, source: source) == nil { status(source, "地址不属于当前配置的学校，已取消打开", false); return }
        if browsers[source] == nil {
            let browser = SchoolBrowser(source: source)
            browser.onCapture = { [weak self] web, source, selectionOnly in self?.capture(web, source: source, selectionOnly: selectionOnly) }
            browsers[source] = browser
        }
        browsers[source]?.show(url: raw.flatMap { schoolURL($0, source: source) })
    }
    func openTeamsBrowser(raw: String?) {
        let browser = teamsBrowserChoice
        let name = TeamsBrowserBridge.displayName(browser)
        guard let application = TeamsBrowserBridge.installedURL(browser) else {
            status("teams", "尚未安装 \(name)，请安装后重试或在设置中选择另一浏览器", false); return
        }
        let requested = raw ?? sourceHomes["teams"]!
        guard let url = schoolURL(requested, source: "teams") else { status("teams", "Teams 页面地址无效，请重新选择所需频道", false); return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        // Opening a browser does not read it and does not require Apple Events access.
        NSWorkspace.shared.open([url], withApplicationAt: application, configuration: configuration) { [weak self] _, error in
            DispatchQueue.main.async {
                self?.status("teams", error == nil ? "已在 \(name) 打开 Teams，请在浏览器中登录" : "无法打开 \(name)，请手动启动后重试", false)
            }
        }
    }
    func runTeamsBrowser(_ operation: String, selectionOnly: Bool = false) {
        guard teamsMode == "browser" else { emitGraphStatus(); return }
        guard !teamsAutoBridge.isRunning else {
            status("teams", "Teams 正在自动遍历页面；请先停止自动读取再手动读取当前页", true); return
        }
        guard teamsBrowserAutomation else {
            status("teams", "Teams 使用 Chrome 或 Edge；请先在设置中开启浏览器读取", false); return
        }
        if operation == "sync" && teamsPages.isEmpty {
            status("teams", "请在浏览器打开 Teams 频道，再点击「关注浏览器当前频道」", false); return
        }
        status("teams", operation == "sync" ? "正在读取浏览器中已打开的关注页面…" : "正在读取浏览器当前 Teams 页面…", true)
        teamsBrowserBridge.run(operation: operation, browser: teamsBrowserChoice, pages: teamsPages, selectionOnly: selectionOnly) { [weak self] result in
            guard let self = self else { return }
            // Failure snapshots still record a failed attempt while Core retains the
            // last readable cache; never hide a login/parse failure behind old data.
            let snapshots = result["snapshots"] as? [[String: Any]] ?? []
            for snapshot in snapshots.prefix(20) where snapshot["source"] as? String == "teams" {
                self.emit(["type": "snapshot", "snapshot": snapshot])
            }
            guard result["ok"] as? Bool == true else {
                self.status("teams", result["message"] as? String ?? "Teams 读取失败，缓存保留", result["code"] as? String == "busy"); return
            }
            if operation == "pin" {
                guard let rawPage = result["page"] as? [String: Any], let page = validatedTeamsPages([rawPage]).first, let raw = page["url"] as? String else {
                    self.status("teams", "未能读取有效的 Teams 页面地址，请在浏览器中进入所需频道后重试", false); return
                }
                guard self.teamsPages.count < 20 || self.teamsPages.contains(where: { $0["url"] as? String == raw }) else {
                    self.status("teams", "最多关注 20 个页面，请先移除不再使用的频道", false); return
                }
                self.emit(["type": "pinTeamsPage", "page": page])
            }
            let warnings = result["warnings"] as? [String] ?? []
            let skipped = result["skipped"] as? [Any] ?? []
            var message = operation == "pin" ? "已读取页面地址，请确认类型并保存关注" : (result["message"] as? String ?? "已读取 \(snapshots.count) 个 Teams 页面")
            if let warning = warnings.first { message += "；" + warning }
            else if !skipped.isEmpty { message += "；\(skipped.count) 个页面未打开或暂时不可读取，缓存保留" }
            self.status("teams", message, false)
        }
    }
    func configureTeamsAuto() {
        if state.isEmpty {
            state = ["version": 1, "settings": [String: Any](),
                     "snapshots": ["seiue": [String: Any](), "managebac": [String: Any](), "teams": [String: Any]()],
                     "manualTasks": [Any](), "taskChecks": [String: Any](), "feedbackRead": [String: Any](), "gradeHistory": [Any]()]
        }
        var settings = state["settings"] as? [String: Any] ?? [:]
        // An unconfigured Graph client cannot sign in. Preserve the browser grant
        // and existing cache while selecting the usable local-browser connection.
        if graphAuth.status()["configured"] as? Bool != true {
            settings["teamsMode"] = "browser"
        }
        if settings["teamsAutoDiscover"] == nil { settings["teamsAutoDiscover"] = true }
        state["settings"] = settings
        if state["version"] as? Int == 1 { stateDurable = persistState() }
        teamsAutoProgress = ["running": false, "phase": "idle", "coverage": "unknown",
                             "message": "登录 Teams 并允许浏览器读取后，将自动发现频道、聊天和作业"]
        if let size = try? teamsAutoStatusURL.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 262_144,
           let data = try? Data(contentsOf: teamsAutoStatusURL),
           var previous = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if previous["running"] as? Bool == true {
                previous["phase"] = "interrupted"; previous["coverage"] = "partial"
                previous["message"] = "上轮读取已中断，已保存成功读取的内容；应用启动后将再次检查"
            }
            previous["running"] = false; teamsAutoProgress = previous
        }
        if let size = try? teamsBrowserIdentityURL.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 4096,
           let data = try? Data(contentsOf: teamsBrowserIdentityURL),
           let identity = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
            teamsBrowserAccount = identity["accountId"]
        }
    }
    func emitTeamsAutoStatus() {
        var event = teamsAutoProgress
        event["type"] = "teamsAutoStatus"
        event["running"] = teamsAutoBridge.isRunning && event["running"] as? Bool != false
        if event["updatedAt"] == nil { event["updatedAt"] = ISO8601DateFormatter().string(from: Date()) }
        // This small local status file contains counts and coverage, not messages
        // from Teams. It also makes interrupted native runs diagnosable.
        if let encoded = json(event), encoded.utf8.count <= 262_144 {
            do {
                try Data(encoded.utf8).write(to: teamsAutoStatusURL, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: teamsAutoStatusURL.path)
            } catch { /* Losing status must not overwrite or discard saved snapshots. */ }
        }
        emit(event)
        if teamsMode == "browser", teamsAutoDiscover {
            status("teams", event["message"] as? String ?? "等待 Teams 自动读取", event["running"] as? Bool ?? false)
        }
    }
    func teamsAttachmentCache() -> [[String: String]] {
        guard let account = teamsBrowserAccount,
              let snapshots = (state["snapshots"] as? [String: Any])?["teams"] as? [String: [String: Any]] else { return [] }
        var result = [[String: String]](), seen = Set<String>()
        for snapshot in snapshots.values where snapshot["accountId"] as? String == account {
            let rows = (snapshot["posts"] as? [[String: Any]] ?? []) + (snapshot["tasks"] as? [[String: Any]] ?? [])
            for row in rows {
                for file in row["attachments"] as? [[String: Any]] ?? [] {
                    guard let id = file["id"] as? String, id.count <= 300,
                          let version = file["versionKey"] as? String,
                          version.range(of: "^v[0-9]+:[a-f0-9]{8,128}$", options: .regularExpression) != nil,
                          ["text_extracted", "partial"].contains(file["extractionCoverage"] as? String ?? ""),
                          file["truncated"] as? Bool != true,
                          file["extractionStatus"] as? String != "error",
                          !(file["pageCoverage"] as? [[String: Any]] ?? []).contains(where: { ["failed", "limit"].contains($0["ocrStatus"] as? String ?? "") }),
                          let text = file["text"] as? String, !text.isEmpty,
                          seen.insert(id).inserted else { continue }
                    result.append(["accountId": account, "attachmentId": id, "versionKey": version])
                    if result.count >= 300 { return result }
                }
            }
        }
        return result
    }
    func startTeamsAuto(loginOnly: Bool = false, focus: String = "all") {
        guard teamsMode == "browser" else { emitGraphStatus(); return }
        guard !teamsAutoBridge.isRunning, !teamsBrowserBridge.isRunning else { return }
        teamsLoginRetryTimer?.invalidate(); teamsLoginRetryTimer = nil
        attachmentGeneration = UUID(); attachmentRequests.removeAll(); attachmentsParsed = 0
        if !loginOnly && !teamsBrowserAutomation {
            teamsAutoProgress = ["running": false, "phase": "permission_required", "coverage": "unknown",
                                 "message": "请先在连接设置允许读取 Teams 浏览器页面，再登录 Teams"]
            emitTeamsAutoStatus(); return
        }
        if !loginOnly && (!canSaveState || !stateDurable) {
            teamsAutoProgress = ["running": false, "phase": "storage_error", "coverage": "partial",
                                 "message": "本机数据未能保存，自动读取已暂停；请检查磁盘空间并导出当前数据"]
            emitTeamsAutoStatus(); return
        }
        teamsAutoProgress = ["running": true, "phase": loginOnly ? "login" : "starting", "coverage": "partial",
                             "message": loginOnly ? "正在打开 Teams 登录页面…" : "正在自动发现 Teams 频道、聊天和作业…"]
        // Announce before launch; the bridge may reject synchronously.
        emit(["type": "teamsAutoStatus", "running": true, "phase": teamsAutoProgress["phase"]!,
              "coverage": "partial", "message": teamsAutoProgress["message"]!])
        teamsAutoBridge.run(browser: teamsBrowserChoice, operation: loginOnly ? "login" : "sync", checkpointPath: teamsAutoCheckpointURL.path,
                            includeChats: graphIncludeChats, maximumSeconds: loginOnly ? 45 : 1200, focus: focus, attachmentCache: teamsAttachmentCache(),
                            onEvent: { [weak self] event in
            guard let self = self else { return }
            switch event["type"] as? String {
            case "attachment": self.parseTeamsAttachment(event)
            case "attachmentUnchanged":
                guard let account = event["accountId"] as? String, account == self.teamsBrowserAccount else { return }
                var mapped = event; mapped["type"] = "teamsAttachmentUnchanged"; self.emit(mapped)
            case "snapshot":
                guard let snapshot = event["snapshot"] as? [String: Any], snapshot["source"] as? String == "teams" else {
                    self.stopTeamsAuto()
                    self.handleTeamsAutoError(["code": "snapshot_invalid", "message": "Teams 返回了无法识别的数据批次，已暂停读取并保留先前数据"])
                    return
                }
                if let account = snapshot["accountId"] as? String, !account.isEmpty,
                   !self.bindTeamsBrowserAccount(account) { return }
                self.emit(["type": "snapshot", "snapshot": snapshot])
            case "progress", "done":
                if let progress = event["status"] as? [String: Any] {
                    if let account = progress["accountId"] as? String, !account.isEmpty,
                       !self.bindTeamsBrowserAccount(account) { return }
                    self.teamsAutoProgress.merge(progress) { _, new in new }
                }
                if event["type"] as? String == "done" { self.teamsAutoProgress["running"] = false }
                self.emitTeamsAutoStatus()
            case "error": self.handleTeamsAutoError(event)
            default: break
            }
        }, completion: { [weak self] error in
            guard let self = self else { return }
            if let error = error { self.handleTeamsAutoError(error) }
            self.teamsAutoProgress["running"] = false
            self.emitTeamsAutoStatus()
            let phase = (self.teamsAutoProgress["phase"] as? String ?? "").lowercased()
            if loginOnly || ["need_login", "needs_login", "login_required", "auth_required", "login"].contains(phase) {
                self.scheduleTeamsLoginRetry()
            } else if phase == "waiting", let retry = self.teamsAutoProgress["retry"] as? [String: Any],
                      retry["accountId"] as? String == self.teamsBrowserAccount,
                      let raw = retry["retryAt"] as? String {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let precise = formatter.date(from: raw)
                formatter.formatOptions = [.withInternetDateTime]
                if let until = precise ?? formatter.date(from: raw), until.timeIntervalSinceNow > 0,
                   until.timeIntervalSinceNow <= 86_400 {
                    self.teamsLoginRetryTimer = Timer.scheduledTimer(withTimeInterval: until.timeIntervalSinceNow + 1, repeats: false) { [weak self] _ in
                        guard let self = self, self.teamsMode == "browser", self.teamsAutoDiscover, self.teamsBrowserAutomation else { return }
                        self.startTeamsAuto()
                    }
                }
            }
        })
    }
    func scheduleTeamsLoginRetry() {
        teamsLoginRetryTimer?.invalidate()
        guard teamsMode == "browser", teamsAutoDiscover, teamsBrowserAutomation else { return }
        teamsLoginRetryTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            guard let self = self, self.teamsMode == "browser", self.teamsAutoDiscover, self.teamsBrowserAutomation else { return }
            self.startTeamsAuto()
        }
    }
    func parseTeamsAttachment(_ event: [String: Any]) {
        guard let account = event["accountId"] as? String, account == teamsBrowserAccount,
              let snapshotID = event["snapshotId"] as? String, snapshotID.count <= 300,
              let attachmentID = event["attachmentId"] as? String, attachmentID.count <= 300,
              let encoded = event["base64"] as? String, encoded.utf8.count <= 16_777_216,
              let data = Data(base64Encoded: encoded), !data.isEmpty, data.count <= 12 * 1024 * 1024,
              attachmentRequests.count < 40 else { return }
        let key = snapshotID + "|" + attachmentID
        guard !attachmentRequests.contains(key) else { return }
        attachmentRequests.insert(key)
        let expected = attachmentGeneration
        let version = event["versionKey"] as? String ?? ""
        let began = Date()
        TeamsAttachmentParser.parse(data: data, mimeType: String((event["mimeType"] as? String ?? "").prefix(200)),
                                    name: String((event["title"] as? String ?? "附件").prefix(500))) { [weak self] result in
            guard let self = self, expected == self.attachmentGeneration, self.teamsBrowserAccount == account else { return }
            self.emit(["type": "teamsAttachment", "accountId": account, "snapshotId": snapshotID,
                       "attachmentId": attachmentID, "result": result,
                       "versionKey": version.range(of: "^v[0-9]+:[a-f0-9]{8,128}$", options: .regularExpression) != nil ? version : ""])
            if let text = result["text"] as? String, !text.isEmpty { self.attachmentsParsed += 1 }
            self.teamsAutoProgress["attachmentsParsed"] = self.attachmentsParsed
            self.teamsAutoProgress["attachmentParseMs"] = (self.teamsAutoProgress["attachmentParseMs"] as? Int ?? 0) + Int(Date().timeIntervalSince(began) * 1000)
            self.emitTeamsAutoStatus()
        }
    }
    func bindTeamsBrowserAccount(_ value: String) -> Bool {
        let account = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !account.isEmpty, account.count <= 300 else {
            stopTeamsAuto()
            handleTeamsAutoError(["code": "account_unknown", "message": "无法核对 Teams 账号身份，已暂停读取以避免混合不同账号的数据"])
            return false
        }
        if teamsBrowserAccount == account { return true }
        do {
            if let previous = teamsBrowserAccount, previous != account {
                guard let encoded = json(state) else { throw StateReadError.invalid }
                let archive = dataFolder.appendingPathComponent("state.before-teams-account-change-" + UUID().uuidString + ".json")
                try Data(encoded.utf8).write(to: archive, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: archive.path)
                let original = state
                var snapshots = state["snapshots"] as? [String: Any] ?? [:]
                snapshots["teams"] = [String: Any](); state["snapshots"] = snapshots
                for key in ["taskChecks", "feedbackRead"] {
                    if let values = state[key] as? [String: Any] { state[key] = values.filter { !$0.key.hasPrefix("teams:") } }
                }
                if var settings = state["settings"] as? [String: Any] {
                    settings["teamsDueOverrides"] = [String: Any](); state["settings"] = settings
                }
                guard persistState() else { state = original; throw StateReadError.invalid }
                notifications.sync(items: [], enabled: false)
                emit(["type": "state", "state": state])
            }
            let encoded = try JSONSerialization.data(withJSONObject: ["accountId": account])
            try encoded.write(to: teamsBrowserIdentityURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: teamsBrowserIdentityURL.path)
            teamsBrowserAccount = account
            return true
        } catch {
            stopTeamsAuto()
            handleTeamsAutoError(["code": "account_storage_error", "message": "Teams 账号已改变，但旧账号缓存未能安全归档或账号标识无法保存；自动读取已暂停，请检查磁盘空间"])
            return false
        }
    }
    func handleTeamsAutoError(_ event: [String: Any]) {
        teamsAutoProgress["running"] = false
        teamsAutoProgress["phase"] = event["code"] as? String ?? "error"
        teamsAutoProgress["coverage"] = "partial"
        teamsAutoProgress["message"] = event["message"] as? String ?? "Teams 读取暂时中断，已保留成功读取的内容"
        emitTeamsAutoStatus()
    }
    func stopTeamsAuto(message: String = "自动读取已停止，已保留成功读取的内容") {
        attachmentGeneration = UUID()
        let wasRunning = teamsAutoBridge.isRunning || teamsLoginRetryTimer != nil
        teamsLoginRetryTimer?.invalidate(); teamsLoginRetryTimer = nil
        teamsAutoBridge.cancel()
        if wasRunning {
            teamsAutoProgress["running"] = false; teamsAutoProgress["phase"] = "paused"
            teamsAutoProgress["coverage"] = "partial"; teamsAutoProgress["message"] = message
            emitTeamsAutoStatus()
        }
    }
    func capture(_ web: WKWebView, source: String, selectionOnly: Bool = false) {
        guard source != "teams" else { runTeamsBrowser("capture", selectionOnly: selectionOnly); return }
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
        case "ready":
            ready = true; emit(["type": "state", "state": state]); emitGraphStatus(); emitTeamsAutoStatus(); configureTimer()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.sync() }
        case "saveState":
            if let candidate = body["state"] as? [String: Any], candidate["version"] as? Int == 1,
               JSONSerialization.isValidJSONObject(candidate) {
                // Keep current edits exportable even if this session cannot write its state file.
                let acceptedImport = body["imported"] as? Bool == true
                if acceptedImport {
                    stopTeamsAuto(message: "正在导入数据，自动读取已停止")
                    teamsBrowserBridge.cancel()
                    cancelGraphSync(); clearGraphIdentity()
                    if graphSigningIn { graphAuth.signOut(); graphSigningIn = false }
                    notifications.sync(items: [], enabled: false)
                }
                let previousTeamsMode = teamsMode
                let previousIncludeChats = graphIncludeChats
                let previousTeamsBrowser = teamsBrowserChoice
                let wasReadingTeams = teamsBrowserAutomation
                let wasAutoDiscovering = teamsAutoDiscover
                let previousTeamsPages = json(teamsPages)
                state = candidate; configureTimer()
                if previousTeamsMode != teamsMode || previousIncludeChats != graphIncludeChats {
                    cancelGraphSync()
                    if graphSigningIn { graphAuth.signOut(); graphSigningIn = false }
                    teamsBrowserBridge.cancel()
                    stopTeamsAuto(message: "Teams 同步方式已更改，已保留读取缓存")
                    removeGraphCheckpoint()
                    graphProgress = [:]
                    emitGraphStatus()
                }
                // A removed page also revokes the scope of an in-flight reading run.
                if wasReadingTeams && (!teamsBrowserAutomation || previousTeamsBrowser != teamsBrowserChoice || previousTeamsPages != json(teamsPages)) {
                    let interrupted = teamsBrowserBridge.isRunning
                    teamsBrowserBridge.cancel()
                    if interrupted { status("teams", "浏览器或关注页面设置已更改，当前读取已停止；缓存保留", false) }
                }
                if (wasReadingTeams && (!teamsBrowserAutomation || previousTeamsBrowser != teamsBrowserChoice)) || (wasAutoDiscovering && !teamsAutoDiscover) {
                    stopTeamsAuto(message: "浏览器自动读取设置已更改，已保留读取缓存")
                }
                stateDurable = persistState()
                graphSaveFailed = !stateDurable
                if stateDurable { persistGraphCheckpointIfReady() }
                else if teamsMode == "graph" {
                    cancelGraphSync()
                    if graphSigningIn { graphAuth.signOut(); graphSigningIn = false }
                    graphProgress["status"] = "paused"; graphProgress["coverage"] = "partial"
                    graphProgress["partial"] = true; graphProgress["historyComplete"] = false
                    graphProgress["message"] = "Teams 同步已暂停：本机数据未能保存。请导出当前数据并检查磁盘空间；25 MiB 以上的备份不会覆盖原文件。"
                    emitGraphStatus()
                }
                else {
                    stopTeamsAuto(message: "本机数据未能保存，自动读取已暂停；请检查磁盘空间并导出当前数据")
                }
                if stateDurable, teamsMode == "browser", teamsAutoDiscover, teamsBrowserAutomation,
                   (!wasReadingTeams || !wasAutoDiscovering || previousTeamsMode != teamsMode || previousTeamsBrowser != teamsBrowserChoice) {
                    DispatchQueue.main.async { [weak self] in self?.startTeamsAuto() }
                }
                if acceptedImport, teamsMode == "graph", graphAuth.status()["connected"] as? Bool == true {
                    // Imported caches have no authenticated account binding. Preserve
                    // other platforms, then refetch Teams for the connected account.
                    DispatchQueue.main.async { [weak self] in self?.syncGraph() }
                }
            }
        case "openSource": if let source = body["source"] as? String { openSource(source, raw: body["url"] as? String) }
        case "pinTeamsBrowserPage": runTeamsBrowser("pin")
        case "captureTeamsBrowserPage": runTeamsBrowser("capture", selectionOnly: body["selectionOnly"] as? Bool ?? false)
        case "syncTeams": syncTeams()
        case "teams-auto-start": startTeamsAuto(focus: body["focus"] as? String == "ec" ? "ec" : "all")
        case "teams-auto-stop": stopTeamsAuto()
        case "teams-auto-login": startTeamsAuto(loginOnly: true)
        case "requestTeamsAutoStatus": emitTeamsAutoStatus()
        case "teamsAutoSnapshotFailed":
            stopTeamsAuto()
            handleTeamsAutoError(["code": "snapshot_invalid", "message": "本轮 Teams 数据无法完整保存，自动读取已暂停；已保留先前成功读取的内容"])
        case "requestGraphStatus": emitGraphStatus()
        case "graphSignIn": signInGraph()
        case "graphSignOut": signOutGraph()
        case "graphSync": syncGraph()
        case "graphSaveConfiguration":
            guard !graphSigningIn else { status("teams", "请先完成登录或退出登录，再修改连接配置", false); return }
            guard let clientId = body["clientId"] as? String, let tenant = body["tenant"] as? String else { return }
            do {
                stopTeamsAuto(message: "Teams 连接配置已更改，当前读取已停止")
                teamsBrowserBridge.cancel()
                cancelGraphSync()
                try graphAuth.configure(clientId: clientId, tenant: tenant)
                graphSigningIn = false; graphProgress = [:]
                clearGraphIdentity(); resetTeamsData(); emitGraphStatus()
            } catch { graphProgress = ["message": error.localizedDescription]; emitGraphStatus() }
        case "graphBatchProcessed":
            if let batchID = body["batchId"] as? String, pendingGraphBatches.remove(batchID) != nil {
                if body["partial"] as? Bool == true {
                    graphLocalPartial = true
                    for warning in (body["warnings"] as? [String] ?? []).prefix(10) {
                        let bounded = String(warning.prefix(1000))
                        if !bounded.isEmpty && !graphLocalWarnings.contains(bounded) && graphLocalWarnings.count < 20 {
                            graphLocalWarnings.append(bounded)
                        }
                    }
                }
                persistGraphCheckpointIfReady()
                if pendingGraphBatches.isEmpty { emitGraphStatus() }
            }
        case "graphBatchFailed":
            if let batchID = body["batchId"] as? String, pendingGraphBatches.contains(batchID) {
                cancelGraphSync()
                graphProgress["status"] = "paused"; graphProgress["coverage"] = "partial"
                graphProgress["partial"] = true; graphProgress["historyComplete"] = false
                graphProgress["message"] = "Teams 同步已暂停：部分数据未能转换，已保留现有内容和上次同步进度。请更新应用后重试。"
                emitGraphStatus()
            }
        case "sync": sync()
        case "setMenuTitle":
            if let title = body["title"] as? String {
                normalMenuTitle = String(title.prefix(32))
                if countdownEndsAt == nil { statusItem.button?.title = normalMenuTitle }
            }
        case "setMenuCountdown": configureCountdown(body)
        case "requestNotifications": notifications.requestPermission()
        case "syncReminders":
            let enabled = (state["settings"] as? [String: Any])?["teamsNotifications"] as? Bool ?? false
            notifications.sync(items: body["items"] as? [[String: Any]] ?? [], enabled: enabled)
        case "openAttachment":
            if let raw = body["url"] as? String, let url = attachmentURL(raw) { NSWorkspace.shared.open(url) }
            else { status("teams", "附件链接无效或不属于受支持的 Microsoft 文件站点，请在 Teams 原页打开", false) }
        case "exportData": exportData()
        case "importData": importData()
        case "clearSession": if let source = body["source"] as? String { clearSession(source) }
        default: break
        }
    }
    // Authentication remains in native code; JavaScript receives only account status
    // and Graph records. Tokens never enter the dashboard or JSON backups.
    func configureGraph() {
        graphAuth.presentationWindow = window
        graphAuth.onChange = { [weak self] _ in self?.emitGraphStatus() }
        if teamsMode == "graph", let current = currentGraphIdentity(), readGraphIdentity() != current {
            resetTeamsData()
            writeGraphIdentity(current)
        }
    }
    func emitGraphStatus() {
        var event = graphAuth.status()
        for key in ["message", "counts", "coverage", "lastSync", "warnings", "partial", "historyComplete", "status", "pending", "errors"] {
            if let value = graphProgress[key] { event[key] = value }
        }
        if graphLocalPartial {
            event["historyComplete"] = false; event["partial"] = true
            let workerWarnings = event["warnings"] as? [String] ?? []
            event["warnings"] = Array((workerWarnings + graphLocalWarnings).prefix(40))
            if !teamsGraph.isRunning, ["complete", "partial"].contains(graphProgress["status"] as? String ?? "") {
                event["status"] = "partial"; event["coverage"] = "partial"
                event["message"] = "已完成可访问分页，但部分内容超出本地缓存容量；请在 Teams 查看完整历史。"
            }
        }
        if graphProgress["status"] as? String == "complete", !pendingGraphBatches.isEmpty {
            event["coverage"] = "partial"; event["historyComplete"] = false
            event["message"] = "已读取可访问内容，正在保存最后的数据…"
        }
        event["type"] = "graphStatus"
        event["busy"] = graphSigningIn || teamsGraph.isRunning
        emit(event)
        if teamsMode == "graph" {
            status("teams", event["message"] as? String ?? "请登录 Microsoft Teams", event["busy"] as? Bool ?? false)
        }
    }
    func currentGraphIdentity() -> [String: String]? {
        guard let accountID = graphAuth.accountID else { return nil }
        let configuration = graphAuth.status()
        guard let clientID = configuration["clientId"] as? String, !clientID.isEmpty,
              let tenant = configuration["tenant"] as? String else { return nil }
        return ["accountID": accountID, "clientId": clientID.lowercased(), "tenant": tenant.lowercased()]
    }
    func readGraphIdentity() -> [String: String]? {
        guard let size = try? graphIdentityURL.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size <= 16_384, let data = try? Data(contentsOf: graphIdentityURL), data.count <= 16_384,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return nil }
        return value
    }
    func writeGraphIdentity(_ identity: [String: String]) {
        guard canSaveState, let data = try? JSONSerialization.data(withJSONObject: identity) else { return }
        do {
            try data.write(to: graphIdentityURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: graphIdentityURL.path)
        } catch { status("app", "Teams 账号标识无法保存，下次登录将重新同步", false) }
    }
    func clearGraphIdentity() {
        try? FileManager.default.removeItem(at: graphIdentityURL)
        removeGraphCheckpoint()
    }
    func removeGraphCheckpoint() {
        pendingGraphCheckpoint = nil
        try? FileManager.default.removeItem(at: graphCheckpointURL)
    }
    func readGraphCheckpoint() -> [String: Any]? {
        guard let identity = currentGraphIdentity(), readGraphIdentity() == identity,
              let size = try? graphCheckpointURL.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size <= 26_214_400, let data = try? Data(contentsOf: graphCheckpointURL), data.count <= 26_214_400,
              let wrapper = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              wrapper["identity"] as? [String: String] == identity,
              wrapper["includeChats"] as? Bool == graphIncludeChats else { return nil }
        let checkpoint = wrapper["checkpoint"] as? [String: Any]
        if let jobs = checkpoint?["jobs"] as? [Any], !jobs.isEmpty {
            graphLocalPartial = wrapper["localPartial"] as? Bool ?? false
            graphLocalWarnings = Array((wrapper["localWarnings"] as? [String] ?? []).prefix(20)).map { String($0.prefix(1000)) }
        }
        return checkpoint
    }
    func persistGraphCheckpointIfReady() {
        guard canSaveState, stateDurable, pendingGraphBatches.isEmpty,
              let checkpoint = pendingGraphCheckpoint, let identity = currentGraphIdentity(),
              readGraphIdentity() == identity else { return }
        let wrapper: [String: Any] = ["identity": identity, "includeChats": graphIncludeChats, "checkpoint": checkpoint,
                                      "localPartial": graphLocalPartial, "localWarnings": graphLocalWarnings]
        guard let data = try? JSONSerialization.data(withJSONObject: wrapper), data.count <= 26_214_400 else {
            removeGraphCheckpoint(); status("teams", "同步进度过大，本轮数据已保留，下次从头检查历史", false); return
        }
        do {
            try data.write(to: graphCheckpointURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: graphCheckpointURL.path)
            pendingGraphCheckpoint = nil
        } catch { status("app", "Teams 同步进度未能保存，下次会重新检查历史", false) }
    }
    func cancelGraphSync() {
        graphGeneration = UUID(); teamsGraph.cancel()
        pendingGraphBatches.removeAll(); pendingGraphCheckpoint = nil
    }
    func resetTeamsData() {
        graphLocalPartial = false; graphLocalWarnings = []
        notifications.sync(items: [], enabled: false)
        removeGraphCheckpoint()
        guard state["version"] as? Int == 1 else { emit(["type": "graphReset"]); return }
        var snapshots = state["snapshots"] as? [String: Any] ?? [:]
        snapshots["teams"] = [String: Any]()
        state["snapshots"] = snapshots
        for key in ["taskChecks", "feedbackRead"] {
            if let values = state[key] as? [String: Any] { state[key] = values.filter { !$0.key.hasPrefix("teams:") } }
        }
        if var settings = state["settings"] as? [String: Any] {
            settings["teamsDueOverrides"] = [String: Any](); state["settings"] = settings
        }
        stateDurable = persistState(); graphSaveFailed = !stateDurable
        emit(["type": "graphReset"])
    }
    func signInGraph() {
        guard teamsMode == "graph", !graphSigningIn else { return }
        cancelGraphSync(); graphProgress = [:]; graphSigningIn = true; emitGraphStatus()
        let expected = graphGeneration
        graphAuth.signIn { [weak self] result in
            guard let self = self, self.graphGeneration == expected, self.teamsMode == "graph" else { return }
            self.graphSigningIn = false
            switch result {
            case .success:
                guard let identity = self.currentGraphIdentity() else { self.emitGraphStatus(); return }
                if self.readGraphIdentity() != identity { self.resetTeamsData() }
                self.writeGraphIdentity(identity)
                self.graphProgress = [:]; self.emitGraphStatus(); self.syncGraph()
            case .failure(let error):
                self.graphProgress = ["message": error.localizedDescription]; self.emitGraphStatus()
            }
        }
    }
    func signOutGraph() {
        cancelGraphSync(); graphSigningIn = false
        graphAuth.signOut(); graphProgress = [:]
        clearGraphIdentity(); resetTeamsData(); emitGraphStatus()
    }
    func syncGraph() {
        guard teamsMode == "graph", !graphSigningIn, !teamsGraph.isRunning else { return }
        if graphSaveFailed {
            stateDurable = persistState(); graphSaveFailed = !stateDurable
            guard !graphSaveFailed else { emitGraphStatus(); return }
        }
        guard graphAuth.status()["connected"] as? Bool == true, let identity = currentGraphIdentity() else {
            emitGraphStatus(); return
        }
        if readGraphIdentity() != identity { resetTeamsData(); writeGraphIdentity(identity) }
        let expected = graphGeneration
        teamsGraph.onBatch = { [weak self] batch in
            guard let self = self, self.graphGeneration == expected, self.teamsMode == "graph",
                  self.currentGraphIdentity() == identity else { return }
            let batchID = UUID().uuidString
            self.pendingGraphBatches.insert(batchID); self.stateDurable = false
            self.emit(["type": "graphBatch", "batch": batch, "batchId": batchID])
        }
        teamsGraph.onStatus = { [weak self] progress in
            guard let self = self, self.graphGeneration == expected, self.teamsMode == "graph",
                  self.currentGraphIdentity() == identity else { return }
            var mapped = progress
            var counts: [String: Any] = [:]
            for key in ["teams", "channels", "chats", "messages", "assignments", "pages"] {
                if let value = progress[key] { counts[key] = value }
            }
            mapped["counts"] = counts
            mapped["coverage"] = progress["status"] as? String ?? "unknown"
            let currentStatus = progress["status"] as? String ?? ""
            mapped["partial"] = ["partial", "paused", "authRequired", "accountChanged"].contains(currentStatus)
            mapped["historyComplete"] = progress["complete"] as? Bool ?? false
            if ["complete", "partial"].contains(currentStatus) { mapped["lastSync"] = progress["updatedAt"] }
            if currentStatus == "accountChanged" {
                self.graphProgress = mapped
                self.cancelGraphSync(); self.graphAuth.signOut(); self.clearGraphIdentity(); self.resetTeamsData()
                self.emitGraphStatus(); return
            }
            self.graphProgress = mapped; self.emitGraphStatus()
        }
        teamsGraph.onCheckpoint = { [weak self] checkpoint in
            guard let self = self, self.graphGeneration == expected, self.teamsMode == "graph",
                  self.currentGraphIdentity() == identity else { return }
            self.pendingGraphCheckpoint = checkpoint
            self.persistGraphCheckpointIfReady()
        }
        graphLocalPartial = false; graphLocalWarnings = []
        let checkpoint = readGraphCheckpoint()
        teamsGraph.sync(checkpoint: checkpoint, includeChats: graphIncludeChats)
        emitGraphStatus()
    }
    @discardableResult func persistState() -> Bool {
        guard canSaveState else { status("app", "本次无法保存到磁盘，请导出备份并检查数据目录权限", false); return false }
        guard let encoded = json(state), encoded.utf8.count <= 26_214_400 else {
            status("app", "数据超过 25 MiB，未覆盖磁盘备份；请导出当前数据", false); return false
        }
        do {
            if FileManager.default.fileExists(atPath: stateURL.path), (try? readSavedState(stateURL)) != nil {
                let backup = dataFolder.appendingPathComponent("state.previous.json")
                try Data(contentsOf: stateURL).write(to: backup, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
            }
            try Data(encoded.utf8).write(to: stateURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
            return true
        } catch { status("app", "保存失败：" + error.localizedDescription, false); return false }
    }
    func configureTimer() {
        let value = (state["settings"] as? [String: Any])?["refreshMinutes"] as? Int ?? 15
        let clamped = max(5, min(120, value))
        if refreshTimer != nil && clamped == refreshMinutes { return }
        refreshMinutes = clamped; refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(clamped * 60), repeats: true) { [weak self] _ in self?.sync() }
    }
    func configureCountdown(_ body: [String: Any]) {
        countdownTimer?.invalidate(); countdownTimer = nil; countdownEndsAt = nil
        if body["clear"] as? Bool == true { statusItem.button?.title = normalMenuTitle; return }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let raw = body["endsAt"] as? String else { statusItem.button?.title = normalMenuTitle; return }
        let precise = formatter.date(from: raw)
        formatter.formatOptions = [.withInternetDateTime]
        guard let end = precise ?? formatter.date(from: raw), end.timeIntervalSinceNow <= 86_400 else { statusItem.button?.title = normalMenuTitle; return }
        countdownEndsAt = end
        countdownLabel = body["label"] as? String == "午休剩余" ? "午休剩余" : "课间剩余"
        let next = String((body["nextTitle"] as? String ?? "").prefix(20))
        countdownNextTitle = next.isEmpty ? "上课中" : next + " 上课中"
        updateCountdown()
        guard countdownEndsAt != nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.updateCountdown() }
        countdownTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }
    func updateCountdown() {
        guard let end = countdownEndsAt else { return }
        let remaining = Int(ceil(end.timeIntervalSinceNow))
        if remaining <= 0 {
            countdownTimer?.invalidate(); countdownTimer = nil; countdownEndsAt = nil
            normalMenuTitle = countdownNextTitle; statusItem.button?.title = countdownNextTitle
            return
        }
        statusItem.button?.title = "◷ " + countdownLabel + " " + String(format: "%02d:%02d", remaining / 60, remaining % 60)
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
                guard size <= 26_214_400 else { self.status("app", "导入文件不能超过 25 MiB", false); return }
                let candidate = try readSavedState(url)
                self.emit(["type": "import", "state": candidate])
            } catch { self.status("app", "导入失败：" + error.localizedDescription, false) }
        }
    }
    func clearSession(_ source: String) {
        guard let hosts = sourceHosts[source] else { status(source, CampusSchoolConfiguration.help, false); return }
        if source == "teams" {
            if teamsMode == "graph" { signOutGraph(); return }
            stopTeamsAuto(message: "正在退出 Teams，自动读取已停止")
            teamsBrowserBridge.cancel()
            let alert = NSAlert(); alert.messageText = "在浏览器中退出 Teams"
            alert.informativeText = "Teams 登录保存在你选择的 Chrome 或 Edge 中。请打开浏览器，在 Teams 头像菜单退出账号；CampusDesk 不会清除浏览器中的其他登录和数据。"
            alert.addButton(withTitle: "打开 Teams"); alert.addButton(withTitle: "取消")
            alert.beginSheetModal(for: window) { [weak self] response in if response == .alertFirstButtonReturn { self?.openTeams() } }
            return
        }
        let alert = NSAlert()
        alert.messageText = "退出此学校系统？"
        alert.informativeText = "将清除此应用中的登录状态，下次需重新登录。已缓存的课表、任务和成绩仍会保留。"
        alert.addButton(withTitle: "退出登录"); alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            self?.workers[source]?.cancel()
            self?.browsers[source]?.web.stopLoading()
            self?.browsers[source]?.window.close(); self?.browsers[source] = nil
            let store = WKWebsiteDataStore.default()
            store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
                let domain = source == "managebac" ? (hosts.first?.hasSuffix(".com") == true ? "managebac.com" : "managebac.cn") : "seiue.com"
                let selected = records.filter { record in
                    let name = record.displayName.lowercased()
                    return hosts.contains(name) || name == domain || name.hasSuffix("." + domain)
                }
                store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: selected) {
                    self?.status(source, "已退出，请重新登录", false)
                }
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
