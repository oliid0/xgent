import SwiftUI

enum XgentImageRotationDraft {
    static func normalized(_ angle: Double) -> Double { (angle.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) }
    static func valid(_ angle: Double) -> Bool {
        angle.isFinite && angle >= 0 && angle < 360 && angle.truncatingRemainder(dividingBy: 90) == 0
    }
    @MainActor static func angle(in document: XgentDocument, model: XgentPresentationModel) -> Double? {
        guard let field = document.node(id: "workspace-file-image-rotation"),
              case .number(let angle) = model.value(field, in: document), valid(angle) else { return nil }
        return angle
    }
    @MainActor static func relative(in document: XgentDocument, model: XgentPresentationModel) -> Double? {
        guard let angle = angle(in: document, model: model),
              let media = document.node(id: "workspace-file-media"), let saved = media.current, valid(saved) else { return nil }
        return normalized(angle - saved)
    }
}
