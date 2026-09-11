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
    #if os(iOS)
    let controller: UIHostingController<XgentPresentationView>
    #else
    let controller: NSHostingController<XgentPresentationView>
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
        #endif
        super.init()
        model.webview = webview
        #if os(iOS)
        parentController.addChild(controller)
        let container = parentController.view!
        controller.view.backgroundColor = .clear
        container.addSubview(controller.view)
        controller.didMove(toParent: parentController)
        #else
        container.addSubview(controller.view, positioned: .above, relativeTo: webview)
        #endif
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: container.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
    }

    func updateVisibility() {
        controller.view.isHidden = model.documents.isEmpty
        // WKWebView remains the shared TypeScript execution host. Its pixels,
        // accessibility elements and controls are removed when the native root owns the UI.
        let nativeRoot = model.documents.contains { $0.mode == .root }
        model.webview?.isHidden = nativeRoot
        #if os(iOS)
        model.webview?.accessibilityElementsHidden = nativeRoot
        #else
        model.webview?.setAccessibilityHidden(nativeRoot)
        #endif
    }
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
