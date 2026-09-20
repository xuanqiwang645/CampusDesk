import Cocoa
import Darwin

/// One cancellable JXA invocation. Browser credentials never cross this bridge.
/// Snapshots are delivered as they arrive so an interrupted crawl retains its work.
final class TeamsAutoBridge {
    private final class Stream {
        let maximumLine = TeamsAutoEventDecoder.maximumLine
        let maximumTotal = 128 * 1024 * 1024
        var failure: String?
        func read(_ handle: FileHandle, receive: @escaping ([String: Any]) -> Void) {
            defer { try? handle.close() }
            var pending = Data()
            var total = 0
            func consume(_ line: Data) -> Bool {
                if line.isEmpty { return true }
                guard let value = TeamsAutoEventDecoder.decode(line) else {
                    failure = "invalid_output"; return false
                }
                receive(value)
                return true
            }
            var buffer = [UInt8](repeating: 0, count: 65_536)
            do {
                while true {
                    // Foundation read(upToCount:) can wait to fill a pipe read.
                    // POSIX read returns the currently available bytes so short
                    // progress/checkpoint events reach the UI immediately.
                    let length = buffer.withUnsafeMutableBytes { Darwin.read(handle.fileDescriptor, $0.baseAddress, $0.count) }
                    if length < 0 { if errno == EINTR { continue }; failure = "read_failed"; return }
                    if length == 0 { break }
                    let chunk = Data(buffer.prefix(length))
                    total += chunk.count
                    guard total <= maximumTotal else { failure = "output_limit"; return }
                    pending.append(chunk)
                    while let newline = pending.firstIndex(of: 10) {
                        let line = Data(pending[..<newline])
                        pending.removeSubrange(...newline)
                        guard consume(line) else { return }
                    }
                    guard pending.count <= maximumLine else { failure = "output_limit"; return }
                }
                if !pending.isEmpty { _ = consume(pending) }
            }
        }
    }
    private final class Invocation {
        let process = Process()
        let output = Pipe()
        let errors = Pipe()
        let stream = Stream()
        var errorData = Data() // Written by one stderr reader, read after its group finishes.
        var lastEvent = Date() // Remaining properties are confined to the main queue.
        var receivedDone = false
        var receivedError = false
        var timeoutCode: String?
        var watchdog: Timer?
    }
    private let resources: URL
    private var active: Invocation?
    private var generation = UUID()
    var isRunning: Bool { active != nil }
    init(resources: URL) { self.resources = resources }

