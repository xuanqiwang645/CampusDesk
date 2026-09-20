import Foundation

/// Delegated, read-only Graph synchronization. All state and callbacks live on the main queue.
/// Tokens stay in the token provider; checkpoints contain only Graph cursors and partial data.
final class TeamsGraph: NSObject, URLSessionTaskDelegate {
    typealias TokenProvider = (Bool, @escaping (Result<String, Error>) -> Void) -> Void
    var onBatch: (([String: Any]) -> Void)?
    var onStatus: (([String: Any]) -> Void)?
    var onCheckpoint: (([String: Any]) -> Void)?
    private(set) var isRunning = false

    private struct Job {
        let url: String
        let kind: String
        var context: [String: Any]
        var dictionary: [String: Any] { ["url": url, "kind": kind, "context": context] }
        init(_ url: String, _ kind: String, _ context: [String: Any] = [:]) {
            self.url = url; self.kind = kind; self.context = context
        }
        init?(_ value: [String: Any]) {
            guard let url = value["url"] as? String, TeamsGraph.validGraphURL(url) != nil,
                  let kind = value["kind"] as? String, TeamsGraph.jobKinds.contains(kind) else { return nil }
            self.init(url, kind, value["context"] as? [String: Any] ?? [:])
        }
    }
    private static let jobKinds: Set<String> = ["profile", "teams", "associatedTeams", "channels", "channelMessages", "channelReplies", "chats", "chatMessages", "assignmentList", "assignmentDetail", "assignmentResources", "assignmentSubmissions", "assignmentOutcomes"]
    private let tokenProvider: TokenProvider
    private let origin = "https://graph.microsoft.com/v1.0"
    private var jobs: [Job] = []
    private var visited = Set<String>()
    private var discoveredTeams: [String: [String: Any]] = [:]
    private var discoveredChannels = Set<String>()
    private var discoveredChats = Set<String>()
    private var userID = ""
    private var generation = UUID()
    private var task: URLSessionDataTask?
    private var pages = 0
    private var messages = 0
    private var assignments = 0
    private var errors = 0
    private var warnings: [String] = []
    private var includeChats = true
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 45
        configuration.timeoutIntervalForResource = 60
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    init(tokenProvider: @escaping TokenProvider) { self.tokenProvider = tokenProvider; super.init() }

