import Foundation

@main enum SchoolCrawlSmoke {
    static func main() {
        var checks = 0
        for base in ["/student/home", "/student/grades", "/student/reports", "/student/academics", "/student/classes/123", "/student/classes/123/core_tasks", "/student/classes/123/core_tasks/456"] {
            for path in [base, base + "/"] {
                guard CampusSchoolCrawlPolicy.isReadOnlyManageBacPath(path) else { fatalError("Read-only discovery route was rejected: " + path) }
                checks += 1
            }
        }
        for path in ["/admin", "/student/classes/123/submit", "/student/classes/123/core_tasks/456/edit", "/student/classes/123/core_tasks/new", "/student/grades/delete", "/student/academics//", "/student/classes/abc"] {
            guard !CampusSchoolCrawlPolicy.isReadOnlyManageBacPath(path) else { fatalError("Unrelated or write route was accepted: " + path) }
            checks += 1
        }
        print("PASS: \(checks) read-only school crawler route checks")
    }
}
