import Foundation

/// The tutorial can open official pages or copy fixed, visible commands only.
/// It cannot run shell commands, accept arbitrary URLs, or access credentials.
enum CampusAssistantSetupGuide {
    static let links = [
        "deepseek-platform": "https://platform.deepseek.com/",
        "deepseek-keys": "https://platform.deepseek.com/api_keys",
        "deepseek-pricing": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
        "deepseek-docs": "https://api-docs.deepseek.com/zh-cn/",
        "ollama-download": "https://ollama.com/download/mac",
        "ollama-library": "https://ollama.com/library/qwen3.5",
        "ollama-docs": "https://docs.ollama.com/cli"
    ]
    static let commands = [
        "qwen-small": "ollama pull qwen3.5:4b",
        "qwen-standard": "ollama pull qwen3.5:9b",
        "list-models": "ollama ls"
    ]

    static func url(for id: String) -> URL? {
        guard let value = links[id] else { return nil }
        return URL(string: value)
    }
}
