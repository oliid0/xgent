import SwiftUI

struct XgentNumberInputConstraints: Equatable {
    let range: ClosedRange<Double>
    let step: Double
    let maximum: Double?

    init?(minimum: Double?, maximum: Double?, step: Double?, allowsUnboundedMaximum: Bool = false) {
        self.maximum = maximum
        guard let minimum, let maximum = maximum ?? (allowsUnboundedMaximum ? Double.greatestFiniteMagnitude : nil), let step,
              minimum.isFinite, maximum.isFinite, step.isFinite,
              minimum <= maximum, step > 0 else { return nil }
        self.range = minimum...maximum
        self.step = step
    }

    func bounded(_ value: Double) -> Double? {
        guard value.isFinite else { return nil }
        return min(range.upperBound, max(range.lowerBound, value))
    }
}

/** Native whole-draft numeric entry; scrolling never changes a settings value. */
struct XgentNumberInput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentSettingsRow) private var isSettingsRow

    var body: some View {
        if let limits = XgentNumberInputConstraints(minimum: node.minimum, maximum: node.maximum, step: node.step,
                                                   allowsUnboundedMaximum: node.clearable == true) {
            Group {
                if isSettingsRow {
                    XgentSettingsValueRow(node: node) { editor(limits, inline: true) }
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        XgentFieldLabel(node: node)
                        editor(limits, inline: false)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .disabled(node.disabled == true || model.hasNumberCommitBatch(in: document))
        }
    }

    private func editor(_ limits: XgentNumberInputConstraints, inline: Bool) -> some View {
        XgentNumberInputEditor(node: node, document: document, model: model, limits: limits)
            .id([document.surface, node.id, node.action ?? ""])
            .frame(width: inline ? 160 : nil)
            .frame(minWidth: 60, maxWidth: inline ? nil : .infinity)
    }
}
