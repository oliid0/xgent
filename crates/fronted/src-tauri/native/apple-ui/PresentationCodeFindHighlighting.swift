import Foundation
import SwiftUI
#if os(iOS)
import UIKit
typealias XgentFindHighlightTextView = UITextView
private typealias XgentFindHighlightColor = UIColor
#else
import AppKit
typealias XgentFindHighlightTextView = NSTextView
private typealias XgentFindHighlightColor = NSColor
#endif

@MainActor
final class XgentCodeFindHighlighting: ObservableObject {
    private typealias Validator = (NSTextLayoutManager, NSTextLayoutFragment) -> Void
    private weak var view: XgentFindHighlightTextView?
    private weak var manager: NSTextLayoutManager?
    private let lease = XgentCodeRenderingLease()
    private var previous: Validator?
    private var previousLease: XgentCodeRenderingLease?
    private var observer: NSObjectProtocol?
    private var decorations: XgentCodeFindDecorations?
    private var index: XgentCodeFindDecorationIndex?
    private var eligible = false
    private var selected = NSRange.zero
    private var paintStyle: XgentCodeFindPaintStyle?
    private var matchColor = XgentFindHighlightColor.clear
    private var scopeColor = XgentFindHighlightColor.clear
    private var selectedColor = XgentFindHighlightColor.clear
    private var syntaxPainter = XgentCodeSyntaxPainter()
    private var syntaxEligible = false
    var session: XgentCodeSessionIdentity?
    var store: XgentCodeSessionStore?
    var owner: UUID?

    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    func attach(_ view: XgentFindHighlightTextView) {
        guard let manager = view.textLayoutManager else { return }
        if self.view === view, self.manager === manager { return }
        detach()
        self.view = view; self.manager = manager
        let prior = manager.renderingAttributesValidator
        previous = prior; previousLease = XgentCodeRenderingLease.current(manager)
        XgentCodeRenderingLease.set(lease, on: manager)
        manager.renderingAttributesValidator = { [weak self] manager, fragment in
            // The prior callback remains captured even after this owner dies.
            // Syntax colors therefore survive a reconstructed native view.
            if let self, self.lease.owns(manager) { self.clear(fragment.rangeInElement, on: manager) }
            prior?(manager, fragment)
            self?.paint(fragment, on: manager)
        }
        observer = NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification,
            object: view.textStorage, queue: .main) { [weak self] _ in
                // OperationQueue.main is the text view's executor. Retire stale
                // ranges before TextKit can validate the next display fragment.
                MainActor.assumeIsolated { self?.sourceChanged() }
            }
    }

    func update(_ configuration: XgentCodeFindConfiguration?, syntax: XgentCodeSyntaxConfiguration? = nil, colorScheme: ColorScheme) {
        let next = configuration?.open == true ? configuration?.decorations : nil
        let nextStyle = XgentCodeFindPaintStyle(colorScheme)
        let nextSelected = selection()
        let changedSyntax = syntaxPainter.update(syntax, colorScheme: colorScheme)
        let changed = next != decorations || nextStyle != paintStyle || nextSelected != selected || changedSyntax
        if next != decorations {
            decorations = next; index = next.map(XgentCodeFindDecorationIndex.init)
        }
        selected = nextSelected
        if nextStyle != paintStyle {
            paintStyle = nextStyle
            matchColor = XgentFindHighlightColor(Color(xgentHex: nextStyle.match))
            scopeColor = XgentFindHighlightColor(Color(xgentHex: nextStyle.scope))
            selectedColor = XgentFindHighlightColor(Color(xgentHex: nextStyle.current))
        }
        let nextEligible = ownsSession && decorations?.source == source()
        let nextSyntaxEligible = ownsSession && syntaxPainter.eligible(source: source())
        if changed || nextEligible != eligible || nextSyntaxEligible != syntaxEligible {
            eligible = nextEligible; syntaxEligible = nextSyntaxEligible; invalidate()
        }
    }

    func detach() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        if let manager, lease.owns(manager) {
            if let storage = manager.textContentManager as? NSTextContentStorage { clear(storage.documentRange, on: manager) }
            manager.renderingAttributesValidator = previous
            XgentCodeRenderingLease.set(previousLease, on: manager)
            if let range = manager.textContentManager?.documentRange { manager.invalidateRenderingAttributes(for: range) }
        }
        manager = nil; view = nil; previous = nil; previousLease = nil
        decorations = nil; index = nil; eligible = false
        syntaxPainter = XgentCodeSyntaxPainter(); syntaxEligible = false
    }

    private var ownsSession: Bool {
        guard let session, let store, let owner else { return true }
        return store.owns(session, owner: owner)
    }
    private func source() -> String? {
        #if os(iOS)
        return view?.text
        #else
        return view?.string
        #endif
    }
    private func selection() -> NSRange {
        #if os(iOS)
        return view?.selectedRange ?? .zero
        #else
        return view?.selectedRange() ?? .zero
        #endif
    }
    private func sourceChanged() {
        guard let manager, lease.owns(manager) else { return }
        eligible = ownsSession && decorations?.source == source()
        syntaxEligible = ownsSession && syntaxPainter.eligible(source: source())
        selected = selection()
        invalidate()
    }
    private func invalidate() {
        guard let manager, lease.owns(manager), let range = manager.textContentManager?.documentRange else { return }
        manager.invalidateRenderingAttributes(for: range)
        #if os(iOS)
        view?.setNeedsDisplay()
        #else
        view?.needsDisplay = true
        #endif
    }
    private func clear(_ range: NSTextRange, on manager: NSTextLayoutManager) {
        manager.removeRenderingAttribute(.backgroundColor, for: range)
        syntaxPainter.clear(range, on: manager)
    }
    private func paint(_ fragment: NSTextLayoutFragment, on manager: NSTextLayoutManager) {
        if lease.owns(manager), ownsSession, syntaxEligible {
            syntaxPainter.paint(fragment, on: manager, font: view?.font)
        }
        guard lease.owns(manager), ownsSession, eligible, let index,
              let storage = manager.textContentManager as? NSTextContentStorage,
              let range = XgentCodeTextKitRange.utf16(fragment.rangeInElement, in: storage) else { return }
        for scope in index.scopes(in: range) {
            if let textRange = XgentCodeTextKitRange.native(scope, in: storage) {
                manager.addRenderingAttribute(.backgroundColor, value: scopeColor, for: textRange)
            }
        }
        for match in index.matches(in: range) {
            if let textRange = XgentCodeTextKitRange.native(match, in: storage) {
                manager.addRenderingAttribute(.backgroundColor, value: matchColor, for: textRange)
            }
        }
        if index.containsMatch(selected) {
            let intersection = NSIntersectionRange(selected, range)
            if intersection.length > 0, let textRange = XgentCodeTextKitRange.native(intersection, in: storage) {
                manager.addRenderingAttribute(.backgroundColor, value: selectedColor, for: textRange)
            }
        }
    }
}
