import Foundation

@main
enum AssistantSetupSmoke {
    static func main() {
        let hosts: Set<String> = ["platform.deepseek.com", "api-docs.deepseek.com", "ollama.com", "docs.ollama.com"]
        precondition(CampusAssistantSetupGuide.links.count == 7)
        for id in CampusAssistantSetupGuide.links.keys {
            guard let url = CampusAssistantSetupGuide.url(for: id) else { fatalError("Missing official link") }
            precondition(url.scheme == "https" && hosts.contains(url.host ?? ""))
            precondition(url.query == nil && url.user == nil && url.password == nil)
        }
        for id in ["https://example.com", "file:///private/tmp/test", "__proto__", "deepseek-platform?secret=anything"] {
            precondition(CampusAssistantSetupGuide.url(for: id) == nil)
        }
        precondition(CampusAssistantSetupGuide.commands == [
            "qwen-small": "ollama pull qwen3.5:4b",
            "qwen-standard": "ollama pull qwen3.5:9b",
            "list-models": "ollama ls"
        ])
        precondition(CampusAssistantSetupGuide.commands["ollama pull unknown; sh -c anything"] == nil)
        print("PASS: assistant tutorial official links and fixed copy commands")
    }
}
