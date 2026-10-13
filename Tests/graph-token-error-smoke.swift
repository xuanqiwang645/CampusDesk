import Foundation

@main
struct GraphTokenErrorSmokeTests {
    static func main() {
        var passed = 0
        func check(_ condition: Bool, _ label: String) {
            guard condition else { fputs("FAIL: \(label)\n", stderr); exit(1) }
            passed += 1
        }
        let network = TeamsGraph.tokenFailure(GraphAuthError(message: "无法连接 Microsoft 登录服务，请检查网络后重试"))
        check(network.status == "paused" && network.message.contains("检查网络"), "Network failure pauses without declaring the account signed out")
        check(!network.message.contains("登录已失效"), "Network failure does not suggest expired credentials")
        let locked = TeamsGraph.tokenFailure(GraphAuthError(message: "无法更新钥匙串中的 Teams 登录，请解锁 Mac 后重试"))
        check(locked.status == "paused" && locked.message.contains("解锁 Mac"), "Locked Keychain retains the actionable diagnostic")
        check(TeamsGraph.tokenFailure(GraphAuthError(message: "需要重新登录", requiresLogin: true)).status == "authRequired", "Expired grants still require login")
        check(TeamsGraph.tokenFailure(GraphAuthError(message: "学校管理员需要授权", requiresAdminConsent: true)).status == "authRequired", "Missing administrator consent remains an authorization failure")
        check(TeamsGraph.tokenFailure(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)).status == "paused", "Transport errors are retryable")
        print("PASS: \(passed) Graph token failure checks")
    }
}
