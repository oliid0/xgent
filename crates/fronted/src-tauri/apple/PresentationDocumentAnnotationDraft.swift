import Foundation

struct XgentDocumentAnnotationDraft: Codable, Equatable {
    static let maximumLength = 12000
    static let maximumPage = 2147483647
    let text: String
    let page: Int

    var canSave: Bool {
        page >= 1 && page <= Self.maximumPage && text.utf16.count <= Self.maximumLength &&
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var encoded: String? {
        guard canSave, let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func boundedText(_ text: String) -> String {
        guard text.utf16.count > maximumLength else { return text }
        var count = 0
        var end = text.startIndex
        for scalar in text.unicodeScalars {
            let length = scalar.value > 0xFFFF ? 2 : 1
            if count + length > maximumLength { break }
            count += length
            end = text.unicodeScalars.index(after: end)
        }
        return String(text.unicodeScalars[..<end])
    }

    @MainActor static func current(in document: XgentDocument, model: XgentPresentationModel) -> Self? {
        guard let text = document.node(id: "workspace-file-annotation-text"),
              let page = document.node(id: "workspace-file-annotation-page"),
              case .number(let number) = model.value(page, in: document), number.isFinite,
              number.rounded() == number, number >= 1, number <= Double(maximumPage) else { return nil }
        return Self(text: model.value(text, in: document).text, page: Int(number))
    }
}
