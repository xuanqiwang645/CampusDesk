import Cocoa
import Darwin

/// Reads approved, already-open Teams tabs in a real Chrome/Edge browser.
/// Apple Events permission and the browser's JavaScript permission stay user-controlled.
final class TeamsBrowserBridge {
    private final class CapturedPipe {
        private let lock = NSLock()
        private var contents = Data()
        private var tooLarge = false
        let limit: Int
        init(limit: Int) { self.limit = limit }
        func read(_ handle: FileHandle, process: Process) {
            defer { try? handle.close() }
            while true {
                guard let part = try? handle.read(upToCount: 65_536), !part.isEmpty else { return }
                lock.lock()
                if contents.count + part.count > limit {
                    tooLarge = true
                    lock.unlock()
                    if process.isRunning { process.terminate() }
                    return
                }
                contents.append(part)
                lock.unlock()
            }
        }
        func snapshot() -> (Data, Bool) {
            lock.lock(); defer { lock.unlock() }
            return (contents, tooLarge)
        }
    }
    private final class Invocation {
        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        let capturedOutput = CapturedPipe(limit: 20_000_000)
        let capturedErrors = CapturedPipe(limit: 64_000)
        var timedOut = false // Accessed only on the main queue.
    }
    private let resources: URL
    private var active: Invocation?
    private var generation = UUID()
    var isRunning: Bool { active != nil }
    init(resources: URL) { self.resources = resources }

    static func bundleID(_ browser: String) -> String {
        browser == "edge" ? "com.microsoft.edgemac" : "com.google.Chrome"
    }
    static func displayName(_ browser: String) -> String { browser == "edge" ? "Microsoft Edge" : "Google Chrome" }
    static func installedURL(_ browser: String) -> URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID(browser))
    }
    private func stop(_ invocation: Invocation) {
        guard invocation.process.isRunning else { return }
        invocation.process.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if invocation.process.isRunning { Darwin.kill(invocation.process.processIdentifier, SIGKILL) }
        }
    }
    func cancel() {
        generation = UUID()
        if let invocation = active { stop(invocation) }
        active = nil
    }
    func run(operation: String, browser: String, pages: [[String: Any]], selectionOnly: Bool = false,
             completion: @escaping ([String: Any]) -> Void) {
        func failure(_ code: String, _ message: String) { completion(["ok": false, "code": code, "message": message]) }
        guard active == nil else { failure("busy", "正在读取 Teams，请等待本轮完成"); return }
        guard ["pin", "capture", "sync"].contains(operation), ["chrome", "edge"].contains(browser) else { failure("invalid_request", "Teams 浏览器设置无效"); return }
        let name = Self.displayName(browser)
        guard Self.installedURL(browser) != nil else { failure("browser_missing", "尚未安装 \(name)，请安装后重试或在设置中切换浏览器"); return }
        guard !NSRunningApplication.runningApplications(withBundleIdentifier: Self.bundleID(browser)).isEmpty else {
            failure("browser_not_running", "请先打开 \(name)，登录 Teams 并保留所需频道标签页"); return
        }
        let bridgeURL = resources.appendingPathComponent("teams-browser.js")
        guard FileManager.default.fileExists(atPath: bridgeURL.path),
              let extractor = try? String(contentsOf: resources.appendingPathComponent("teams.js"), encoding: .utf8), !extractor.isEmpty else {
            failure("resources_missing", "缺少 Teams 读取组件，请重新安装应用"); return
        }
        let request: [String: Any] = ["operation": operation, "browser": browser, "pages": validatedTeamsPages(pages), "extractor": extractor, "selectionOnly": selectionOnly]
        guard let argument = json(request), argument.utf8.count <= 200_000 else { failure("request_too_large", "关注页面信息过多，请减少页面数量后重试"); return }
        let invocation = Invocation()
        invocation.process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        // Process arguments are passed directly. Page text never becomes shell code.
        invocation.process.arguments = ["-l", "JavaScript", bridgeURL.path, argument]
        invocation.process.standardOutput = invocation.output
        invocation.process.standardError = invocation.errors
        active = invocation; generation = UUID()
        let expected = generation
        do { try invocation.process.run() }
        catch { active = nil; failure("launch_failed", "无法启动 Teams 浏览器读取，请重新打开应用后重试"); return }
        let readers = DispatchGroup()
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            invocation.capturedOutput.read(invocation.output.fileHandleForReading, process: invocation.process)
            readers.leave()
        }
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            invocation.capturedErrors.read(invocation.errors.fileHandleForReading, process: invocation.process)
            readers.leave()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + (operation == "sync" ? 120 : 45)) { [weak self] in
            guard let self = self, self.generation == expected, self.active === invocation else { return }
            invocation.timedOut = true; self.stop(invocation)
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            invocation.process.waitUntilExit()
            let readStatus = readers.wait(timeout: .now() + 2)
            let output = invocation.capturedOutput.snapshot()
            let errors = invocation.capturedErrors.snapshot()
            DispatchQueue.main.async {
                guard let self = self, self.generation == expected, self.active === invocation else { return }
                self.active = nil
                if invocation.timedOut { failure("timeout", "读取 Teams 超时，缓存保留；请检查浏览器和系统自动化授权弹窗后重试"); return }
                guard readStatus == .success, !output.1, !errors.1 else { failure("output_too_large", "当前页面内容过多或读取未完成，缓存保留；请选择较少文本后重试"); return }
                if let result = try? JSONSerialization.jsonObject(with: output.0) as? [String: Any], result["ok"] is Bool {
                    completion(result); return
                }
                // Do not display raw AppleScript errors: they may include page URLs.
                let errorText = String(data: errors.0, encoding: .utf8) ?? ""
                if errorText.contains("-1743") {
                    failure("automation_denied", "请在系统设置 → 隐私与安全性 → 自动化中，允许 CampusDesk 控制 \(name)")
                } else { failure("bridge_failed", "无法读取 Teams，请检查浏览器的「允许来自 Apple 事件的 JavaScript」设置后重试；缓存保留") }
            }
        }
    }
}