    /// A nextLink is untrusted input. Never attach a bearer token to another host, cloud,
    /// API version, credential-bearing URL, or redirect. National clouds need explicit support.
    static func validGraphURL(_ value: String) -> URL? {
        guard value.utf8.count <= 65_536, let parts = URLComponents(string: value),
              parts.scheme?.lowercased() == "https", parts.host?.lowercased() == "graph.microsoft.com",
              parts.port == nil || parts.port == 443, parts.user == nil, parts.password == nil,
              parts.fragment == nil, parts.path.hasPrefix("/v1.0/"),
              !parts.path.split(separator: "/").contains(".."),
              !parts.path.contains("\\"), let url = parts.url else { return nil }
        let prohibited = Set(["access_token", "refresh_token", "id_token", "client_secret", "authorization"])
        guard !(parts.queryItems ?? []).contains(where: { prohibited.contains($0.name.lowercased()) }) else { return nil }
        return url
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func sync(checkpoint: [String: Any]? = nil, includeChats: Bool = true) {
        precondition(Thread.isMainThread)
        guard !isRunning else { return }
        generation = UUID(); isRunning = true; self.includeChats = includeChats
        jobs = []; visited = []; discoveredTeams = [:]; discoveredChannels = []; discoveredChats = []
        pages = 0; messages = 0; assignments = 0; errors = 0; warnings = []; userID = ""
        if let saved = checkpoint, saved["version"] as? Int == 1,
           let rawJobs = saved["jobs"] as? [[String: Any]], !rawJobs.isEmpty {
            let restored = rawJobs.compactMap(Job.init)
            if restored.count == rawJobs.count {
                jobs = restored.filter { includeChats || !["chats", "chatMessages"].contains($0.kind) }
                userID = saved["userId"] as? String ?? ""
                discoveredTeams = saved["teams"] as? [String: [String: Any]] ?? [:]
                discoveredChannels = Set(saved["channels"] as? [String] ?? [])
                discoveredChats = Set(saved["chats"] as? [String] ?? [])
                pages = max(0, saved["pages"] as? Int ?? 0)
                messages = max(0, saved["messages"] as? Int ?? 0)
                assignments = max(0, saved["assignments"] as? Int ?? 0)
                errors = max(0, saved["errors"] as? Int ?? 0)
                warnings = Array((saved["warnings"] as? [String] ?? []).prefix(40))
            }
        }
        if jobs.isEmpty || userID.isEmpty {
            jobs = [Job(origin + "/me?$select=id,displayName", "profile"),
                    Job(origin + "/me/joinedTeams", "teams"),
                    Job(origin + "/me/teamwork/associatedTeams", "associatedTeams"),
                    Job(origin + "/education/me/assignments?$top=50", "assignmentList")]
            if includeChats { jobs.append(Job(origin + "/me/chats?$top=50", "chats")) }
        } else {
            // Revalidate identity before resuming; integration also binds the file to the OAuth account.
            jobs.insert(Job(origin + "/me?$select=id,displayName", "profile", ["expectedUserId": userID]), at: 0)
        }
        publish("syncing", "正在自动发现 Teams 团队、频道和作业")
        checkpointNow(); next()
    }

    func cancel() {
        precondition(Thread.isMainThread)
        generation = UUID(); task?.cancel(); task = nil
        guard isRunning else { return }
        isRunning = false; checkpointNow(); publish("paused", "同步已暂停；下次从保存的位置继续")
    }

    private func next() {
        guard isRunning else { return }
        guard let job = jobs.first else {
            isRunning = false; checkpointNow()
            publish(errors == 0 ? "complete" : "partial", errors == 0 ? "已读取 Graph 返回的全部可访问分页；附件内容请打开原件" : "同步完成，部分内容因权限或接口错误未能读取")
            return
        }
        request(job, forceRefresh: false, retry: 0, generation: generation)
    }

    private func request(_ job: Job, forceRefresh: Bool, retry: Int, generation expected: UUID) {
        guard isRunning, generation == expected, let url = Self.validGraphURL(job.url) else { return }
        tokenProvider(forceRefresh) { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self, self.isRunning, self.generation == expected else { return }
                switch result {
                case .failure:
                    self.isRunning = false; self.checkpointNow()
                    self.publish("authRequired", "Microsoft 登录已失效或未完成授权，请重新连接；已读取的数据保留")
                case .success(let token):
                    guard !token.isEmpty, !token.contains("\r"), !token.contains("\n") else {
                        self.isRunning = false; self.checkpointNow(); self.publish("authRequired", "Microsoft 未返回有效的登录凭据"); return
                    }
                    var request = URLRequest(url: url)
                    request.httpMethod = "GET"
                    request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
                    request.setValue("application/json", forHTTPHeaderField: "Accept")
                    self.task = self.session.dataTask(with: request) { [weak self] data, response, error in
                        DispatchQueue.main.async {
                            guard let self = self, self.isRunning, self.generation == expected else { return }
                            self.task = nil
                            let http = response as? HTTPURLResponse
                            if http?.statusCode == 401, !forceRefresh {
                                self.request(job, forceRefresh: true, retry: retry, generation: expected); return
                            }
                            if http?.statusCode == 401 {
                                self.isRunning = false; self.checkpointNow(); self.publish("authRequired", "Microsoft 拒绝了登录凭据，请重新连接"); return
                            }
                            if error != nil || [429, 500, 502, 503, 504].contains(http?.statusCode ?? 0) {
                                if retry < 3 {
                                    let delay = Self.retryDelay(http, attempt: retry)
                                    if delay <= 300 {
                                        self.publish("waiting", http?.statusCode == 429 ? "Microsoft 限流，等待后自动继续" : "网络暂时不可用，稍后自动重试")
                                        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                                            guard let self = self, self.isRunning, self.generation == expected else { return }
                                            self.request(job, forceRefresh: forceRefresh, retry: retry + 1, generation: expected)
                                        }
                                        return
                                    }
                                }
                                // Preserve this exact cursor, rather than discard pages on a network outage.
                                self.isRunning = false; self.checkpointNow()
                                self.publish("paused", "网络或限流暂未恢复；已保存分页位置，下次同步会继续")
                                return
                            }
                            guard let http = http, http.statusCode == 200, let data = data, data.count <= 16_000_000,
                                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                                let status = http?.statusCode ?? 0
                                self.failed(job, reason: status == 403 ? "学校尚未允许读取此类内容（403）" : "接口未能返回有效数据（\(status)）")
                                return
                            }
                            self.consume(job, object: object)
                        }
                    }
                    self.task?.resume()
                }
            }
        }
    }

    static func retryDelay(_ response: HTTPURLResponse?, attempt: Int, now: Date = Date()) -> TimeInterval {
        if let raw = response?.value(forHTTPHeaderField: "Retry-After") {
            if let seconds = Double(raw), seconds.isFinite { return max(1, seconds) }
            let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
            if let date = formatter.date(from: raw) { return max(1, date.timeIntervalSince(now)) }
        }
        return min(30, pow(2, Double(max(0, attempt))) * 2)
    }

    private func consume(_ job: Job, object: [String: Any]) {
        // Collection routes must return an explicit value array. A malformed body must not look empty.
        let single = ["profile", "assignmentDetail"].contains(job.kind)
        guard single || object["value"] is [[String: Any]] else { failed(job, reason: "接口未返回可识别的列表"); return }
        let values = object["value"] as? [[String: Any]] ?? []
        var context = job.context
        switch job.kind {
        case "profile":
            guard let id = object["id"] as? String, !id.isEmpty else { failed(job, reason: "无法确认当前 Microsoft 账号"); return }
            if let expected = context["expectedUserId"] as? String, expected != id {
                isRunning = false; jobs = []; checkpointNow(); publish("accountChanged", "Microsoft 账号已变更，请重新同步以避免混合账号数据"); return
            }
            userID = id
        case "teams", "associatedTeams":
            for team in values {
                guard let id = team["id"] as? String, !id.isEmpty else { continue }
                if discoveredTeams[id] == nil {
                    discoveredTeams[id] = team
                    enqueue(origin + "/teams/" + segment(id) + "/allChannels?$select=id,displayName,webUrl,membershipType,tenantId", "channels", ["team": team])
                }
            }
            paginate(job, object: object)
        case "channels":
            for channel in values {
                guard let id = channel["id"] as? String, !id.isEmpty,
                      let team = context["team"] as? [String: Any], let teamID = team["id"] as? String else { continue }
                guard let base = channelBase(channel, teamID: teamID) else {
                    recordWarning("共享频道的 Graph 地址无效，未向该地址发送凭据"); continue
                }
                guard discoveredChannels.insert(base).inserted else { continue }
                enqueue(base + "/messages?$top=50", "channelMessages", ["team": team, "channel": channel, "channelBase": base])
            }
            paginate(job, object: object)
        case "channelMessages", "channelReplies":
            var rows = values
            if job.kind == "channelReplies", let parent = context["rootMessageId"] as? String {
                rows = values.map { value in var row = value; row["replyToId"] = parent; return row }
            }
            emitMessages(rows, context: context, kind: "channelMessages")
            if job.kind == "channelMessages", let base = context["channelBase"] as? String {
                for row in rows where row["deletedDateTime"] == nil || row["deletedDateTime"] is NSNull {
                    guard let id = row["id"] as? String, !id.isEmpty else { continue }
                    var replyContext = context; replyContext["rootMessageId"] = id
                    enqueue(base + "/messages/" + segment(id) + "/replies?$top=50", "channelReplies", replyContext)
                }
            }
            paginate(job, object: object)
        case "chats":
            for chat in values {
                guard let id = chat["id"] as? String, !id.isEmpty, discoveredChats.insert(id).inserted else { continue }
                enqueue(origin + "/me/chats/" + segment(id) + "/messages?$top=50", "chatMessages", ["chat": chat])
            }
            paginate(job, object: object)
        case "chatMessages":
            emitMessages(values, context: context, kind: "chatMessages"); paginate(job, object: object)
        case "assignmentList":
            for assignment in values {
                guard let id = assignment["id"] as? String, let classID = assignment["classId"] as? String,
                      !id.isEmpty, !classID.isEmpty else { continue }
                let base = origin + "/education/classes/" + segment(classID) + "/assignments/" + segment(id)
                enqueue(base, "assignmentDetail", ["assignment": assignment, "assignmentBase": base, "providedFields": [String](), "warnings": [String]()])
            }
            paginate(job, object: object)
        case "assignmentDetail":
            var assignment = context["assignment"] as? [String: Any] ?? [:]
            for (key, value) in object { assignment[key] = value }
            context["assignment"] = assignment; context["providedFields"] = ["instructions"]
            if let base = context["assignmentBase"] as? String { enqueue(base + "/resources?$top=50", "assignmentResources", context) }
        case "assignmentResources":
            var assignment = context["assignment"] as? [String: Any] ?? [:]
            assignment["resources"] = (assignment["resources"] as? [[String: Any]] ?? []) + values
            context["assignment"] = assignment
            if !paginate(Job(job.url, job.kind, context), object: object) {
                if object["@odata.nextLink"] == nil { addProvided("resources", context: &context) }
                else { context["warnings"] = (context["warnings"] as? [String] ?? []) + ["作业附件分页未完整读取"] }
                startSubmissions(context)
            }
        case "assignmentSubmissions":
            var assignment = context["assignment"] as? [String: Any] ?? [:]
            // Even a teacher account must not import classmates' private submission details.
            let own = values.filter { ($0["recipient"] as? [String: Any])?["userId"] as? String == userID }
            assignment["submissions"] = (assignment["submissions"] as? [[String: Any]] ?? []) + own
            context["assignment"] = assignment
            if !paginate(Job(job.url, job.kind, context), object: object) {
                if object["@odata.nextLink"] == nil { addProvided("submissions", context: &context) }
                else { context["warnings"] = (context["warnings"] as? [String] ?? []) + ["提交状态分页未完整读取"] }
                startOutcomes(context, index: 0)
            }
        case "assignmentOutcomes":
            var assignment = context["assignment"] as? [String: Any] ?? [:]
            var submissions = assignment["submissions"] as? [[String: Any]] ?? []
            let index = context["outcomeIndex"] as? Int ?? 0
            if submissions.indices.contains(index) {
                submissions[index]["outcomes"] = (submissions[index]["outcomes"] as? [[String: Any]] ?? []) + values
                assignment["submissions"] = submissions; context["assignment"] = assignment
            }
            if !paginate(Job(job.url, job.kind, context), object: object) { startOutcomes(context, index: index + 1) }
        default: break
        }
        finished(job)
    }

    private func startSubmissions(_ context: [String: Any]) {
        guard let base = context["assignmentBase"] as? String else { return }
        enqueue(base + "/submissions?$top=50", "assignmentSubmissions", context)
    }

    private func startOutcomes(_ source: [String: Any], index: Int) {
        var context = source
        let assignment = context["assignment"] as? [String: Any] ?? [:]
        let submissions = assignment["submissions"] as? [[String: Any]] ?? []
        guard submissions.indices.contains(index) else { emitAssignment(context); return }
        guard let id = submissions[index]["id"] as? String, let base = context["assignmentBase"] as? String else {
            startOutcomes(context, index: index + 1); return
        }
        context["outcomeIndex"] = index
        enqueue(base + "/submissions/" + segment(id) + "/outcomes?$top=50", "assignmentOutcomes", context)
    }

    private func emitAssignment(_ context: [String: Any]) {
        let assignment = context["assignment"] as? [String: Any] ?? [:]
        let classID = assignment["classId"] as? String ?? ""
        let schoolClass = discoveredTeams[classID] ?? ["id": classID, "displayName": ""]
        assignments += 1
        onBatch?(["source": "teams", "provider": "graph", "kind": "assignment", "capturedAt": timestamp(),
                  "assignment": assignment, "class": schoolClass, "userId": userID,
                  "providedFields": context["providedFields"] ?? [], "warnings": context["warnings"] ?? [],
                  "complete": false])
    }

    private func emitMessages(_ rows: [[String: Any]], context: [String: Any], kind: String) {
        messages += rows.count
        var batch = context
        batch["source"] = "teams"; batch["provider"] = "graph"; batch["kind"] = kind
        batch["messages"] = rows; batch["capturedAt"] = timestamp(); batch["complete"] = false
        batch["warnings"] = []; batch["userId"] = userID
        onBatch?(batch)
    }

    @discardableResult private func paginate(_ job: Job, object: [String: Any]) -> Bool {
        guard let raw = object["@odata.nextLink"] else { return false }
        guard let next = raw as? String, Self.validGraphURL(next) != nil else {
            recordWarning("Microsoft 返回了无效的分页地址，此列表未能读取完整"); return false
        }
        if next == job.url || visited.contains(next) || jobs.contains(where: { $0.url == next }) {
            recordWarning("Microsoft 返回了重复的分页地址，此列表未能读取完整"); return false
        }
        enqueue(next, job.kind, job.context)
        return true
    }

    private func enqueue(_ url: String, _ kind: String, _ context: [String: Any]) {
        guard Self.validGraphURL(url) != nil else { recordWarning("已拒绝不符合 Graph 范围的接口地址"); return }
        guard !visited.contains(url), !jobs.contains(where: { $0.url == url }) else { return }
        jobs.append(Job(url, kind, context))
    }

    private func failed(_ job: Job, reason: String) {
        let label = ["assignmentList": "作业列表", "assignmentDetail": "作业要求", "assignmentResources": "作业附件", "assignmentSubmissions": "提交状态", "assignmentOutcomes": "教师反馈", "teams": "团队列表", "associatedTeams": "共享团队", "channels": "频道列表", "channelMessages": "频道消息", "channelReplies": "频道回复", "chats": "聊天列表", "chatMessages": "聊天消息", "profile": "账号信息"][job.kind] ?? "Teams"
        let warning = label + "：" + reason
        recordWarning(warning)
        var context = job.context
        context["warnings"] = (context["warnings"] as? [String] ?? []) + [warning]
        switch job.kind {
        case "profile":
            isRunning = false; checkpointNow(); publish("authRequired", warning); return
        case "assignmentDetail":
            if let base = context["assignmentBase"] as? String { enqueue(base + "/resources?$top=50", "assignmentResources", context) }
        case "assignmentResources": startSubmissions(context)
        case "assignmentSubmissions": emitAssignment(context)
        case "assignmentOutcomes": startOutcomes(context, index: (context["outcomeIndex"] as? Int ?? 0) + 1)
        default: break
        }
        finished(job)
    }

    private func finished(_ job: Job) {
        visited.insert(job.url)
        if !jobs.isEmpty { jobs.removeFirst() }
        pages += 1
        checkpointNow(); publish("syncing", "正在自动同步 Teams，已读取 \(pages) 个接口分页")
        let expected = generation
        // Yield without blocking the UI or needing a user to click 'continue'.
        DispatchQueue.main.asyncAfter(deadline: .now() + (pages % 100 == 0 ? 1.0 : 0.05)) { [weak self] in
            guard let self = self, self.generation == expected else { return }; self.next()
        }
    }

    private func recordWarning(_ text: String) { errors += 1; if warnings.count < 40 && !warnings.contains(text) { warnings.append(text) } }
    private func addProvided(_ field: String, context: inout [String: Any]) {
        var fields = context["providedFields"] as? [String] ?? []; if !fields.contains(field) { fields.append(field) }; context["providedFields"] = fields
    }
    private func timestamp() -> String { ISO8601DateFormatter().string(from: Date()) }
    private func segment(_ string: String) -> String {
        string.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")) ?? ""
    }
    private func checkpointNow() {
        onCheckpoint?(["version": 1, "jobs": jobs.map(\.dictionary), "userId": userID, "teams": discoveredTeams,
                       "channels": Array(discoveredChannels), "chats": Array(discoveredChats),
                       "pages": pages, "messages": messages, "assignments": assignments,
                       "errors": errors, "warnings": warnings, "savedAt": timestamp()])
    }
    private func publish(_ status: String, _ message: String) {
        onStatus?(["status": status, "message": message, "running": isRunning, "complete": status == "complete",
                   "teams": discoveredTeams.count, "channels": discoveredChannels.count, "chats": discoveredChats.count,
                   "messages": messages, "assignments": assignments, "pages": pages, "pending": jobs.count,
                   "errors": errors, "warnings": warnings, "updatedAt": timestamp()])
    }

    private func channelBase(_ channel: [String: Any], teamID: String) -> String? {
        if let raw = channel["@odata.id"] as? String {
            guard var parts = URLComponents(string: raw), Self.validGraphURL(raw) != nil else { return nil }
            // Documented Graph allChannels workaround for a cross-tenant shared-channel OData ID.
            let segments = parts.percentEncodedPath.split(separator: "/").map(String.init)
            if segments.count >= 3, segments[1] == "tenants" {
                parts.percentEncodedPath = "/" + ([segments[0]] + Array(segments.dropFirst(3))).joined(separator: "/")
            }
            parts.query = nil; parts.fragment = nil
            guard let value = parts.string, Self.validGraphURL(value) != nil,
                  (parts.path.contains("/channels/") || parts.path.contains("/channels(")) else { return nil }
            return value
        }
        guard let id = channel["id"] as? String else { return nil }
        return origin + "/teams/" + segment(teamID) + "/channels/" + segment(id)
    }
}
