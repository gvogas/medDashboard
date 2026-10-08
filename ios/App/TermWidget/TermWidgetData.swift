import Foundation
import SwiftUI

/// What the app hands the widgets (src/data/widgets.ts, WidgetData), read from the App Group.
struct TermWidgetData: Codable {
    struct Exam: Codable { let title: String; let course: String; let type: String; let date: String; let start: String }
    struct Class: Codable { let course: String; let name: String; let kind: String; let start: String; let end: String; let room: String; let color: String }
    struct Due: Codable { let title: String; let course: String; let type: String; let date: String; let start: String; let color: String }
    struct Study: Codable { let minutes: Int; let goal: Int; let streak: Int }

    let v: Int
    let updatedAt: Double
    let today: String
    let pro: Bool
    let accent: String
    let nextExam: Exam?
    let classes: [Class]
    let due: [Due]
    let study: Study

    static let group = "group.net.vogas.term"

    /// The last data the app wrote, or nil before the first sign-in (or after a sign-out).
    static func load() -> TermWidgetData? {
        guard let json = UserDefaults(suiteName: group)?.string(forKey: "widget"), let bytes = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(TermWidgetData.self, from: bytes)
    }

    static let sample = TermWidgetData(
        v: 1, updatedAt: 0, today: TermDates.iso(Date()), pro: true, accent: "#0F5F58",
        nextExam: Exam(title: "Midterm", course: "BIO101", type: "Exam", date: TermDates.iso(Date().addingTimeInterval(5 * 86400)), start: "10:00"),
        classes: [Class(course: "BIO101", name: "Biology", kind: "Lecture", start: "09:00", end: "10:00", room: "B12", color: "#17B3AE"),
                  Class(course: "CHEM2", name: "Chemistry", kind: "Lab", start: "14:00", end: "16:00", room: "Lab 3", color: "#8B5CC7")],
        due: [Due(title: "Lab report", course: "CHEM2", type: "Assignment", date: TermDates.iso(Date().addingTimeInterval(86400)), start: "23:59", color: "#8B5CC7")],
        study: Study(minutes: 35, goal: 90, streak: 4))
}

enum TermDates {
    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static func iso(_ d: Date) -> String { fmt.string(from: d) }
    static func date(_ s: String) -> Date? { fmt.date(from: s) }

    /// Whole days from `from` to the date `iso`; 0 is today.
    static func days(from: Date, to iso: String) -> Int? {
        guard let target = date(iso) else { return nil }
        let cal = Calendar.current
        return cal.dateComponents([.day], from: cal.startOfDay(for: from), to: cal.startOfDay(for: target)).day
    }

    /// "Today", "Tomorrow", "Fri", "Oct 24".
    static func label(_ iso: String, from: Date) -> String {
        guard let d = date(iso), let n = days(from: from, to: iso) else { return iso }
        if n == 0 { return "Today" }
        if n == 1 { return "Tomorrow" }
        let f = DateFormatter()
        f.dateFormat = n < 7 ? "EEE" : "MMM d"
        return f.string(from: d)
    }
}

extension Color {
    /// "#RRGGBB" as the app stores course colours; grey for anything else.
    init(hex: String) {
        var v: UInt64 = 0
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard s.count == 6, Scanner(string: s).scanHexInt64(&v) else { self = .gray; return }
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}
