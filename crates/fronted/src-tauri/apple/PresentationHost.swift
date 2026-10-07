import Foundation
import ObjectiveC
import SwiftUI
import WebKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor
private final class XgentPresentationHost: NSObject {
    static var associationKey: UInt8 = 0
    let model: XgentPresentationModel
    private var constraints: [NSLayoutConstraint] = []
    #if os(iOS)
    let controller: UIHostingController<XgentPresentationView>
    #else
    let controller: NSHostingController<XgentPresentationView>
    private let nativeContainer: XgentNativePresentationContainer
    private let accessibilityBoundary: XgentPresentationAccessibilityBoundary
    private let windowChrome: XgentDesktopWindowChrome
    #endif

    init?(webview: WKWebView, parent: UnsafeMutableRawPointer?) {
        let model = XgentPresentationModel()
        self.model = model
        #if os(iOS)
        guard let parent else { return nil }
        let parentController = Unmanaged<UIViewController>.fromOpaque(parent).takeUnretainedValue()
        controller = UIHostingController(rootView: XgentPresentationView(model: model))
        #else
        guard let container = webview.superview else { return nil }
        controller = NSHostingController(rootView: XgentPresentationView(model: model))
        // The Tauri container determines all four bounds. Content-derived
        // hosting constraints feed GeometryReader/sidebar measurements back
        // into AppKit and can grow the window indefinitely during a toggle.
        controller.sizingOptions = []
        nativeContainer = XgentNativePresentationContainer(hostedView: controller.view)
        accessibilityBoundary = XgentPresentationAccessibilityBoundary(transport: webview)
        windowChrome = XgentDesktopWindowChrome(model: model)
        #endif
        super.init()
        #if os(macOS)
        nativeContainer.windowChanged = { [weak self] in self?.updateVisibility() }
        #endif
        model.webview = webview
        #if os(iOS)
        parentController.addChild(controller)
        let container = parentController.view!
        controller.view.backgroundColor = .clear
        container.addSubview(controller.view)
        #else
        container.addSubview(nativeContainer, positioned: .above, relativeTo: webview)
        #endif
        hostView.translatesAutoresizingMaskIntoConstraints = false
        #if os(macOS)
        let topConstraint = hostView.topAnchor.constraint(equalTo: container.safeAreaLayoutGuide.topAnchor)
        #else
        let topConstraint = hostView.topAnchor.constraint(equalTo: container.topAnchor)
        #endif
        constraints = [
            hostView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            hostView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            topConstraint,
            hostView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ]
        NSLayoutConstraint.activate(constraints)
        #if os(iOS)
        controller.didMove(toParent: parentController)
        #endif
    }

    #if os(iOS)
    private var hostView: UIView { controller.view }
    #else
    private var hostView: NSView { nativeContainer }
    #endif

    func detach(from webview: WKWebView) {
        // Invalidate callbacks before SwiftUI dismisses sheets and bindings.
        model.invalidate()
        #if os(iOS)
        controller.dismiss(animated: false)
        controller.willMove(toParent: nil)
        #endif
        NSLayoutConstraint.deactivate(constraints)
        constraints.removeAll()
        hostView.removeFromSuperview()
        #if os(iOS)
        controller.removeFromParent()
        webview.isUserInteractionEnabled = true
        webview.accessibilityElementsHidden = false
        #else
        windowChrome.detach()
        accessibilityBoundary.reset()
        webview.setAccessibilityHidden(false)
        #endif
        webview.isHidden = false
    }

    func updateVisibility() {
        hostView.isHidden = model.documents.isEmpty
        // The opaque SwiftUI root covers the shared TypeScript execution host.
        // Do not hide WKWebView: WebKit can suspend animation-frame callbacks
        // used by the shared runtime when its view is hidden.
        let nativeRoot = model.documents.contains { $0.mode == .root }
        #if os(iOS)
        model.webview?.isUserInteractionEnabled = !nativeRoot
        model.webview?.accessibilityElementsHidden = nativeRoot
        #else
        if nativeRoot, let window = hostView.window { windowChrome.install(on: window) }
        else { windowChrome.detach() }
        accessibilityBoundary.update(nativeRoot: nativeRoot)
        #endif
    }
}

@_cdecl("xgent_native_ui_reset")
@MainActor
public func xgentNativeUIReset(_ webviewPointer: UnsafeMutableRawPointer?) {
    guard let webviewPointer else { return }
    let webview = Unmanaged<WKWebView>.fromOpaque(webviewPointer).takeUnretainedValue()
    guard let host = objc_getAssociatedObject(webview, &XgentPresentationHost.associationKey) as? XgentPresentationHost else { return }
    host.detach(from: webview)
    objc_setAssociatedObject(webview, &XgentPresentationHost.associationKey, nil, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
}

@_cdecl("xgent_native_ui_update")
@MainActor
public func xgentNativeUIUpdate(_ webviewPointer: UnsafeMutableRawPointer?,
                               _ parent: UnsafeMutableRawPointer?,
                               _ payload: UnsafePointer<CChar>?, _ actionResult: Bool) -> Int32 {
    guard let webviewPointer, let payload else { return 1 }
    let webview = Unmanaged<WKWebView>.fromOpaque(webviewPointer).takeUnretainedValue()
    let data = Data(String(cString: payload).utf8)
    do {
        let existing = objc_getAssociatedObject(webview, &XgentPresentationHost.associationKey) as? XgentPresentationHost
        if actionResult {
            let result = try JSONDecoder().decode(XgentActionResult.self, from: data)
            existing?.model.complete(result)
            return 0
        }
        let document = try JSONDecoder().decode(XgentDocument.self, from: data)
        try document.validate()
        if document.removed == true, existing == nil { return 0 }
        guard let host = existing ?? XgentPresentationHost(webview: webview, parent: parent) else { return 1 }
        if existing == nil {
            objc_setAssociatedObject(webview, &XgentPresentationHost.associationKey, host, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        }
        host.model.update(document)
        host.updateVisibility()
        return 0
    } catch {
        return 2
    }
}
