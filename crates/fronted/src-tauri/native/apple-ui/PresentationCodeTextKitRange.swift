import Foundation
#if os(iOS)
import UIKit
#else
import AppKit
#endif

enum XgentCodeTextKitRange {
    static func native(_ range: NSRange, in storage: NSTextContentStorage) -> NSTextRange? {
        let count = storage.textStorage?.length ?? 0
        guard range.location >= 0, range.length >= 0, range.location <= count,
              range.length <= count - range.location,
              let start = storage.location(storage.documentRange.location, offsetBy: range.location),
              let end = storage.location(start, offsetBy: range.length) else { return nil }
        return NSTextRange(location: start, end: end)
    }
    static func utf16(_ range: NSTextRange, in storage: NSTextContentStorage) -> NSRange? {
        let start = storage.offset(from: storage.documentRange.location, to: range.location)
        let length = storage.offset(from: range.location, to: range.endLocation)
        let count = storage.textStorage?.length ?? 0
        guard start >= 0, length >= 0, start <= count, length <= count - start else { return nil }
        return NSRange(location: start, length: length)
    }
}
