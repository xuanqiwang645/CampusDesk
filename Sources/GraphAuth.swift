import Cocoa
import AuthenticationServices
import CryptoKit
import Security

struct GraphAccount {
    let id: String
    let displayName: String
}

struct GraphAuthError: LocalizedError {
    let message: String
    var requiresAdminConsent = false
    var requiresLogin = false
    var errorDescription: String? { message }
}

/// Native public-client authorization code + PKCE. No client secret is used.
/// Refresh credentials stay in Keychain; the dashboard receives only safe status.
final class GraphAuth: NSObject, ASWebAuthenticationPresentationContextProviding, URLSessionTaskDelegate {
    static let redirectURI = "msauth.local.campusdesk.mac://auth"
    static let callbackScheme = "msauth.local.campusdesk.mac"
    static let scopes = ["openid", "profile", "offline_access", "https://graph.microsoft.com/User.Read",
        "https://graph.microsoft.com/Team.ReadBasic.All", "https://graph.microsoft.com/Channel.ReadBasic.All",
        "https://graph.microsoft.com/ChannelMessage.Read.All", "https://graph.microsoft.com/Chat.Read",
        "https://graph.microsoft.com/EduAssignments.Read"]
    private struct Credential: Codable {
        let refreshToken: String
        let accountID: String
        let displayName: String
    }
    weak var presentationWindow: NSWindow?
    var onChange: (([String: Any]) -> Void)?
    private(set) var clientId = ""
    private(set) var tenant = "organizations"
    private var credential: Credential?
    var accountID: String? { credential?.accountID }
    private var bearer: String?
    private var expiresAt = Date.distantPast
    private var revision = UUID()
    private var authentication: ASWebAuthenticationSession?
    private var activeTask: URLSessionDataTask?
    private var signInCompletion: ((Result<GraphAccount, Error>) -> Void)?
    private var refreshWaiters: [(Result<String, Error>) -> Void] = []
    private var refreshing = false
    private var requiresAdminConsent = false
    private var message = "登录 Teams 后自动同步"
    private let service = "local.campusdesk.mac.microsoft-graph"
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 40
        c.timeoutIntervalForResource = 60
        c.httpCookieStorage = nil
        c.urlCache = nil
        return URLSession(configuration: c, delegate: self, delegateQueue: .main)
    }()

    init(resources: URL) {
        super.init()
        let bundled = (try? Data(contentsOf: resources.appendingPathComponent("MicrosoftGraphConfig.json")))
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let saved = UserDefaults.standard.dictionary(forKey: "CampusDesk.GraphConfiguration") ?? bundled
        let proposedID = (saved["clientId"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let proposedTenant = (saved["tenant"] as? String ?? "organizations").trimmingCharacters(in: .whitespacesAndNewlines)
        if Self.validClientID(proposedID), Self.validTenant(proposedTenant) {
            clientId = proposedID; tenant = proposedTenant.lowercased()
            do { if !UserDefaults.standard.bool(forKey: signedOutKey) { credential = try readCredential() } }
            catch { message = "钥匙串暂时不可用，请解锁 Mac 后重新登录 Teams" }
        } else { message = "首次接入需要为 CampusDesk 配置已注册的 Microsoft 应用" }
    }
    static func validClientID(_ value: String) -> Bool { UUID(uuidString: value) != nil && value != "00000000-0000-0000-0000-000000000000" }
    static func validTenant(_ value: String) -> Bool {
        value == "organizations" || UUID(uuidString: value) != nil ||
            (value.count <= 253 && value.range(of: "^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$", options: .regularExpression) != nil)
    }
    func status() -> [String: Any] {
        ["configured": Self.validClientID(clientId), "connected": credential != nil,
         "displayName": credential?.displayName ?? "", "clientId": clientId, "tenant": tenant,
         "requiresAdminConsent": requiresAdminConsent, "message": message,
         "authBusy": signInCompletion != nil, "redirectURI": Self.redirectURI]
    }
    private func notify() { onChange?(status()) }
    private var signedOutKey: String { "CampusDesk.GraphSignedOut." + clientId.lowercased() + "." + tenant.lowercased() }
    func configure(clientId: String, tenant: String) throws {
        let app = clientId.trimmingCharacters(in: .whitespacesAndNewlines)
        let organization = tenant.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard Self.validClientID(app), Self.validTenant(organization) else {
            throw GraphAuthError(message: "请填写真实的 Microsoft 应用 Client ID，以及学校 Tenant ID 或 organizations")
        }
        guard app != self.clientId || organization != self.tenant else { return }
        signOut()
        self.clientId = app; self.tenant = organization
        UserDefaults.standard.set(["clientId": app, "tenant": organization], forKey: "CampusDesk.GraphConfiguration")
        UserDefaults.standard.set(true, forKey: signedOutKey)
        // Configuration switches never silently reconnect a previously saved account.
        try deleteCredential()
        message = "应用配置已保存，请登录 Teams"; notify()
    }
    func signOut() {
        // A failed Keychain delete must never restore a logged-out session on launch.
        UserDefaults.standard.set(true, forKey: signedOutKey)
        revision = UUID()
        authentication?.cancel(); authentication = nil
        activeTask?.cancel(); activeTask = nil
        let cancelled = GraphAuthError(message: "Teams 登录已取消")
        let pendingSignIn = signInCompletion; signInCompletion = nil
        let pendingRefresh = refreshWaiters; refreshWaiters = []; refreshing = false
        bearer = nil; expiresAt = .distantPast; credential = nil
        do { try deleteCredential(); message = "已退出 Teams，本机登录凭据已清除" }
        catch { message = "已停止 Teams 连接，但钥匙串凭据未能删除，请在钥匙串访问中检查 CampusDesk 项目" }
        requiresAdminConsent = false
        pendingSignIn?(.failure(cancelled))
        pendingRefresh.forEach { $0(.failure(cancelled)) }
        notify()
    }
    func signIn(completion: @escaping (Result<GraphAccount, Error>) -> Void) {
        guard Self.validClientID(clientId) else {
            completion(.failure(GraphAuthError(message: "尚未注册或配置 CampusDesk 的 Microsoft 应用，暂时无法发起登录"))); return
        }
        guard let window = presentationWindow, window.isVisible else {
            completion(.failure(GraphAuthError(message: "请先打开 CampusDesk 窗口再登录"))); return
        }
        guard signInCompletion == nil else { completion(.failure(GraphAuthError(message: "请先完成当前 Microsoft 登录窗口"))); return }
        let verifier: String, state: String
        do { verifier = try Self.randomToken(); state = try Self.randomToken() }
        catch { completion(.failure(error)); return }
        // Cancel stale refreshes before opening a new account selection session.
        revision = UUID(); let expected = revision
        activeTask?.cancel(); activeTask = nil
        let oldWaiters = refreshWaiters; refreshWaiters = []; refreshing = false
        oldWaiters.forEach { $0(.failure(GraphAuthError(message: "正在重新登录 Teams"))) }
        signInCompletion = completion
        requiresAdminConsent = false; message = "请在 Microsoft 登录窗口完成学校账号登录"; notify()
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        var components = URLComponents(string: "https://login.microsoftonline.com/\(tenant)/oauth2/v2.0/authorize")!
        components.queryItems = [URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "response_type", value: "code"), URLQueryItem(name: "response_mode", value: "query"),
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI), URLQueryItem(name: "scope", value: Self.scopes.joined(separator: " ")),
            URLQueryItem(name: "state", value: state), URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"), URLQueryItem(name: "prompt", value: "select_account")]
        let authentication = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: Self.callbackScheme) { [weak self] callback, error in
            DispatchQueue.main.async {
                guard let self = self, self.revision == expected else { return }
                self.authentication = nil
                if error != nil { self.finishSignIn(.failure(GraphAuthError(message: "Microsoft 登录未完成或已取消"))); return }
                guard let callback = callback,
                      let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
                      parts.scheme?.lowercased() == Self.callbackScheme, parts.host == "auth",
                      parts.path.isEmpty || parts.path == "/", parts.user == nil, parts.password == nil,
                      parts.port == nil, parts.fragment == nil else {
                    self.finishSignIn(.failure(GraphAuthError(message: "Microsoft 登录返回地址无效"))); return
                }
                let values = parts.queryItems ?? []
                guard values.filter({ $0.name == "state" }).count == 1,
                      values.first(where: { $0.name == "state" })?.value == state else {
                    self.finishSignIn(.failure(GraphAuthError(message: "登录状态校验失败，请重新登录"))); return
                }
                if let errorCode = values.first(where: { $0.name == "error" })?.value {
                    let description = values.first(where: { $0.name == "error_description" })?.value ?? ""
                    self.finishSignIn(.failure(Self.authorizationError(code: errorCode, description: description))); return
                }
                guard values.filter({ $0.name == "code" }).count == 1,
                      let code = values.first(where: { $0.name == "code" })?.value, !code.isEmpty, code.count < 16000 else {
                    self.finishSignIn(.failure(GraphAuthError(message: "Microsoft 未返回有效授权码"))); return
                }
                self.tokenRequest(["grant_type": "authorization_code", "code": code,
                    "redirect_uri": Self.redirectURI, "code_verifier": verifier], expected: expected) { result in
                    switch result {
                    case .failure(let error): self.finishSignIn(.failure(error))
                    case .success(let tokens):
                        self.fetchAccount(token: tokens.access, expected: expected) { profile in
                            switch profile {
                            case .failure(let error): self.finishSignIn(.failure(error))
                            case .success(let account):
                                guard let refresh = tokens.refresh, !refresh.isEmpty else {
                                    self.finishSignIn(.failure(GraphAuthError(message: "Microsoft 未允许保持登录，请检查 offline_access 授权"))); return
                                }
                                let stored = Credential(refreshToken: refresh, accountID: account.id, displayName: account.displayName)
                                do { try self.saveCredential(stored) }
                                catch { self.finishSignIn(.failure(GraphAuthError(message: "无法将 Teams 登录保存到 macOS 钥匙串，请解锁后重试"))); return }
                                self.credential = stored; self.bearer = tokens.access; self.expiresAt = tokens.expiry
                                UserDefaults.standard.set(false, forKey: self.signedOutKey)
                                self.finishSignIn(.success(account))
                            }
                        }
                    }
                }
            }
        }
        authentication.presentationContextProvider = self
        authentication.prefersEphemeralWebBrowserSession = false
        self.authentication = authentication
        if !authentication.start() { self.authentication = nil; finishSignIn(.failure(GraphAuthError(message: "无法打开 Microsoft 登录窗口"))); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 600) { [weak self] in
            guard let self = self, self.revision == expected, self.signInCompletion != nil else { return }
            self.authentication?.cancel(); self.authentication = nil
            self.activeTask?.cancel(); self.activeTask = nil
            self.revision = UUID()
            self.finishSignIn(.failure(GraphAuthError(message: "Microsoft 登录超时，请重新登录")))
        }
    }
    private func finishSignIn(_ result: Result<GraphAccount, Error>) {
        let callback = signInCompletion; signInCompletion = nil
        switch result {
        case .success: message = "已登录 Teams，正在准备自动同步"; requiresAdminConsent = false
        case .failure(let error): message = error.localizedDescription; requiresAdminConsent = (error as? GraphAuthError)?.requiresAdminConsent ?? false
        }
        notify(); callback?(result)
    }
    func accessToken(forceRefresh: Bool, completion: @escaping (Result<String, Error>) -> Void) {
        if !forceRefresh, let bearer = bearer, expiresAt.timeIntervalSinceNow > 90 { completion(.success(bearer)); return }
        guard let stored = credential else { completion(.failure(GraphAuthError(message: "请先登录 Teams"))); return }
        refreshWaiters.append(completion)
        guard !refreshing else { return }
        refreshing = true; let expected = revision
        tokenRequest(["grant_type": "refresh_token", "refresh_token": stored.refreshToken], expected: expected) { [weak self] result in
            guard let self = self, self.revision == expected else { return }
            var response: Result<String, Error>
            switch result {
            case .success(let token):
                let next = Credential(refreshToken: token.refresh ?? stored.refreshToken, accountID: stored.accountID, displayName: stored.displayName)
                do {
                    try self.saveCredential(next); self.credential = next; self.bearer = token.access; self.expiresAt = token.expiry
                    response = .success(token.access)
                } catch {
                    let failure = GraphAuthError(message: "无法更新钥匙串中的 Teams 登录，请解锁 Mac 后重试")
                    self.message = failure.message; self.notify(); response = .failure(failure)
                }
            case .failure(let error):
                self.bearer = nil; self.expiresAt = .distantPast
                if (error as? GraphAuthError)?.requiresLogin == true {
                    self.credential = nil
                    UserDefaults.standard.set(true, forKey: self.signedOutKey)
                    try? self.deleteCredential()
                }
                self.message = error.localizedDescription; self.requiresAdminConsent = (error as? GraphAuthError)?.requiresAdminConsent ?? false
                response = .failure(error); self.notify()
            }
            self.refreshing = false
            let callbacks = self.refreshWaiters; self.refreshWaiters = []
            callbacks.forEach { $0(response) }
        }
    }
    private struct Tokens { let access: String; let refresh: String?; let expiry: Date }
    private func tokenRequest(_ fields: [String: String], expected: UUID, completion: @escaping (Result<Tokens, Error>) -> Void) {
        var parameters = fields; parameters["client_id"] = clientId; parameters["scope"] = Self.scopes.joined(separator: " ")
        var request = URLRequest(url: URL(string: "https://login.microsoftonline.com/\(tenant)/oauth2/v2.0/token")!)
        request.httpMethod = "POST"; request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        request.httpBody = parameters.sorted { $0.key < $1.key }.map { key, value in
            key.addingPercentEncoding(withAllowedCharacters: allowed)! + "=" + value.addingPercentEncoding(withAllowedCharacters: allowed)!
        }.joined(separator: "&").data(using: .utf8)
        activeTask = session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self, self.revision == expected else { return }
            self.activeTask = nil
            guard error == nil, let data = data, data.count <= 1_000_000, let http = response as? HTTPURLResponse,
                  let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                completion(.failure(GraphAuthError(message: "无法连接 Microsoft 登录服务，请检查网络后重试"))); return
            }
            guard http.statusCode == 200 else {
                completion(.failure(Self.authorizationError(code: body["error"] as? String ?? "unknown",
                    description: body["error_description"] as? String ?? ""))); return
            }
            guard let access = body["access_token"] as? String, !access.isEmpty, access.count < 100_000,
                  let lifetime = body["expires_in"] as? NSNumber, lifetime.doubleValue > 0,
                  (body["token_type"] as? String)?.lowercased() == "bearer" else {
                completion(.failure(GraphAuthError(message: "Microsoft 登录响应不完整，请重新登录"))); return
            }
            completion(.success(Tokens(access: access, refresh: body["refresh_token"] as? String,
                expiry: Date().addingTimeInterval(min(86_400, lifetime.doubleValue)))))
        }
        activeTask?.resume()
    }
    private func fetchAccount(token: String, expected: UUID, completion: @escaping (Result<GraphAccount, Error>) -> Void) {
        var request = URLRequest(url: URL(string: "https://graph.microsoft.com/v1.0/me?$select=id,displayName")!)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        activeTask = session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self, self.revision == expected else { return }
            self.activeTask = nil
            guard error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data = data, data.count < 1_000_000,
                  let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let id = object["id"] as? String, !id.isEmpty, id.count < 512 else {
                completion(.failure(GraphAuthError(message: "无法核对 Microsoft 账号，请检查 User.Read 权限后重新登录"))); return
            }
            completion(.success(GraphAccount(id: id, displayName: String((object["displayName"] as? String ?? "学校账号").prefix(160)))))
        }
        activeTask?.resume()
    }
    private static func authorizationError(code: String, description: String) -> GraphAuthError {
        if ["consent_required", "admin_consent_required"].contains(code) || ["AADSTS65001", "AADSTS90094", "AADSTS90093"].contains(where: description.contains) {
            return GraphAuthError(message: "学校尚未批准 CampusDesk 的 Teams 读取权限，请由学校 Microsoft 管理员完成授权", requiresAdminConsent: true)
        }
        if description.contains("AADSTS700016") || code == "unauthorized_client" || code == "invalid_client" {
            return GraphAuthError(message: "Microsoft 应用注册尚未完成或 Client ID/学校 Tenant 不匹配，请检查首次接入配置")
        }
        if code == "invalid_grant" || code == "interaction_required" || code == "login_required" {
            return GraphAuthError(message: "Teams 登录已过期或学校要求重新验证，请重新登录", requiresLogin: true)
        }
        if description.contains("AADSTS53003") { return GraphAuthError(message: "学校的 Microsoft 访问策略阻止了此次登录，请联系学校管理员") }
        if code == "access_denied" { return GraphAuthError(message: "Microsoft 未授予读取权限；如页面提示需要管理员，请由学校管理员批准", requiresAdminConsent: true) }
        if code == "invalid_scope" { return GraphAuthError(message: "Microsoft 应用的读取权限配置不完整，请核对接入说明") }
        return GraphAuthError(message: "Microsoft 登录未完成，请重试；若页面要求学校管理员批准，请先完成审批")
    }
    private static func base64URL(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    private static func randomToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard status == errSecSuccess else { throw GraphAuthError(message: "无法创建安全登录会话，请重新打开应用") }
        return base64URL(Data(bytes))
    }
    private var keyQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: clientId.lowercased() + "|" + tenant.lowercased()]
    }
    private func readCredential() throws -> Credential? {
        var query = keyQuery; query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count < 200_000,
              let item = try? JSONDecoder().decode(Credential.self, from: data), !item.refreshToken.isEmpty, !item.accountID.isEmpty else {
            throw GraphAuthError(message: "无法读取钥匙串登录")
        }
        return item
    }
    private func saveCredential(_ value: Credential) throws {
        let data = try JSONEncoder().encode(value)
        var result = SecItemUpdate(keyQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if result == errSecItemNotFound {
            var item = keyQuery; item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            result = SecItemAdd(item as CFDictionary, nil)
        }
        guard result == errSecSuccess else { throw GraphAuthError(message: "无法保存钥匙串登录") }
    }
    private func deleteCredential() throws {
        let result = SecItemDelete(keyQuery as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw GraphAuthError(message: "无法删除钥匙串登录") }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { presentationWindow ?? NSWindow() }
    // Token endpoints and /me never need redirects. Do not forward credentials.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
