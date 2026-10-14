import SwiftUI
import WidgetKit

enum CampusWidgetMode {
    case today, deadlines, nextClass
    var title: String {
        switch self { case .today: return "校园总览"; case .deadlines: return "作业与待办"; case .nextClass: return "课程提醒" }
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
        if entry.preview { return sampleItems }
        guard !expired else { return [] }
        if mode == .nextClass { return entry.snapshot?.courses(now: entry.date) ?? [] }
        return entry.snapshot?.visibleItems(deadlines: mode == .deadlines, now: entry.date) ?? []
    }
    private var limit: Int { mode == .deadlines ? (large ? 4 : small ? 1 : 2) : (large ? 5 : small ? 2 : 3) }
    private var courseItems: [CampusWidgetItem] {
        entry.preview ? sampleItems.filter { $0.kind == "course" } : entry.snapshot?.courses(now: entry.date) ?? []
    }
    private var calendarItems: [CampusWidgetItem] {
        entry.preview ? sampleItems.filter { ["school", "personal"].contains($0.kind) } : entry.snapshot?.calendarEvents(now: entry.date) ?? []
    }
    private var homeworkItems: [CampusWidgetItem] {
        entry.preview ? sampleItems.filter(\.isTask) : entry.snapshot?.homework(now: entry.date) ?? []
    }

