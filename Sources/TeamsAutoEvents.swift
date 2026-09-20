import Foundation

/// The browser runner's bounded NDJSON protocol. Keep the portable decoder
/// separately testable so newly added event types cannot abort a real sync.
enum TeamsAutoEventDecoder {
    static let maximumLine = 24 * 1024 * 1024
    static let allowedTypes: Set<String> = ["snapshot", "progress", "done", "error", "attachment", "attachmentUnchanged"]
    static func decode(_ data: Data) -> [String: Any]? {
        guard !data.isEmpty, data.count <= maximumLine,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = value["type"] as? String, allowedTypes.contains(type) else { return nil }
        return value
    }
}
