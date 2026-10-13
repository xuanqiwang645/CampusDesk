import Foundation

/// Own this object on one serial queue, never the UI thread. The extension sees
/// only this projection, not CampusDesk's state, account files or credentials.
final class CampusAgendaPublication {
    private let resources: URL
    let target: URL
    private var builder: CampusAgendaSnapshotBuilder?
    private var lastContent: Data?
    private var lastWrite: Date?

    init(resources: URL, target: URL) {
        self.resources = resources
        self.target = target
    }

    /// Unrelated sync updates don't consume WidgetKit's reload budget. Refresh
    /// a still-current projection at most every 30 minutes unless requested.
    @discardableResult func publish(state: [String: Any], now: Date = Date(), force: Bool = false) throws -> Bool {
        if builder == nil { builder = try CampusAgendaSnapshotBuilder(resources: resources, themeEdition: true) }
        let data = try builder!.snapshot(state: state, now: now)
        var content = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        content.removeValue(forKey: "generatedAt")
        let comparable = try JSONSerialization.data(withJSONObject: content, options: .sortedKeys)
        if !force, comparable == lastContent, let lastWrite,
           now.timeIntervalSince(lastWrite) >= 0, now.timeIntervalSince(lastWrite) < 1800,
           FileManager.default.fileExists(atPath: target.path) { return false }
        let directory = target.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let values = try directory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw CampusAgendaSnapshotError.invalid }
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try CampusStateValidator.writePrivate(data, to: target)
        lastContent = comparable
        lastWrite = now
        return true
    }
}

struct CampusAgendaPublicationRequest {
    let state: [String: Any]
    let force: Bool
}
