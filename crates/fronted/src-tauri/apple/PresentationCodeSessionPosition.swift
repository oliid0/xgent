import CodeEditorView
import Foundation

enum XgentCodeSessionPosition {
    static func clamp(_ position: CodeEditor.Position, in text: String) -> CodeEditor.Position {
        let source = text as NSString, count = source.length
        func boundary(_ offset: Int) -> Int {
            let offset = min(max(0, offset), count)
            if offset > 0, offset < count,
               (0xD800...0xDBFF).contains(source.character(at: offset - 1)),
               (0xDC00...0xDFFF).contains(source.character(at: offset)) { return offset - 1 }
            return offset
        }
        let selections = position.selections.map { range -> NSRange in
            guard range.location != NSNotFound, range.location >= 0, range.length >= 0 else { return .zero }
            let start = boundary(range.location)
            let length = min(range.length, count - start)
            var end = min(start + length, count)
            if end > 0, end < count,
               (0xD800...0xDBFF).contains(source.character(at: end - 1)),
               (0xDC00...0xDFFF).contains(source.character(at: end)) { end += 1 }
            return NSRange(location: start, length: end - start)
        }
        return CodeEditor.Position(selections: selections.isEmpty ? [.zero] : selections,
                                   verticalScrollPosition: position.verticalScrollPosition.isFinite ? max(0, position.verticalScrollPosition) : 0)
    }
}
