import SwiftUI
import WidgetKit

enum CampusWidgetMode {
    case today, deadlines, nextClass
    var title: String {
        switch self { case .today: return "今日行事历"; case .deadlines: return "截止提醒"; case .nextClass: return "下一节课" }
    }
    var symbol: String {
        switch self { case .today: return "calendar"; case .deadlines: return "checklist"; case .nextClass: return "graduationcap" }
    }
}

struct CampusWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: CampusWidgetSnapshot?
    let preview: Bool
    var issue: CampusWidgetReadIssue? = nil
}

struct CampusWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> CampusWidgetEntry { .init(date: Date(), snapshot: nil, preview: true) }
    func getSnapshot(in context: Context, completion: @escaping (CampusWidgetEntry) -> Void) {
        let result = context.isPreview ? nil : CampusWidgetSnapshot.load()
        completion(.init(date: Date(), snapshot: result?.snapshot, preview: context.isPreview, issue: result?.issue))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CampusWidgetEntry>) -> Void) {
        let now = Date(), result = CampusWidgetSnapshot.load()
        var dates = [now]
        dates += (1...24).map { now.addingTimeInterval(Double($0) * 30 * 60) }
        // Boundary entries update rows while the app is closed.
        dates += (result.snapshot?.items ?? []).flatMap { [$0.start, $0.end].compactMap { $0 } }
            .filter { $0 > now && $0 < now.addingTimeInterval(12 * 60 * 60) }
        if let midnight = CampusWidgetSnapshot.beijing.date(byAdding: .day, value: 1, to: CampusWidgetSnapshot.beijing.startOfDay(for: now)) {
            dates.append(midnight)
        }
        let entries = Array(Set(dates)).sorted().prefix(80).map {
            CampusWidgetEntry(date: $0, snapshot: result.snapshot, preview: false, issue: result.issue)
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }
}

struct CampusWidgetView: View {
    let entry: CampusWidgetEntry
    let mode: CampusWidgetMode
    var previewFamily: WidgetFamily? = nil
    @Environment(\.widgetFamily) private var systemFamily
    @Environment(\.colorScheme) private var colorScheme
    private var family: WidgetFamily { previewFamily ?? systemFamily }
    private var small: Bool { family == .systemSmall }
    private var large: Bool { family == .systemLarge }
    private var accent: Color {
        colorScheme == .dark ? Color(red: 0.50, green: 0.84, blue: 0.70) : Color(red: 0.13, green: 0.43, blue: 0.36)
    }
    private var background: Color {
        colorScheme == .dark ? Color(red: 0.07, green: 0.14, blue: 0.12) : Color(red: 0.94, green: 0.97, blue: 0.95)
    }
    private var day: String { CampusWidgetSnapshot.dayString(entry.date) }
    private var expired: Bool { entry.snapshot?.isExpired(at: entry.date) == true }
    private var stale: Bool { entry.snapshot?.isStale(at: entry.date) == true }
    private var items: [CampusWidgetItem] {
        guard !expired else { return [] }
        if mode == .nextClass { return entry.snapshot?.courses(now: entry.date) ?? [] }
        return entry.snapshot?.visibleItems(deadlines: mode == .deadlines, now: entry.date) ?? []
    }
    private var limit: Int { large ? 5 : small ? 2 : 3 }

