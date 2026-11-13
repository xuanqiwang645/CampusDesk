import Foundation

enum CampusSchoolCrawlPolicy {
    /// Both canonical and trailing-slash navigation links identify the same
    /// read-only school areas. Submission/edit/admin routes are never queued.
    static func isReadOnlyManageBacPath(_ path: String) -> Bool {
        path.range(of: "^/student/(?:home|grades|reports|academics)/?$", options: .regularExpression) != nil ||
        path.range(of: "^/student/classes/[0-9]+(?:/core_tasks(?:/[0-9]+)?)?/?$", options: .regularExpression) != nil
    }
}