    private func stop(_ invocation: Invocation) {
        invocation.watchdog?.invalidate(); invocation.watchdog = nil
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
    func run(browser: String, operation: String = "sync", checkpointPath: String? = nil,
             includeChats: Bool = true, maximumSeconds: Int = 1200, focus: String = "all", attachmentCache: [[String: String]] = [],
             onEvent: @escaping ([String: Any]) -> Void,
             completion: @escaping ([String: Any]?) -> Void) {
        func failure(_ code: String, _ message: String) {
            completion(["type": "error", "code": code, "message": message])
        }
        guard active == nil else { failure("busy", "Teams 正在自动读取，请等待本轮完成"); return }
        guard ["chrome", "edge"].contains(browser), ["sync", "login"].contains(operation) else {
            failure("invalid_request", "Teams 浏览器设置无效"); return
        }
        let name = TeamsBrowserBridge.displayName(browser)
        guard TeamsBrowserBridge.installedURL(browser) != nil else {
            failure("browser_missing", "尚未安装 \(name)，请在连接设置选择已安装的浏览器"); return
        }
        let script = resources.appendingPathComponent("teams-auto-runner.js")
        guard FileManager.default.fileExists(atPath: script.path),
              FileManager.default.fileExists(atPath: resources.appendingPathComponent("teams-auto.js").path) else {
            failure("resources_missing", "缺少 Teams 自动读取组件，请重新安装应用"); return
        }
        let duration = max(30, min(1200, maximumSeconds))
        var config: [String: Any] = ["browser": browser, "operation": operation, "resources": resources.path,
                                     "includeChats": includeChats, "maxSeconds": duration, "focus": focus == "ec" ? "ec" : "all"]
        if let checkpointPath = checkpointPath { config["checkpointPath"] = checkpointPath }
        config["attachmentCache"] = Array(attachmentCache.prefix(300))
        guard let argument = json(config) else { failure("invalid_request", "无法准备 Teams 读取配置"); return }
        let invocation = Invocation()
        invocation.process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        invocation.process.arguments = ["-l", "JavaScript", script.path, argument]
        invocation.process.standardOutput = invocation.output
        invocation.process.standardError = invocation.errors
        active = invocation; generation = UUID()
        let expected = generation
        do { try invocation.process.run() }
        catch { active = nil; failure("launch_failed", "无法启动 Teams 自动读取，请重新打开应用后重试"); return }
        let readers = DispatchGroup()
        readers.enter()
        DispatchQueue.global(qos: .utility).async { [weak self] in
            invocation.stream.read(invocation.output.fileHandleForReading) { event in
                DispatchQueue.main.async {
                    guard let self = self, self.generation == expected, self.active === invocation else { return }
                    invocation.lastEvent = Date()
                    if event["type"] as? String == "done" { invocation.receivedDone = true }
                    if event["type"] as? String == "error" { invocation.receivedError = true }
                    onEvent(event)
                }
            }
            if invocation.stream.failure != nil {
                DispatchQueue.main.async {
                    guard let self = self, self.generation == expected, self.active === invocation else { return }
                    self.stop(invocation)
                }
            }
            readers.leave()
        }
        readers.enter()
        DispatchQueue.global(qos: .utility).async {
            let handle = invocation.errors.fileHandleForReading
            defer { try? handle.close(); readers.leave() }
            while let part = try? handle.read(upToCount: 4096), !part.isEmpty {
                if invocation.errorData.count < 65_536 {
                    invocation.errorData.append(part.prefix(65_536 - invocation.errorData.count))
                }
            }
        }
        let began = Date()
        invocation.watchdog = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            guard let self = self, self.generation == expected, self.active === invocation else { return }
            if Date().timeIntervalSince(began) > Double(duration + 20) {
                invocation.timeoutCode = "time_limit"; self.stop(invocation)
            } else if Date().timeIntervalSince(invocation.lastEvent) > 120 {
                invocation.timeoutCode = "stalled"; self.stop(invocation)
            }
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            invocation.process.waitUntilExit()
            // Both readers drain before completion; queued events preserve their order.
            readers.wait()
            DispatchQueue.main.async {
                guard let self = self, self.generation == expected, self.active === invocation else { return }
                invocation.watchdog?.invalidate(); invocation.watchdog = nil
                self.active = nil
                if let code = invocation.timeoutCode {
                    failure(code, code == "stalled" ? "Teams 页面两分钟未响应，已保存已读取内容；下轮将重试" : "本轮达到读取时间上限，已保存已读取内容；下轮将继续检查")
                } else if invocation.stream.failure != nil {
                    failure("invalid_output", "Teams 读取结果不完整或超过单批限制，已保留成功读取的内容")
                } else if invocation.receivedDone || invocation.receivedError {
                    completion(nil)
                } else {
                    // Raw osascript stderr may contain private page content or URLs.
                    let stderr = String(data: invocation.errorData, encoding: .utf8) ?? ""
                    if stderr.contains("-1743") {
                        failure("automation_denied", "请在系统设置 → 隐私与安全性 → 自动化中，允许 CampusDesk 控制 \(name)")
                    } else {
                        failure("bridge_failed", "Teams 自动读取未正常完成，请检查浏览器自动化授权和「允许来自 Apple 事件的 JavaScript」设置")
                    }
                }
            }
        }
    }
}
