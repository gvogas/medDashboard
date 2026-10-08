import WidgetKit
import SwiftUI

// Term's widgets: the next exam (home screen and Lock Screen) and today (classes and what is
// due). They redraw from what the app last wrote to the App Group (TermWidgetData), at
// midnight for the new day's countdown, and whenever the app changes something.

struct TermEntry: TimelineEntry {
    let date: Date
    let data: TermWidgetData?
}

struct TermProvider: TimelineProvider {
    func placeholder(in context: Context) -> TermEntry { TermEntry(date: Date(), data: .sample) }

    func getSnapshot(in context: Context, completion: @escaping (TermEntry) -> Void) {
        completion(TermEntry(date: Date(), data: context.isPreview ? .sample : TermWidgetData.load() ?? .sample))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TermEntry>) -> Void) {
        let now = Date()
        let data = TermWidgetData.load()
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86400))
        /* now, and again at midnight so "in 3 days" becomes "in 2 days" without the app */
        let entries = [TermEntry(date: now, data: data), TermEntry(date: midnight, data: data)]
        completion(Timeline(entries: entries, policy: .after(midnight.addingTimeInterval(60))))
    }
}

// ── shared bits ──

struct Message: View {
    let text: String
    var body: some View {
        Text(text).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Signed out, no Pro, or the data itself.
struct Gate<Content: View>: View {
    let entry: TermEntry
    @ViewBuilder let content: (TermWidgetData) -> Content
    var body: some View {
        if let data = entry.data {
            if data.pro { content(data) } else { Message(text: "Widgets come with Term Pro.\nOpen Term to get it.") }
        } else {
            Message(text: "Open Term and sign in.")
        }
    }
}

extension View {
    /// iOS 17's widget background, in the theme's tint.
    func termBackground(_ accent: String?) -> some View {
        containerBackground(for: .widget) { Color(hex: accent ?? "#0F5F58").opacity(0.08) }
    }
}

// ── the next exam ──

struct NextExamView: View {
    @Environment(\.widgetFamily) var family
    let entry: TermEntry

    var body: some View {
        Gate(entry: entry) { data in
            if let exam = data.nextExam, let days = TermDates.days(from: entry.date, to: exam.date), days >= 0 {
                switch family {
                case .accessoryInline:
                    Text(days == 0 ? "\(exam.type) today" : "\(exam.type) in \(days)d · \(exam.course)")
                case .accessoryCircular:
                    VStack(spacing: 0) {
                        Text("\(days)").font(.title2.bold())
                        Text(days == 1 ? "day" : "days").font(.caption2)
                    }
                case .accessoryRectangular:
                    VStack(alignment: .leading, spacing: 1) {
                        Text(days == 0 ? "Today" : "In \(days) day\(days == 1 ? "" : "s")").font(.headline)
                        Text([exam.course, exam.title].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).lineLimit(2)
                    }
                default:
                    VStack(alignment: .leading, spacing: 4) {
                        Text("NEXT \(exam.type.uppercased())").font(.caption2.bold()).foregroundStyle(Color(hex: data.accent))
                        Spacer(minLength: 0)
                        Text(days == 0 ? "Today" : "\(days)").font(.system(size: days == 0 ? 30 : 44, weight: .bold, design: .serif))
                        if days > 0 { Text(days == 1 ? "day to go" : "days to go").font(.caption).foregroundStyle(.secondary) }
                        Spacer(minLength: 0)
                        Text(exam.course.isEmpty ? exam.title : "\(exam.course) · \(exam.title)").font(.caption.weight(.semibold)).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Message(text: family == .accessoryInline ? "No exams ahead" : "No exams or quizzes ahead.")
            }
        }
        .termBackground(entry.data?.accent)
    }
}

struct NextExamWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TermNextExam", provider: TermProvider()) { entry in NextExamView(entry: entry) }
            .configurationDisplayName("Next exam")
            .description("Counts down to your next exam or quiz.")
            .supportedFamilies([.systemSmall, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

// ── today ──

struct TodayView: View {
    @Environment(\.widgetFamily) var family
    let entry: TermEntry

    var body: some View {
        Gate(entry: entry) { data in
            let fresh = data.today == TermDates.iso(entry.date)
            let classLimit = family == .systemLarge ? 5 : 2, dueLimit = family == .systemLarge ? 5 : 2
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Today").font(.headline)
                    Spacer()
                    if data.study.goal > 0 {
                        Text("\(data.study.minutes)/\(data.study.goal) min").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if !fresh {
                    Text("Open Term to see today.").font(.caption).foregroundStyle(.secondary)
                } else if data.classes.isEmpty && data.due.isEmpty {
                    Text("No classes and nothing due this week.").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(Array(data.classes.prefix(classLimit).enumerated()), id: \.offset) { _, c in
                        Row(color: c.color, title: "\(c.course) \(c.kind)", detail: [c.start, c.room].filter { !$0.isEmpty }.joined(separator: " · "))
                    }
                    if !data.due.isEmpty {
                        Text("DUE").font(.caption2.bold()).foregroundStyle(Color(hex: data.accent)).padding(.top, 2)
                        ForEach(Array(data.due.prefix(dueLimit).enumerated()), id: \.offset) { _, d in
                            Row(color: d.color, title: d.course.isEmpty ? d.title : "\(d.course) · \(d.title)", detail: TermDates.label(d.date, from: entry.date))
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .termBackground(entry.data?.accent)
    }

    struct Row: View {
        let color: String, title: String, detail: String
        var body: some View {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 2).fill(Color(hex: color)).frame(width: 4, height: 16)
                Text(title).font(.caption.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 4)
                Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TermToday", provider: TermProvider()) { entry in TodayView(entry: entry) }
            .configurationDisplayName("Today")
            .description("Today's classes and what is due soon.")
            .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct TermWidgetBundle: WidgetBundle {
    var body: some Widget {
        NextExamWidget()
        TodayWidget()
    }
}
