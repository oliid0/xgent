import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class ControlRenderingTests: XCTestCase {
    @MainActor
    func testCustomInterfaceFontScalesOnceLikeTheSystemFont() async throws {
        let fixture = try document(nodes: [node("font-label", "Text", ["text": "Settings"])])
        let base = XgentPresentationTheme.fallback
        let family = "Helvetica Neue"
        XCTAssertNotNil(XgentFonts.name(for: family))
        let custom = XgentPresentationTheme(light: base.light, dark: base.dark, radius: base.radius,
            spacing: base.spacing, control: base.control, typography: base.typography,
            motion: base.motion, material: base.material, fontScale: base.fontScale,
            fontFamily: family, codeFontFamily: base.codeFontFamily)
        for size in [DynamicTypeSize.large, .accessibility3] {
            func label(_ theme: XgentPresentationTheme) -> some View {
                Text("Settings")
                    .modifier(XgentControlTypography(node: fixture.nodes[0]))
                    .environment(\.xgentPresentationTheme, theme)
                    .dynamicTypeSize(size)
            }
            let system = try await fitted(label(base), width: 768)
            let chosen = try await fitted(label(custom), width: 768)
            XCTAssertGreaterThan(chosen.height, system.height * 0.7)
            XCTAssertLessThan(chosen.height, system.height * 1.4,
                "Choosing a font must not apply a second accessibility text scale")
        }
    }

    @MainActor
    func testButtonsHugContentInSheetsAndWrapLongLabelsWithoutShrinkingText() async throws {
        var shortSizes: [CGSize] = []
        for mode in ["root", "sheet"] {
            let document = try document(mode: mode, nodes: [node("save", "Button", ["label": "Save", "action": "save"])])
            let model = XgentPresentationModel()
            model.update(document)
            let short = try await fitted(render(document.nodes[0], document, model), width: 320)
            shortSizes.append(short)
            XCTAssertLessThan(short.width, 160, "Being in a sheet must not make every button fill its row")
            #if os(iOS)
            XCTAssertGreaterThanOrEqual(short.height, 44)
            #endif
            let longDocument = try self.document(mode: mode, nodes: [node("long", "Button", [
                "label": "Install the selected Shell environment and required software packages", "action": "install",
            ])])
            model.update(longDocument)
            let long = try await fitted(render(longDocument.nodes[0], longDocument, model).frame(width: 140), width: 140)
            XCTAssertGreaterThan(long.height, short.height + 20, "Long actions need real multiline layout")
        }
        XCTAssertEqual(shortSizes[0].width, shortSizes[1].width, accuracy: 1)
        XCTAssertEqual(shortSizes[0].height, shortSizes[1].height, accuracy: 1)
    }

    @MainActor
    func testFilledFieldInHorizontalToolbarDoesNotClaimTheScreenHeight() async throws {
        let document = try document(nodes: [node("toolbar", "HStack", ["spacing": 8, "children": [
            node("address", "TextInput", ["label": "Address", "value": "https://example.com", "variant": "compact", "fill": true, "action": "address"]),
            node("go", "Button", ["label": "Go", "action": "go"]),
        ]])])
        let model = XgentPresentationModel()
        model.update(document)
        let size = try await fitted(render(document.nodes[0], document, model), width: 320)
        XCTAssertLessThan(size.height, 100, "A width-filling toolbar field must not stretch vertically")
        XCTAssertGreaterThanOrEqual(size.height, 40)
    }

    @MainActor
    func testWorkActivityTitlesWrapInsteadOfShrinkingOrTruncating() async throws {
        let model = XgentPresentationModel()
        let short = try document(nodes: [node("tool", "ToolCall", [
            "label": "Checking", "variant": "timeline", "status": "running",
        ])])
        model.update(short)
        let shortSize = try await fitted(XgentToolCallHeader(node: short.nodes[0]).frame(width: 180), width: 180)
        let long = try document(nodes: [node("tool", "ToolCall", [
            "label": "Used the GitHub integration to edit multiple workspace files and run the relevant verification commands",
            "variant": "timeline", "status": "running",
        ])])
        model.update(long)
        let longSize = try await fitted(XgentToolCallHeader(node: long.nodes[0]).frame(width: 180), width: 180)
        XCTAssertGreaterThan(longSize.height, shortSize.height + 20,
            "Work activity titles must remain readable while evidence is streaming")
        XCTAssertLessThanOrEqual(longSize.width, 181)
    }

    @MainActor
    func testActualControlFamiliesAtNarrowWideDarkAndLargeTextSizes() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        #else
        let widths: [CGFloat] = [640, 1040]
        #endif
        for family in ["actions", "fields", "choices", "provider-models"] {
            for width in widths {
                for size in [DynamicTypeSize.large, .accessibility3] {
                    let document = try document(nodes: fixtures(family))
                    let model = XgentPresentationModel()
                    model.update(document)
                    let view = ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            ForEach(document.nodes) { self.render($0, document, model) }
                        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(width: width, height: 720)
                    .dynamicTypeSize(size)
                    .background { XgentThemeBackground() }
                    .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: size == .large ? .light : .dark))
                    #if os(iOS)
                    let host = UIHostingController(rootView: view)
                    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
                    window.rootViewController = host
                    window.makeKeyAndVisible()
                    defer { window.isHidden = true; window.rootViewController = nil }
                    host.view.layoutIfNeeded()
                    try await Task.sleep(nanoseconds: 100_000_000)
                    let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                    }
                    XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 2_000)
                    #else
                    let host = NSHostingView(rootView: view)
                    host.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                    host.layoutSubtreeIfNeeded()
                    let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(host).run { continuation.resume(returning: $0) }
                    }
                    XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 2_000)
                    #endif
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "controls-\(family)-\(Int(width))-\(size == .large ? "standard" : "accessibility-dark")"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
        }
    }

    #if os(iOS)
    @MainActor
    func testAdaptedSecureFieldUsesTheRealEditBridgeAndRetiredControlsCannotWrite() async throws {
        let document = try document(nodes: [node("password", "TextInput", [
            "label": "API key", "value": "", "secure": true, "action": "key",
        ])])
        let model = XgentPresentationModel()
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        model.update(document)
        let host = UIHostingController(rootView: XgentTextInput(node: document.nodes[0], document: document, model: model))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 720))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        try await Task.sleep(nanoseconds: 300_000_000)
        let nativeFields = textFields(in: window)
        let diagnostic = XCTAttachment(string: nativeFields.map { field in
            "id=\(field.accessibilityIdentifier ?? "nil") class=\(type(of: field)) secure=\(field.isSecureTextEntry) AX=\(field.isAccessibilityElement) hidden=\(field.isHidden) frame=\(field.frame) delegate=\(String(describing: field.delegate)) targets=\(field.allTargets.count)"
        }.joined(separator: "\n"))
        diagnostic.name = "secure-field-native-control-identity"
        diagnostic.lifetime = .keepAlways
        add(diagnostic)
        let field = try XCTUnwrap(textField(in: window, identifier: "password"))
        XCTAssertTrue(field.delegate is XgentIOSSecretField.Coordinator)
        XCTAssertFalse(field.allTargets.isEmpty)
        XCTAssertTrue(field.isSecureTextEntry)
        XCTAssertEqual(field.autocapitalizationType, .none)
        XCTAssertEqual(field.autocorrectionType, .no)
        XCTAssertEqual(field.textContentType, .oneTimeCode)
        XCTAssertTrue(field.becomeFirstResponder())
        // Allow SwiftUI to finish its focus update before delivering the edit.
        try await Task.sleep(nanoseconds: 100_000_000)
        field.insertText("test-key")
        field.sendActions(for: .editingChanged)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(field.text, "test-key")
        XCTAssertEqual(actions.last?.action, "key")
        XCTAssertEqual(actions.last?.value, .string("test-key"))
        let before = actions.count
        model.invalidate()
        field.insertText("stale-key")
        field.sendActions(for: .editingChanged)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(actions.count, before)
    }

    @MainActor private func textField(in view: UIView, identifier: String) -> UITextField? {
        if let field = view as? UITextField, field.accessibilityIdentifier == identifier { return field }
        for child in view.subviews { if let field = textField(in: child, identifier: identifier) { return field } }
        return nil
    }
    @MainActor private func textFields(in view: UIView) -> [UITextField] {
        (view as? UITextField).map { [$0] } ?? view.subviews.flatMap { textFields(in: $0) }
    }
    #endif

    @MainActor private func fitted<V: View>(_ view: V, width: CGFloat) async throws -> CGSize {
        let content = view.modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
        #if os(iOS)
        let host = UIHostingController(rootView: content)
        // Measure the control, excluding the simulator window's status-bar inset.
        host.safeAreaRegions = []
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 720))
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        host.view.layoutIfNeeded()
        try await Task.sleep(nanoseconds: 100_000_000)
        return host.sizeThatFits(in: CGSize(width: width, height: 720))
        #else
        let host = NSHostingView(rootView: content)
        host.frame = CGRect(x: 0, y: 0, width: width, height: 720)
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(nanoseconds: 100_000_000)
        return host.fittingSize
        #endif
    }

    @MainActor @ViewBuilder private func render(_ node: XgentNode, _ document: XgentDocument, _ model: XgentPresentationModel) -> some View {
        #if os(iOS)
        XgentIOSNode(node: node, document: document, model: model)
        #else
        XgentNodeView(node: node, document: document, model: model)
        #endif
    }

    private func fixtures(_ family: String) -> [[String: Any]] {
        if family == "provider-models" {
            return [false, true].map { selecting in
                let suffix = selecting ? "selection" : "enabled"
                let label = "relay/大上下文模型-with-a-long-provider-and-model-identifier"
                let control = selecting
                    ? node("model-select:\(suffix)", "Button", ["label": label, "selected": true,
                        "variant": "model-selection", "action": "select-model"])
                    : node("model:\(suffix)", "Switch", ["label": label, "value": true, "action": "enable-model"])
                return node("model-row:\(suffix)", "VStack", ["variant": "provider-model-row", "children": [
                    control,
                    node("model-limits:\(suffix)", "Text", ["text": "1000K ctx · 64K out", "size": "small",
                        "accessibilityLabel": "Context Window: 1000000. Max Output Token: 64000"]),
                    node("model-actions:\(suffix)", "Menu", ["label": "Model settings", "icon": "ellipsis",
                        "variant": "compact", "children": [
                            node("model-edit:\(suffix)", "Button", ["label": "Edit model settings", "action": "edit-model"]),
                            node("model-delete:\(suffix)", "Button", ["label": "Delete model", "destructive": true, "action": "delete-model"]),
                        ]]),
                ]])
            }
        }
        if family == "actions" {
            return [node("actions", "HStack", ["wrap": true, "spacing": 8, "children": [
                node("primary", "Button", ["label": "Save", "variant": "primary", "action": "save"]),
                node("secondary", "Button", ["label": "Test connection", "action": "test"]),
                node("ghost", "Button", ["label": "Copy", "variant": "ghost", "action": "copy"]),
                node("delete", "Button", ["label": "Delete", "destructive": true, "action": "delete"]),
                node("disabled", "Button", ["label": "Installing packages", "disabled": true, "action": "install"]),
                node("more", "Menu", ["label": "More actions", "children": [node("menu-copy", "Button", ["label": "Copy output", "action": "menu-copy"])]]),
                node("icon", "IconButton", ["label": "Open sidebar", "icon": "xgent.sidebar", "variant": "ghost", "action": "sidebar"]),
            ]])]
        }
        if family == "fields" {
            return [
                node("name", "TextInput", ["label": "Workspace name", "value": "Fort Mason", "action": "name"]),
                node("password", "TextInput", ["label": "Provider API key", "value": "test-key", "secure": true, "action": "password"]),
                node("notes", "TextArea", ["label": "Instructions for this workspace", "value": "Review changes and preserve local work.", "action": "notes"]),
            ]
        }
        let options: [[String: Any]] = [["value": "local", "label": "On this device"], ["value": "desktop", "label": "Delegate to desktop"], ["value": "cloud", "label": "Cloud execution", "disabled": true]]
        return [
            node("execution", "Selector", ["label": "Execution environment", "value": "local", "action": "execution", "options": options]),
            node("segments", "SegmentedControl", ["label": "Execution mode", "value": "local", "action": "segments", "options": options]),
            node("memory", "Switch", ["label": "Enable persistent memory for this workspace", "value": true, "action": "memory"]),
            node("limit", "NumberInput", ["label": "Maximum retry attempts", "value": 3, "minimum": 0, "maximum": 10, "step": 1, "action": "limit"]),
            node("time", "TimeInput", ["label": "Scheduled backup time", "value": "09:30", "action": "time"]),
            node("font", "Slider", ["label": "Font scale", "value": 1, "minimum": 0.8, "maximum": 1.4, "step": 0.1, "action": "font"]),
            node("accent", "ColorInput", ["label": "Light appearance accent", "value": "#abcdef", "action": "accent",
                "accessibilityHint": "Enter a color in #RRGGBB format."]),
        ]
    }

    private func node(_ id: String, _ kind: String, _ values: [String: Any]) -> [String: Any] {
        var result: [String: Any] = ["id": id, "kind": kind]
        result.merge(values) { _, new in new }
        return result
    }

    private func document(mode: String = "root", nodes: [[String: Any]]) throws -> XgentDocument {
        let json: [String: Any] = ["version": 1, "surface": "controls", "revision": 1, "mode": mode,
                                  "title": "Controls", "appearance": "light", "nodes": nodes]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        return document
    }
}
