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
        var renderedCount = 0
        func render<V: View>(_ view: V, name: String, width: CGFloat, height: CGFloat) throws {
            let renderer = ImageRenderer(content: view.frame(width: width, height: height))
            renderer.scale = 2
            guard let cg = renderer.cgImage else { fatalError("SwiftUI render failed: " + name) }
            guard cg.width == Int(width * 2), cg.height == Int(height * 2) else { fatalError("Wrong render dimensions") }
            let data = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])!
            try data.write(to: target.appendingPathComponent(name + ".png"))
            renderedCount += 1
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

        // Exercise text pressure, mixed event kinds, and cache states using only
        // synthetic data. Keep each artifact available for visual inspection.
        let stressItems = [
            item("long-course", "AP English Language Arts I · 长课程名称与课堂讨论", "course", -600, duration: 3000,
                 location: "E103 国际部综合实验教室（长地点名称）"),
            item("long-next", "Pre-Calculus · Functions and Their Graphs", "course", 3600, duration: 2400, location: "E101"),
            item("long-task", "整理课堂资料并完成实验报告的全部计算与分析", "task", -172800),
            item("near-task", "Complete the Pre-Calculus Review Assignment", "task", 1800),
            item("other-task", "Preparing the Long Geography Observation Report", "task", 259200),
            item("final-task", "复习本周知识并整理所有课堂练习和学习资料", "task", 345600),
            ["id": "all-day", "title": "校历活动 · 国际部社会实践", "kind": "school", "source": "school", "date": day,
             "startAt": NSNull(), "endAt": NSNull(), "allDay": true, "completed": false, "location": NSNull()]
        ]
        func fixture(_ values: [[String: Any]], generated: Date = now, firstDay: String = day) throws -> CampusWidgetEntry {
            var copy = document
            copy["items"] = values
            copy["generatedAt"] = stamp.string(from: generated)
            copy["day"] = firstDay
            return .init(date: now, snapshot: try JSONDecoder().decode(CampusWidgetSnapshot.self,
                from: JSONSerialization.data(withJSONObject: copy)), preview: false)
        }
        let stressEntry = try fixture(stressItems)
        for dark in [false, true] {
            let scheme: ColorScheme = dark ? .dark : .light
            let suffix = dark ? "dark" : "light"
            for (mode, name) in [(CampusWidgetMode.today, "today"), (.deadlines, "deadlines"), (.nextClass, "class")] {
                for (family, size, width, height) in [(WidgetFamily.systemSmall, "small", CGFloat(170), CGFloat(170)),
                                                     (.systemMedium, "medium", 360, 170)] {
                    try render(CampusWidgetView(entry: stressEntry, mode: mode, previewFamily: family).environment(\.colorScheme, scheme),
                               name: "long-" + name + "-" + size + "-" + suffix, width: width, height: height)
                }
                if mode != .nextClass {
                    try render(CampusWidgetView(entry: stressEntry, mode: mode, previewFamily: .systemLarge).environment(\.colorScheme, scheme),
                               name: "long-" + name + "-large-" + suffix, width: 360, height: 376)
                }
            }
        }
        for (label, special) in [
            ("stale", try fixture(items, generated: now.addingTimeInterval(-25 * 3600))),
            ("expired", try fixture(items, generated: now.addingTimeInterval(-9 * 86400),
                                    firstDay: CampusWidgetSnapshot.dayString(now.addingTimeInterval(-9 * 86400)))),
            ("no-events", try fixture([])),
            ("permission", CampusWidgetEntry(date: now, snapshot: nil, preview: false, issue: .permission))
        ] {
            try render(CampusWidgetView(entry: special, mode: .today, previewFamily: .systemSmall), name: label + "-small", width: 170, height: 170)
        }
        for (mode, name) in [(CampusWidgetMode.today, "today"), (.deadlines, "deadlines"), (.nextClass, "class")] {
            try render(CampusWidgetView(entry: .init(date: now, snapshot: nil, preview: true), mode: mode, previewFamily: .systemMedium),
                       name: "gallery-" + name + "-medium", width: 360, height: 170)
        }
        let denseToday = try fixture((0..<5).map { index in
            item("dense-\(index)", "AP English Language Arts I · 长课程名称与课堂讨论 \(index + 1)", "course",
                 Double(index * 1800), duration: 2400, location: "E103 国际部综合实验教室（长地点名称）")
        })
        for dark in [false, true] {
            try render(CampusWidgetView(entry: denseToday, mode: .today, previewFamily: .systemLarge)
                .environment(\.colorScheme, dark ? .dark : .light), name: "dense-today-large-" + (dark ? "dark" : "light"),
                       width: 360, height: 376)
        }
        print("PASS: \(renderedCount) widget layout fixtures rendered to " + target.path)
    }
}
