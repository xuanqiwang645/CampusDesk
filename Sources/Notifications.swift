import Foundation
import UserNotifications

/// Local, opt-in Teams reminders. No server, credentials, or remote push registration.
final class CampusNotifications: NSObject, UNUserNotificationCenterDelegate {
    var onEvent: (([String: Any]) -> Void)?
    var onOpen: ((String) -> Void)?
    private let center = UNUserNotificationCenter.current()
    private let prefix = "campus-teams-"
    private var revision = UUID()
    private var desiredIDs = Set<String>()
    private let fractional = ISO8601DateFormatter()
    private let ordinary = ISO8601DateFormatter()

    override init() {
        super.init()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        ordinary.formatOptions = [.withInternetDateTime]
        center.delegate = self
    }
    func requestPermission() {
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.onEvent?(["type": "notificationPermission", "granted": granted,
                               "status": error == nil ? (granted ? "authorized" : "denied") : "error"])
                if let error = error {
                    self.onEvent?(["type": "status", "source": "app", "busy": false,
                                   "message": "通知授权未完成：" + error.localizedDescription])
                }
            }
        }
    }
    private func date(_ text: String) -> Date? { fractional.date(from: text) ?? ordinary.date(from: text) }
    private func isTeamsURL(_ text: String) -> Bool {
        // Share the host, credential, query and fragment checks used by the browser.
        return schoolURL(text, source: "teams") != nil
    }
    private func identifier(_ text: String) -> String {
        var value: UInt64 = 14695981039346656037
        for byte in text.utf8 { value ^= UInt64(byte); value = value &* 1099511628211 }
        return prefix + String(value, radix: 16)
    }
    func sync(items: [[String: Any]], enabled: Bool) {
        revision = UUID()
        let expected = revision
        let now = Date()
        var desired: [String: (Date, String, String, String)] = [:]
        if enabled {
            for item in items.prefix(60) {
                guard item["source"] as? String == "teams",
                      let id = item["id"] as? String, !id.isEmpty, id.count <= 512,
                      let stamp = item["fireAt"] as? String, let fireAt = date(stamp),
                      fireAt > now, fireAt.timeIntervalSince(now) <= 366 * 24 * 3600,
                      let title = item["title"] as? String, !title.isEmpty,
                      let url = item["url"] as? String, isTeamsURL(url) else { continue }
                let body = item["body"] as? String ?? "作业即将截止，请查看要求。"
                let clippedTitle = String(title.prefix(120))
                let clippedBody = String(body.prefix(240))
                // A changed requirement or source link must also replace pending content,
                // even when the assignment's ID and reminder time remain unchanged.
                let fingerprint = json([id, stamp, clippedTitle, clippedBody, url]) ?? (id + "|" + stamp)
                desired[identifier(fingerprint)] = (fireAt, clippedTitle, clippedBody, url)
            }
        }
        let wanted = desired
        desiredIDs = Set(wanted.keys)
        center.getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async {
                guard let self = self, self.revision == expected else { return }
                let authorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
                // In-flight additions from an earlier sync must also be removed if
                // permission was revoked before their completion callbacks arrive.
                if !enabled || !authorized { self.desiredIDs.removeAll() }
                self.center.getPendingNotificationRequests { [weak self] pending in
                    DispatchQueue.main.async {
                        guard let self = self, self.revision == expected else { return }
                        let existing = pending.filter { $0.identifier.hasPrefix(self.prefix) }
                        let unwanted = existing.filter { !enabled || !authorized || wanted[$0.identifier] == nil }.map { $0.identifier }
                        self.center.removePendingNotificationRequests(withIdentifiers: unwanted)
                        guard enabled, authorized else {
                            if enabled { self.onEvent?(["type": "notificationPermission", "granted": false, "status": "denied"]) }
                            return
                        }
                        let existingIDs = Set(existing.map { $0.identifier })
                        for (id, item) in wanted where !existingIDs.contains(id) {
                            let interval = item.0.timeIntervalSinceNow
                            guard interval > 0 else { continue }
                            let content = UNMutableNotificationContent()
                            content.title = "Teams · " + item.1
                            content.body = item.2
                            content.sound = .default
                            content.userInfo = ["teamsURL": item.3]
                            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, interval), repeats: false)
                            let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
                            self.center.add(request) { [weak self] error in
                                DispatchQueue.main.async {
                                    guard let self = self else { return }
                                    if !self.desiredIDs.contains(id) {
                                        self.center.removePendingNotificationRequests(withIdentifiers: [id])
                                    }
                                    if let error = error, self.revision == expected {
                                        self.onEvent?(["type": "status", "source": "app", "busy": false,
                                                       "message": "作业提醒未能加入系统通知：" + error.localizedDescription])
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let url = response.notification.request.content.userInfo["teamsURL"] as? String
        DispatchQueue.main.async { [weak self] in
            if response.actionIdentifier == UNNotificationDefaultActionIdentifier, let url = url,
               self?.isTeamsURL(url) == true { self?.onOpen?(url) }
            completionHandler()
        }
    }
}
