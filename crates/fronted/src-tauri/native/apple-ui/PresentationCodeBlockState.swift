import SwiftUI

@MainActor
final class XgentCodeBlockState: ObservableObject {
    @Published var collapsed = false
    @Published var syntax: XgentReadOnlySyntax?
    // Scrolling updates do not invalidate the Markdown document. A remounted
    // code body reads this offset once and restores its own native scroll view.
    var offset = CGPoint.zero
    var contentHeight: CGFloat = 1
}