    var body: some View {
        #if WIDGET_RENDER
        content.padding(16).background(background)
        #else
        content
            .widgetURL(mode == .deadlines ? URL(string: "campusdesk-theme://tasks")! : CampusWidgetSnapshot.link(day: mode == .today ? day : (items.first?.date ?? day)))
            .containerBackground(for: .widget) { background }
            .environment(\.timeZone, CampusWidgetSnapshot.beijing.timeZone)
        #endif
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: small ? 7 : large ? 12 : 8) {
            header
            if !entry.preview && entry.snapshot == nil {
                emptyContent(icon: "arrow.triangle.2.circlepath", title: entry.issue?.title ?? "打开 CampusDesk", detail: entry.issue?.detail ?? "同步后显示课程与待办")
            } else if !entry.preview && expired {
                emptyContent(icon: "calendar.badge.exclamationmark", title: "日程需要更新", detail: "打开 CampusDesk 同步最新安排")
            } else if mode == .today {
                overviewContent
            } else if items.isEmpty {
                emptyContent(icon: "checkmark.circle", title: stale ? "请先刷新日程" : mode == .deadlines ? "暂无截止待办" : mode == .nextClass ? "今天暂无后续课程" : "今天暂无安排", detail: stale ? "缓存较旧，点击打开应用" : "点击查看行事历")
            } else if mode == .nextClass, let course = items.first {
                classContent(course)
            } else if mode == .deadlines && !large {
                deadlineCards
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(items.prefix(limit).enumerated()), id: \.element.id) { index, item in
                        if index > 0 { Divider().opacity(0.35) }
                        itemLink(item) {
                            if mode == .deadlines { deadlineRow(item) }
                            else { agendaRow(item) }
                        }.padding(.vertical, small ? 2 : large ? 6 : 3)
                    }
                }
                Spacer(minLength: 0)
            }
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .environment(\.timeZone, CampusWidgetSnapshot.beijing.timeZone)
    }

    private var header: some View {
        HStack(spacing: 5) {
            Image(systemName: mode.symbol).font(.system(size: 11, weight: .semibold)).foregroundStyle(accent)
            Text(small && mode == .nextClass && items.first?.isOngoing(at: entry.date) == true ? "正在上课" : mode.title)
                .font(.system(size: 11, weight: .semibold)).lineLimit(1).layoutPriority(1)
            Spacer(minLength: 3)
            Text(String(day.suffix(5)).replacingOccurrences(of: "-", with: "/"))
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary).monospacedDigit().fixedSize()
        }.accessibilityElement(children: .combine)
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Text("CampusDesk").font(.system(size: 9, weight: .medium))
            Spacer(minLength: 0)
            if entry.preview { Text("示例").font(.system(size: 9)) }
            else if stale { Text("缓存待更新").font(.system(size: 9)) }
            else if mode == .today { Text("点按查看全部").font(.system(size: 9)) }
            else if mode != .nextClass && items.count > limit { Text("还有 \(items.count - limit) 项").font(.system(size: 9)) }
            else if let generated = entry.snapshot.flatMap({ CampusWidgetSnapshot.timestamp($0.generatedAt) }) {
                Text("更新 " + timeString(generated)).font(.system(size: 9)).accessibilityLabel("数据更新于 " + timeString(generated))
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

    @ViewBuilder private func itemLink<Content: View>(_ item: CampusWidgetItem, @ViewBuilder content: () -> Content) -> some View {
        #if WIDGET_RENDER
        content()
        #else
        if small { content() }
        else {
            Link(destination: item.isTask ? URL(string: "campusdesk-theme://tasks")! : CampusWidgetSnapshot.link(day: item.date), label: content)
                .buttonStyle(.plain)
        }
        #endif
    }

    // Each category owns its space: a full timetable must not push homework
    // or calendar events out of the overview's visible rows.
    @ViewBuilder private var overviewContent: some View {
        if !small && !large {
            HStack(alignment: .top, spacing: 9) {
                overviewSection("课程提醒", symbol: "graduationcap", rows: courseItems, empty: "暂无后续课程")
                Divider().opacity(0.35)
                overviewSection("行事历", symbol: "calendar", rows: calendarItems, empty: "暂无日历事件")
                Divider().opacity(0.35)
                overviewSection("作业提示", symbol: "checklist", rows: homeworkItems, empty: "暂无未完成作业")
            }.frame(maxHeight: .infinity, alignment: .top)
        } else {
            VStack(alignment: .leading, spacing: small ? 4 : 10) {
                overviewSection("课程提醒", symbol: "graduationcap", rows: courseItems, empty: "暂无后续课程")
                Divider().opacity(0.35)
                overviewSection("行事历", symbol: "calendar", rows: calendarItems, empty: "暂无日历事件")
                Divider().opacity(0.35)
                overviewSection("作业提示", symbol: "checklist", rows: homeworkItems, empty: "暂无未完成作业")
            }.frame(maxHeight: .infinity, alignment: .top)
        }
    }

    private func overviewSection(_ title: String, symbol: String, rows: [CampusWidgetItem], empty: String) -> some View {
        VStack(alignment: .leading, spacing: small ? 1 : 5) {
            HStack(spacing: 3) {
                Image(systemName: symbol)
                Text(title).lineLimit(1)
                Spacer(minLength: 0)
                if rows.count > (large ? 2 : 1) { Text("+\(rows.count - (large ? 2 : 1))").monospacedDigit() }
            }.font(.system(size: small ? 8 : 10, weight: .semibold)).foregroundStyle(accent)
            if rows.isEmpty {
                Text(empty).font(.system(size: small ? 10 : 11)).foregroundStyle(.secondary).lineLimit(2)
            } else {
                ForEach(Array(rows.prefix(large ? 2 : 1))) { item in
                    itemLink(item) {
                        VStack(alignment: .leading, spacing: small ? 0 : 3) {
                            Text(item.title).font(.system(size: small ? 11 : 12, weight: .semibold))
                                .foregroundStyle(.primary).lineLimit(small || large ? 1 : 2).privacySensitive()
                            Text(overviewDetail(item)).font(.system(size: small ? 9 : 10, weight: item.isTask ? .medium : .regular))
                                .foregroundStyle(item.isTask ? urgencyColor(item) : .secondary)
                                .lineLimit(small || large ? 1 : 3).monospacedDigit()
                            if large, item.isTask, let status = item.deadlineStatus(at: entry.date) {
                                pressureBar(status, color: urgencyColor(item))
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityElement(children: .combine)
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func overviewDetail(_ item: CampusWidgetItem) -> String {
        if item.isTask {
            guard let status = item.deadlineStatus(at: entry.date) else { return "截止待确认" }
            return status.remainingText + (large ? " · " + deadlineDate(item) : "")
        }
        let datePrefix = item.date == day ? "" : String(item.date.suffix(5)).replacingOccurrences(of: "-", with: "/") + " "
        let time = item.allDay ? "全天" : item.start.map(timeString) ?? "时间待确认"
        let ongoing = item.isOngoing(at: entry.date) ? "进行中 · " : ""
        let place = (item.location ?? "").isEmpty ? "" : " · " + (item.location ?? "")
        return ongoing + datePrefix + time + place
    }

    private func category(_ item: CampusWidgetItem) -> String {
        switch item.kind { case "course": return "课程"; case "task": return "待办"; case "school": return "校历"; default: return "日程" }
    }

    private func agendaRow(_ item: CampusWidgetItem) -> some View {
        HStack(alignment: .top, spacing: small ? 7 : 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(item.allDay ? "全天" : item.start.map(timeString) ?? "—")
                    .font(.system(size: 11, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(accent)
                Text(category(item)).font(.system(size: 9)).foregroundStyle(.secondary)
            }.frame(width: small ? 36 : 44, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.system(size: small ? 12 : 13, weight: .semibold))
                    .foregroundStyle(.primary).lineLimit(small || large ? 2 : 1).privacySensitive()
                if let status = item.deadlineStatus(at: entry.date) {
                    Text(status.remainingText).font(.system(size: 10, weight: .medium))
                        .foregroundStyle(urgencyColor(item)).lineLimit(1).monospacedDigit()
                } else if item.isOngoing(at: entry.date) || !(item.location ?? "").isEmpty {
                    HStack(spacing: 4) {
                        if item.isOngoing(at: entry.date) { Text("进行中").foregroundStyle(accent).fixedSize() }
                        if let location = item.location, !location.isEmpty {
                            Text(location).foregroundStyle(.secondary).lineLimit(1).privacySensitive()
                        }
                    }.font(.system(size: 10))
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.fixedSize(horizontal: false, vertical: true).accessibilityElement(children: .combine)
    }

    private var deadlineCards: some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(Array(items.prefix(limit))) { item in
                itemLink(item) {
                    deadlineCard(item)
                        .padding(small ? 0 : 7)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                        .background(small ? Color.clear : accent.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }.frame(maxHeight: .infinity, alignment: .top)
    }

    private func deadlineCard(_ item: CampusWidgetItem) -> some View {
        VStack(alignment: .leading, spacing: small ? 5 : 3) {
            if let status = item.deadlineStatus(at: entry.date) { urgencyBadge(status, color: urgencyColor(item)) }
            Text(item.title).font(.system(size: small ? 14 : 12, weight: .semibold))
                .foregroundStyle(.primary).lineLimit(2).fixedSize(horizontal: false, vertical: true).privacySensitive()
            Text("截止 " + deadlineDate(item)).font(.system(size: 10)).foregroundStyle(.secondary)
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.9)
            Spacer(minLength: 0)
            if let status = item.deadlineStatus(at: entry.date) {
                remainingLabel(item, status: status).font(.system(size: small ? 15 : 13, weight: .semibold))
                pressureBar(status, color: urgencyColor(item))
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .combine)
    }

    private func deadlineRow(_ item: CampusWidgetItem) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 8) {
                Text(item.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                    .lineLimit(2).privacySensitive().frame(maxWidth: .infinity, alignment: .leading)
                if let status = item.deadlineStatus(at: entry.date) { urgencyBadge(status, color: urgencyColor(item)) }
            }
            HStack(spacing: 8) {
                Text("截止 " + deadlineDate(item)).font(.system(size: 10)).foregroundStyle(.secondary).monospacedDigit().fixedSize()
                Spacer(minLength: 0)
                if let status = item.deadlineStatus(at: entry.date) {
                    remainingLabel(item, status: status, compact: true).font(.system(size: 11, weight: .medium))
                }
            }
            if let status = item.deadlineStatus(at: entry.date) { pressureBar(status, color: urgencyColor(item)) }
        }
        .fixedSize(horizontal: false, vertical: true).accessibilityElement(children: .combine)
    }

    private func deadlineDate(_ item: CampusWidgetItem) -> String {
        guard item.start != nil else { return "待确认" }
        let date = String(item.date.suffix(5)).replacingOccurrences(of: "-", with: "/")
        return date + (item.start.map { " " + timeString($0) } ?? "")
    }

    private func urgencyBadge(_ status: CampusWidgetDeadlineStatus, color: Color) -> some View {
        Text(status.label).font(.system(size: 9, weight: .semibold)).foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 1).background(color.opacity(0.1), in: Capsule()).fixedSize()
    }

    private func remainingLabel(_ item: CampusWidgetItem, status: CampusWidgetDeadlineStatus, compact: Bool = false) -> some View {
        HStack(spacing: 3) {
            if let deadline = item.start, deadline > entry.date, deadline.timeIntervalSince(entry.date) < 86400 {
                Text("剩").fixedSize()
                Text(timerInterval: entry.date...deadline, countsDown: true)
                    .multilineTextAlignment(.leading).frame(maxWidth: compact ? nil : .infinity, alignment: .leading)
                    .fixedSize(horizontal: compact, vertical: false)
            } else { Text(status.remainingText) }
        }.foregroundStyle(urgencyColor(item)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.85)
    }

    private func pressureBar(_ status: CampusWidgetDeadlineStatus, color: Color) -> some View {
        GeometryReader { geometry in
            Capsule().fill(color.opacity(0.12)).overlay(alignment: .leading) {
                Capsule().fill(color).frame(width: geometry.size.width * status.pressure)
            }
        }.frame(height: 3).accessibilityLabel("截止紧迫度，非完成进度")
    }

    private func classContent(_ course: CampusWidgetItem) -> some View {
        let ongoing = course.isOngoing(at: entry.date)
        let boundary = ongoing ? course.end : course.start
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: small ? 4 : 5) {
                if !small { Text(ongoing ? "正在上课" : "即将开始").font(.system(size: 10, weight: .semibold)).foregroundStyle(accent).fixedSize() }
                Text(course.title).font(.system(size: small ? 14 : 18, weight: .semibold)).foregroundStyle(.primary)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true).privacySensitive()
                Text((course.start.map(timeString) ?? "") + (course.end.map { " – " + timeString($0) } ?? ""))
                    .font(.system(size: 10)).foregroundStyle(.secondary).monospacedDigit().lineLimit(1).fixedSize()
                if course.date != day {
                    Text(String(course.date.suffix(5)).replacingOccurrences(of: "-", with: "/"))
                        .font(.system(size: 10, weight: .medium)).foregroundStyle(accent)
                }
                if let location = course.location, !location.isEmpty {
                    Label(location, systemImage: "mappin").font(.system(size: small ? 9 : 10)).foregroundStyle(.secondary).lineLimit(1).privacySensitive()
                }
                Spacer(minLength: 0)
                if small { classCountdown(boundary, ongoing: ongoing) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            if !small {
                VStack(alignment: .leading, spacing: 6) {
                    classCountdown(boundary, ongoing: ongoing)
                    Spacer(minLength: 0)
                    if let next = items.dropFirst().first {
                        Divider().opacity(0.35)
                        Text("之后 · " + (next.start.map(timeString) ?? ""))
                            .font(.system(size: 9)).foregroundStyle(.secondary).monospacedDigit()
                        Text(next.title).font(.system(size: 11, weight: .medium)).foregroundStyle(.primary)
                            .lineLimit(1).privacySensitive()
                    }
                }.padding(10).frame(width: 112, alignment: .leading)
                    .background(accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            }
        }.frame(maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder private func classCountdown(_ boundary: Date?, ongoing: Bool) -> some View {
        if let boundary, boundary > entry.date {
            VStack(alignment: .leading, spacing: 2) {
                Text(ongoing ? "距离下课" : "距离开课").font(.system(size: 9)).foregroundStyle(.secondary)
                Text(timerInterval: entry.date...boundary, countsDown: true)
                    .font(.system(size: small ? 17 : 23, weight: .semibold, design: .rounded))
                    .foregroundStyle(accent).monospacedDigit().multilineTextAlignment(.leading)
                    .lineLimit(1).minimumScaleFactor(0.8).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func emptyContent(icon: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Spacer(minLength: 0)
            Image(systemName: icon).font(.system(size: 22)).foregroundStyle(accent)
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary).lineLimit(2)
            Text(detail).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(small ? 2 : 3)
            Spacer(minLength: 0)
        }
    }

    private var sampleItems: [CampusWidgetItem] {
        func sample(_ id: String, _ title: String, _ kind: String, offset: TimeInterval, duration: TimeInterval? = nil, location: String? = nil) -> CampusWidgetItem {
            let start = entry.date.addingTimeInterval(offset)
            let formatter = ISO8601DateFormatter()
            return CampusWidgetItem(id: id, title: title, kind: kind, source: "preview", date: CampusWidgetSnapshot.dayString(start),
                startAt: formatter.string(from: start), endAt: duration.map { formatter.string(from: start.addingTimeInterval($0)) },
                allDay: false, completed: false, location: location)
        }
        switch mode {
        case .today:
            return [sample("course", "数学 · 函数与图像", "course", offset: 900, duration: 2400, location: "E103"),
                sample("task", "完成化学实验报告", "task", offset: 7200),
                sample("personal", "整理今天的课堂笔记", "personal", offset: 10800)]
        case .deadlines:
            return [sample("task-1", "完成化学实验报告", "task", offset: 2400),
                sample("task-2", "Pre-Calculus Homework", "task", offset: 172800),
                sample("task-3", "整理本周课堂笔记", "task", offset: 345600)]
        case .nextClass:
            return [sample("course-1", "数学 · 函数与图像", "course", offset: 900, duration: 2400, location: "E103"),
                sample("course-2", "English Language Arts", "course", offset: 3600, duration: 2400, location: "E101")]
        }
    }
}

struct CampusTodayWidget: Widget {
    let kind = "CampusDesk.Today"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CampusWidgetProvider()) { CampusWidgetView(entry: $0, mode: .today) }
            .configurationDisplayName("校园总览 · 课程、行事历与作业")
            .description("固定显示课程提醒、行事历事件和作业提示；大号显示更多内容，未注明截止日期的作业也会保留。")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct CampusDeadlinesWidget: Widget {
    let kind = "CampusDesk.Deadlines"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CampusWidgetProvider()) { CampusWidgetView(entry: $0, mode: .deadlines) }
            .configurationDisplayName("作业与待办提示")
            .description("显示未完成作业、个人待办、剩余时间与截止待确认的任务。点击打开待办事项。")
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
