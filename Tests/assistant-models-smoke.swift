import Foundation

@main
struct AssistantModelSmokeTests {
    static func main() throws {
        var passed = 0
        func check(_ condition: Bool, _ label: String) {
            guard condition else { fputs("FAIL: \(label)\n", stderr); exit(1) }
            passed += 1
        }
        func expect(_ error: AssistantModelError, _ label: String, _ operation: () throws -> Void) {
            do { try operation(); check(false, label) }
            catch let actual as AssistantModelError { check(actual == error, label) }
            catch { check(false, label) }
        }
        func json(_ object: Any) throws -> Data { try JSONSerialization.data(withJSONObject: object) }

        let cloud = try CampusAssistantModels.makeRequest(provider: "deepseek", key: "synthetic-test-key")
        check(cloud.url?.absoluteString == "https://api.deepseek.com/models", "Cloud discovery uses only the fixed model endpoint")
        check(cloud.httpMethod == "GET" && cloud.httpBody == nil, "Cloud discovery has no school context or request body")
        check(cloud.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-test-key", "Cloud discovery authenticates with the supplied synthetic key")
        check(cloud.timeoutInterval <= 10 && !cloud.httpShouldHandleCookies, "Cloud discovery has a short timeout and no cookies")
        let local = try CampusAssistantModels.makeRequest(provider: "ollama", key: "must-not-be-sent")
        check(local.url?.absoluteString == "http://127.0.0.1:11434/api/tags", "Local discovery uses only loopback")
        check(local.httpMethod == "GET" && local.httpBody == nil && local.value(forHTTPHeaderField: "Authorization") == nil, "Local discovery does not send an API key or school context")
        expect(.missingKey, "Missing cloud key fails before networking") { _ = try CampusAssistantModels.makeRequest(provider: "deepseek", key: nil) }
        expect(.unauthorized, "HTTP header injection is rejected") { _ = try CampusAssistantModels.makeRequest(provider: "deepseek", key: "example\r\nInjected: true") }
        expect(.unauthorized, "Oversized credentials are rejected") { _ = try CampusAssistantModels.makeRequest(provider: "deepseek", key: String(repeating: "x", count: 513)) }
        expect(.badResponse, "Unknown providers cannot select another host") { _ = try CampusAssistantModels.makeRequest(provider: "https://example.invalid", key: nil) }

        let cloudModels = try CampusAssistantModels.parse(json(["data": [["id": "deepseek-flash"], ["id": "deepseek-v4-pro"], ["id": "deepseek-flash"]]]), provider: "deepseek")
        check(cloudModels == ["deepseek-flash", "deepseek-v4-pro"], "Cloud model IDs retain order and remove duplicates")
        let localModels = try CampusAssistantModels.parse(json(["models": [["name": "qwen3:8b", "model": "different"], ["model": "namespace/model:tag"]]]), provider: "ollama")
        check(localModels == ["qwen3:8b", "namespace/model:tag"], "Local model names support tags and namespaces")
        check(try CampusAssistantModels.parse(json(["models": []]), provider: "ollama").isEmpty, "An empty local installation returns an empty list")
        for invalid in ["", "bad model", "<script>", "model\n", String(repeating: "x", count: 101)] {
            expect(.badResponse, "Invalid model names fail closed") { _ = try CampusAssistantModels.parse(json(["data": [["id": invalid]]]), provider: "deepseek") }
        }
        expect(.badResponse, "Missing model ID is rejected") { _ = try CampusAssistantModels.parse(json(["data": [["name": "display only"]]]), provider: "deepseek") }
        expect(.badResponse, "Mixed model array types are rejected") { _ = try CampusAssistantModels.parse(json(["data": ["not a model"]]), provider: "deepseek") }
        expect(.badResponse, "Wrong provider response shape is rejected") { _ = try CampusAssistantModels.parse(json(["models": []]), provider: "deepseek") }
        expect(.badResponse, "HTML and non-JSON responses are rejected") { _ = try CampusAssistantModels.parse(Data("<html>error</html>".utf8), provider: "deepseek") }
        expect(.badResponse, "Responses above 512 KiB are rejected") { _ = try CampusAssistantModels.parse(Data(repeating: 32, count: 512 * 1024 + 1), provider: "deepseek") }
        expect(.badResponse, "Model lists above 100 entries are rejected") { _ = try CampusAssistantModels.parse(json(["data": Array(repeating: ["id": "safe-model"], count: 101)]), provider: "deepseek") }
        check(try CampusAssistantModels.parse(json(["data": (0..<100).map { ["id": "model-\($0)"] }]), provider: "deepseek").count == 100, "The documented model count boundary is accepted")
        check(CampusAssistantModels.responseError(provider: "deepseek", statusCode: 401) == .unauthorized, "Rejected credentials have a distinct error")
        check(CampusAssistantModels.responseError(provider: "deepseek", statusCode: 429) == .network, "Unavailable cloud discovery has a recoverable error")
        check(CampusAssistantModels.responseError(provider: "ollama", statusCode: 503) == .localUnavailable, "Unavailable local discovery is distinguished")
        check(CampusAssistantModels.responseError(provider: "deepseek", statusCode: 302) == .badResponse, "Redirect responses are refused")
        var failureCount = 0
        CampusAssistantModels.list(provider: "deepseek", key: nil) { result in
            if case .failure(.missingKey) = result { failureCount += 1 }
        }
        check(failureCount == 1, "Preflight failure calls completion once without networking")
        print("PASS: \(passed) assistant model discovery checks")
    }
}