    var body: some View {
        #if WIDGET_RENDER
        content.padding(16).background(background)
        #else
        content
            .widgetURL(CampusWidgetSnapshot.link(day: mode == .today ? day : (items.first?.date ?? day)))
            .containerBackground(for: .widget) { background }
            .environment(\.timeZone, CampusWidgetSnapshot.beijing.timeZone)
        #endif
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: large ? 14 : 8) {
            HStack(spacing: 5) {
                Image(systemName: mode.symbol).foregroundStyle(accent)
                Text(mode.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                Spacer(minLength: 2)
                Text(String(day.suffix(5)).replacingOccurrences(of: "-", with: "/"))
                    .font(.system(size: 10, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
            }
            if entry.preview {
                previewContent
            } else if entry.snapshot == nil {
                emptyContent(icon: "arrow.triangle.2.circlepath", title: entry.issue?.title ?? "打开 CampusDesk", detail: entry.issue?.detail ?? "同步后显示课程与待办")
            } else if expired {
                emptyContent(icon: "calendar.badge.exclamationmark", title: "日程需要更新", detail: "打开 CampusDesk 同步最新安排")
            } else if items.isEmpty {
                emptyContent(icon: "checkmark.circle", title: stale ? "请先刷新日程" : mode == .deadlines ? "暂无截止待办" : mode == .nextClass ? "今天暂无后续课程" : "今天暂无安排", detail: stale ? "缓存较旧，点击打开应用" : "点击查看行事历")
            } else if mode == .nextClass, let course = items.first {
                classContent(course)
            } else {
                VStack(alignment: .leading, spacing: large ? 8 : 7) {
                    ForEach(Array(items.prefix(limit))) { item in
                        #if WIDGET_RENDER
                        row(item)
                        #else
                        if small { row(item) }
                        else { Link(destination: CampusWidgetSnapshot.link(day: item.date)) { row(item) } }
                        #endif
                    }
                }
                Spacer(minLength: 0)
            }
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .environment(\.timeZone, CampusWidgetSnapshot.beijing.timeZone)
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Text("CampusDesk").font(.system(size: 9, weight: .medium))
            Spacer(minLength: 0)
            if stale { Text("缓存待更新").font(.system(size: 9)) }
            else if mode != .nextClass && items.count > limit { Text("还有 \(items.count - limit) 项").font(.system(size: 9)) }
            else if let generated = entry.snapshot.flatMap({ CampusWidgetSnapshot.timestamp($0.generatedAt) }) {
                Text(timeString(generated)).font(.system(size: 9)).accessibilityLabel("数据更新时间")
            }
        }.foregroundStyle(.secondary).lineLimit(1)
    }

    private func timeString(_ date: Date) -> String {
        let parts = CampusWidgetSnapshot.beijing.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    private func urgencyColor(_ item: CampusWidgetItem) -> Color {
        guard let status = item.deadlineStatus(at: entry.date) else { return accent }
        switch status.urgency {
        case .overdue: return colorScheme == .dark ? .red.opacity(0.85) : Color(red: 0.68, green: 0.18, blue: 0.16)
        case .urgent, .soon: return colorScheme == .dark ? .orange : Color(red: 0.62, green: 0.34, blue: 0.07)
        case .normal, .relaxed: return accent
        }
    }

    private func row(_ item: CampusWidgetItem) -> some View {
        let status = item.deadlineStatus(at: entry.date)
        return HStack(alignment: .top, spacing: 7) {
            RoundedRectangle(cornerRadius: 2).fill(urgencyColor(item)).frame(width: 3)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(item.title).font(.system(size: small ? 12 : 13, weight: .semibold))
                        .foregroundStyle(.primary).lineLimit(large ? 2 : 1).privacySensitive().frame(maxWidth: .infinity, alignment: .leading)
                    if !small, let status {
                        Text(status.label).font(.system(size: 9, weight: .semibold)).foregroundStyle(urgencyColor(item))
                            .padding(.horizontal, 5).padding(.vertical, 2).background(urgencyColor(item).opacity(0.1), in: Capsule()).fixedSize()
                    }
                }
                HStack(spacing: 4) {
                    if let status {
                        if !small { dateLabel(item); Text("·") }
                        if let deadline = item.start, deadline > entry.date, deadline.timeIntervalSince(entry.date) < 86400 {
                            Text("剩")
                            Text(timerInterval: entry.date...deadline, countsDown: true).lineLimit(1)
                        } else { Text(status.remainingText).lineLimit(1) }
                    } else {
                        dateLabel(item)
                        if item.isOngoing(at: entry.date) { Text("· 进行中").foregroundStyle(accent) }
                        else if !small, let location = item.location, !location.isEmpty { Text("· " + location).lineLimit(1).privacySensitive() }
                    }
                }.font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary).monospacedDigit()
                if mode == .deadlines, let status, large || small {
                    GeometryReader { geometry in
                        Capsule().fill(urgencyColor(item).opacity(0.12))
                            .overlay(alignment: .leading) {
                                Capsule().fill(urgencyColor(item)).frame(width: geometry.size.width * status.pressure)
                            }
                    }.frame(height: 3).accessibilityLabel("截止紧迫度，非完成进度")
                }
            }
        }.fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func dateLabel(_ item: CampusWidgetItem) -> some View {
        if item.allDay { Text("全天") }
        else if let date = item.start {
            if mode == .deadlines && item.date != day { Text(String(item.date.suffix(5)).replacingOccurrences(of: "-", with: "/")) }
            Text(timeString(date))
        }
    }

    private func classContent(_ course: CampusWidgetItem) -> some View {
        let ongoing = course.isOngoing(at: entry.date)
        let boundary = ongoing ? course.end : course.start
        return HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(ongoing ? "正在上课" : "即将开始").font(.system(size: 10, weight: .semibold)).foregroundStyle(accent)
                Text(course.title).font(.system(size: small ? 15 : 17, weight: .semibold)).lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true).privacySensitive()
                HStack(spacing: 3) {
                    dateLabel(course)
                    if let end = course.end { Text("–"); Text(timeString(end)) }
                }.font(.system(size: 10)).foregroundStyle(.secondary).monospacedDigit()
                if let location = course.location, !location.isEmpty {
                    Label(location, systemImage: "mappin").font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1).privacySensitive()
                }
                if let boundary, boundary > entry.date {
                    HStack(spacing: 4) {
                        Text(ongoing ? "下课" : "开课")
                        Text(timerInterval: entry.date...boundary, countsDown: true).monospacedDigit()
                    }.font(.system(size: 11, weight: .semibold)).foregroundStyle(accent).lineLimit(1)
                }
                Spacer(minLength: 0)
            }.frame(maxWidth: .infinity, alignment: .leading)
            if !small, let next = items.dropFirst().first {
                VStack(alignment: .leading, spacing: 6) {
                    Text("之后").font(.system(size: 10)).foregroundStyle(.secondary)
                    Text(next.title).font(.system(size: 12, weight: .medium)).lineLimit(2).privacySensitive()
                    dateLabel(next).font(.system(size: 10)).foregroundStyle(.secondary)
                }.frame(maxWidth: 90, alignment: .leading)
            }
        }.frame(maxHeight: .infinity, alignment: .top)
    }

    private func emptyContent(icon: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Spacer(minLength: 0)
            Image(systemName: icon).font(.system(size: 21)).foregroundStyle(accent)
            Text(title).font(.system(size: 13, weight: .semibold)).lineLimit(2)
            Text(detail).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2)
            Spacer(minLength: 0)
        }
    }

    private var previewContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(mode == .deadlines ? "把重要的事，按时完成。" : mode == .nextClass ? "下一节 · 数学" : "今天，稳稳推进。")
                .font(.system(size: small ? 16 : 20, weight: .semibold)).lineLimit(2)
            Text(mode == .deadlines ? "截止时间 · 紧迫度" : mode == .nextClass ? "开课倒计时 · 教室" : "课程 · 待办 · 校历")
                .font(.system(size: 11)).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
    }
}

struct CampusTodayWidget: Widget {
    let kind = "CampusDesk.Today"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CampusWidgetProvider()) { CampusWidgetView(entry: $0, mode: .today) }
            .configurationDisplayName("今日行事历")
            .description("查看当天课程、待办和校历事件，点击返回对应日期。")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct CampusDeadlinesWidget: Widget {
    let kind = "CampusDesk.Deadlines"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CampusWidgetProvider()) { CampusWidgetView(entry: $0, mode: .deadlines) }
            .configurationDisplayName("截止提醒")
            .description("查看未完成待办、剩余时间和紧迫度；进度条表示临近截止程度。")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct CampusNextClassWidget: Widget {
    let kind = "CampusDesk.NextClass"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CampusWidgetProvider()) { CampusWidgetView(entry: $0, mode: .nextClass) }
            .configurationDisplayName("下一节课")
            .description("查看当前或下一节课、教室，以及开课或下课倒计时。")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

#if !WIDGET_RENDER
@main struct CampusDeskWidgets: WidgetBundle {
    var body: some Widget { CampusTodayWidget(); CampusDeadlinesWidget(); CampusNextClassWidget() }
}
#endif
