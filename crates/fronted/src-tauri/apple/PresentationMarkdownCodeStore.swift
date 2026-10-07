import MarkdownUI
import SwiftUI

// MarkdownUI keys inner blocks by their content hash. Keep interaction state
// outside that subtree so unique streamed code nodes can grow without resetting.
@MainActor
final class XgentMarkdownCodeStore: ObservableObject {
    struct Entry {
        let code: XgentMarkdownCodeEntry
        let state: XgentCodeBlockState
        let diagram: XgentDiagramState
    }

    private var source: String?
    private var content = MarkdownContent("")
    private var entries: [Entry] = []

    func prepare(_ source: String) -> MarkdownContent {
        if let current = self.source, current.utf16.elementsEqual(source.utf16) { return content }
        let content = MarkdownContent(source)
        let next = XgentMarkdownCodeEntry.parse(content.renderHTML())
        entries = next.enumerated().map { index, code in
            let old = entries.indices.contains(index) ? entries[index] : nil
            let keepsState = old.map { previous in
                previous.code.language == code.language &&
                    (code.content.utf16.starts(with: previous.code.content.utf16) || previous.code.content.utf16.starts(with: code.content.utf16))
            } ?? false
            return Entry(code: code, state: keepsState ? old?.state ?? XgentCodeBlockState() : XgentCodeBlockState(),
                         diagram: keepsState ? old?.diagram ?? XgentDiagramState() : XgentDiagramState())
        }
        self.source = source; self.content = content
        return content
    }

    func entry(content: String, language: String?) -> Entry? {
        let name = XgentMarkdownCodeEntry.languageName(language)
        let matches = entries.filter { $0.code.content.utf16.elementsEqual(content.utf16) && $0.code.language == name }
        // The upstream configuration exposes no ordinal. Identical nested
        // fences keep independent local state instead of sharing a disclosure.
        return matches.count == 1 ? matches.first : nil
    }
}
