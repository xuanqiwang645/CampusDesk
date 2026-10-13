// Offline SwiftUI layout fixtures. Never reads the user's CampusDesk data.
// Build with -D WIDGET_RENDER, WidgetSnapshot.swift and CampusDeskWidgets.swift.
import AppKit
import SwiftUI
import WidgetKit

@main enum WidgetRender {
    @MainActor static func main() throws {
        let target = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let now = Date(), day = CampusWidgetSnapshot.dayString(now)
        let stamp = ISO8601DateFormatter()
        func item(_ id: String, _ title: String, _ kind: String, _ offset: Double, duration: Double? = nil, location: String? = nil) -> [String: Any] {
            let start = now.addingTimeInterval(offset)
            return ["id": id, "title": title, "kind": kind, "source": "personal",
                    "date": CampusWidgetSnapshot.dayString(start), "startAt": stamp.string(from: start),
                    "endAt": duration.map { stamp.string(from: start.addingTimeInterval($0)) } as Any? ?? NSNull(),
                    "allDay": false, "completed": false, "location": location as Any? ?? NSNull()]
        }
        let items = [
            item("class-1", "AP Physics · 力学实验", "course", -600, duration: 3000, location: "E103 实验教室"),
            item("class-2", "English Language Arts I", "course", 3600, duration: 3000, location: "E101"),
            item("task-1", "完成化学实验报告并检查计算结果", "task", -3600),
            item("task-2", "Pre-Calculus Homework", "task", 2400),
            item("task-3", "整理本周课堂笔记", "task", 12000),
            item("task-4", "中文阅读与摘抄", "task", 86400),
            item("task-5", "地理观察项目", "task", 172800),
            item("task-6", "准备 English Corner", "task", 345600),
            item("task-7", "个人学习计划", "task", 518400)
        ]
        let document: [String: Any] = ["schemaVersion": 1, "generatedAt": stamp.string(from: now), "day": day,
            "timezone": "Asia/Shanghai", "counts": ["today": 5, "upcoming": 9, "overdue": 1], "items": items]
        let snapshot = try JSONDecoder().decode(CampusWidgetSnapshot.self, from: JSONSerialization.data(withJSONObject: document))
        let entry = CampusWidgetEntry(date: now, snapshot: snapshot, preview: false)
        func render<V: View>(_ view: V, name: String, width: CGFloat, height: CGFloat) throws {
            let renderer = ImageRenderer(content: view.frame(width: width, height: height))
            renderer.scale = 2
            guard let cg = renderer.cgImage else { fatalError("SwiftUI render failed: " + name) }
            guard cg.width == Int(width * 2), cg.height == Int(height * 2) else { fatalError("Wrong render dimensions") }
            let data = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])!
            try data.write(to: target.appendingPathComponent(name + ".png"))
        }
        for dark in [false, true] {
            let scheme: ColorScheme = dark ? .dark : .light
            let suffix = dark ? "dark" : "light"
            for (mode, name) in [(CampusWidgetMode.today, "today"), (.deadlines, "deadlines"), (.nextClass, "class")] {
                try render(CampusWidgetView(entry: entry, mode: mode, previewFamily: .systemSmall).environment(\.colorScheme, scheme), name: name + "-small-" + suffix, width: 170, height: 170)
                try render(CampusWidgetView(entry: entry, mode: mode, previewFamily: .systemMedium).environment(\.colorScheme, scheme), name: name + "-medium-" + suffix, width: 360, height: 170)
                if mode != .nextClass {
                    try render(CampusWidgetView(entry: entry, mode: mode, previewFamily: .systemLarge).environment(\.colorScheme, scheme), name: name + "-large-" + suffix, width: 360, height: 376)
                }
            }
        }
        try render(CampusWidgetView(entry: .init(date: now, snapshot: nil, preview: false), mode: .today, previewFamily: .systemSmall), name: "empty-small", width: 170, height: 170)
        try render(CampusWidgetView(entry: .init(date: now, snapshot: nil, preview: true), mode: .nextClass, previewFamily: .systemSmall), name: "gallery-small", width: 170, height: 170)
        print("PASS: 18 widget layout fixtures rendered to " + target.path)
    }
}
