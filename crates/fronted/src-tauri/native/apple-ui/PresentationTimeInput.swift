import Foundation
import SwiftUI

/// A wall-clock value; timezone and daylight-saving changes must not alter a saved schedule.
enum XgentTimeOfDay {
    static let timeZone = TimeZone(secondsFromGMT: 0)!
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    static func date(_ value: String) -> Date? {
        guard value.utf8.count == 5,
              value.range(of: #"^([01][0-9]|2[0-3]):[0-5][0-9]$"#, options: .regularExpression) != nil else { return nil }
        let pieces = value.split(separator: ":").compactMap { Int($0) }
        return calendar.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: pieces[0], minute: pieces[1]))
    }

    static func string(_ date: Date) -> String {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }
}

struct XgentTimeInput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        DatePicker(node.label ?? "", selection: Binding(
            get: { XgentTimeOfDay.date(model.value(node, in: document).text) ?? XgentTimeOfDay.date("09:00")! },
            set: { model.send(node, in: document, value: .string(XgentTimeOfDay.string($0)), editing: true) }
        ), displayedComponents: [.hourAndMinute])
        .environment(\.calendar, XgentTimeOfDay.calendar)
        .environment(\.timeZone, XgentTimeOfDay.timeZone)
        .frame(minHeight: 44)
        .disabled(node.disabled == true || model.isBusy(node, in: document))
        .accessibilityIdentifier(node.id)
    }
}
