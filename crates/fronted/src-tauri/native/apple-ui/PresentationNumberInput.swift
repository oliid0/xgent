import SwiftUI

struct XgentNumberInputConstraints {
    let range: ClosedRange<Double>
    let step: Double

    init?(minimum: Double?, maximum: Double?, step: Double?) {
        guard let minimum, let maximum, let step,
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

/** Native typed numeric entry plus step controls, matching Astryx NumberInput. */
struct XgentNumberInput: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    var body: some View {
        if let limits = XgentNumberInputConstraints(minimum: node.minimum, maximum: node.maximum, step: node.step) {
            let value = Binding<Double>(
                get: {
                    if case .number(let number) = model.value(node, in: document) {
                        return limits.bounded(number) ?? limits.range.lowerBound
                    }
                    return limits.range.lowerBound
                },
                set: { number in
                    guard let bounded = limits.bounded(number) else { return }
                    model.send(node, in: document, value: .number(bounded), editing: true)
                }
            )
            VStack(alignment: .leading, spacing: 8) {
                Text(node.label ?? "").fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 12) {
                    numberField(value)
                        .textFieldStyle(.roundedBorder)
                        .labelsHidden()
                        .accessibilityLabel(node.label ?? "")
                        .frame(minWidth: 60, maxWidth: .infinity)
                    Stepper(node.label ?? "", value: value, in: limits.range, step: limits.step)
                        .labelsHidden()
                        .accessibilityLabel(node.label ?? "")
                        .fixedSize()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .disabled(node.disabled == true)
        }
    }

    @ViewBuilder private func numberField(_ value: Binding<Double>) -> some View {
        #if os(iOS)
        TextField(node.label ?? "", value: value, format: .number)
            .keyboardType((node.step ?? 1) < 1 ? .decimalPad : .numbersAndPunctuation)
        #else
        TextField(node.label ?? "", value: value, format: .number)
        #endif
    }
}
