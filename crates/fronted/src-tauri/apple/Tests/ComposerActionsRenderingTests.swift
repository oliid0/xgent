#if os(macOS)
import AppKit
import SwiftUI
import XCTest
@testable import XgentNativeUI

final class ComposerActionsRenderingTests: XCTestCase {
    @MainActor func testComposerFooterFitsAndPlusOpensAboveItsButtonWithARealSkillAction() async throws {
        let accessibility = try NativeMacAccessibilitySession()
        defer { accessibility.restore() }
        for width in [CGFloat(320), CGFloat(768)] {
            let document = try fixture()
            let model = XgentPresentationModel()
            var actions: [XgentAction] = []
            model.actionSink = { actions.append($0) }
            model.update(document)
            let view = VStack {
                Spacer()
                XgentIOSComposerActions(nodes: document.nodes, document: document, model: model)
            }.padding(12).environment(\.accessibilityEnabled, true)
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
            let host = NSHostingView(rootView: view)
            let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: width, height: 640),
                                  styleMask: [.titled], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = host
            window.makeKeyAndOrderFront(nil)
            defer { model.invalidate(); window.close() }
            try await Task.sleep(for: .milliseconds(160))
            host.layoutSubtreeIfNeeded()
            let elements = nativeMacAccessibilityTree(window)
            let bounds = window.convertToScreen(host.convert(host.bounds, to: nil))
            var frames: [CGRect] = []
            for id in ["attach", "command-safety", "model", "runtime-reasoning", "send"] {
                let button = try XCTUnwrap(elements.first {
                    guard $0.accessibilityIdentifier() == id else { return false }
                    let role = $0.accessibilityRole()
                    return role == NSAccessibility.Role.button || role == NSAccessibility.Role.popUpButton || role == NSAccessibility.Role.menuButton
                })
                let frame = button.accessibilityFrame()
                XCTAssertGreaterThan(frame.width, 0, id)
                XCTAssertGreaterThan(frame.height, 0, id)
                XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1, id)
                XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1, id)
                XCTAssertFalse(frames.contains { $0.intersection(frame).width > 1 && $0.intersection(frame).height > 1 }, id)
                frames.append(frame)
            }
            XCTAssertFalse(elements.contains { $0.accessibilityIdentifier() == "model:search" }, "Search belongs in the model popover")
            let add = try XCTUnwrap(elements.first { $0.accessibilityIdentifier() == "attach" && $0.accessibilityRole() == .button })
            let anchor = add.accessibilityFrame()
            XCTAssertTrue(add.accessibilityPerformPress())
            try await Task.sleep(for: .milliseconds(160))
            let popupElements = NSApp.windows.flatMap { nativeMacAccessibilityTree($0) }
            let skill = try XCTUnwrap(popupElements.first { $0.accessibilityIdentifier() == "installed-review" && $0.accessibilityRole() == .button })
            XCTAssertGreaterThanOrEqual(skill.accessibilityFrame().minY, anchor.maxY, "The add panel must open above +")
            XCTAssertTrue(actions.isEmpty, "Opening + must not run an action")
            try attachNativeAccessibilityEvidence(popupElements.map {
                ["id": $0.accessibilityIdentifier() ?? "", "label": $0.accessibilityText() ?? "", "frame": NSStringFromRect($0.accessibilityFrame())]
            }, name: "composer-plus-\(Int(width))")
            XCTAssertTrue(skill.accessibilityPerformPress())
            try await Task.sleep(for: .milliseconds(80))
            XCTAssertEqual(actions.last?.action, "choose-review")
            XCTAssertEqual(actions.last?.value, .null)
        }
    }

    private func fixture() throws -> XgentDocument {
        let payload: [String: Any] = ["version": 1, "surface": "chat", "revision": 1, "mode": "root",
            "title": "Composer", "appearance": "light", "formFactor": "desktop", "nodes": [
                ["id": "attach", "kind": "FilePicker", "variant": "composer-add", "label": "Add", "action": "attach",
                 "options": [["value": "files", "label": "Files"]], "children": [
                    ["id": "plan", "kind": "Switch", "label": "Plan mode", "value": false, "action": "plan"],
                    ["id": "skills", "kind": "Section", "label": "Skills", "children": [
                        ["id": "installed-review", "kind": "Button", "label": "Review", "text": "Review the current project",
                         "icon": "sparkles", "action": "choose-review"]]],
                 ]],
                ["id": "command-safety", "kind": "Selector", "variant": "composer-command-safety", "label": "Access",
                 "value": "ask", "action": "safety", "options": [["value": "ask", "label": "Ask for approval"]]],
                ["id": "composer-spacer", "kind": "Spacer"],
                ["id": "model", "kind": "Selector", "variant": "composer-model", "label": "Model", "text": "Search models",
                 "value": "provider::model", "action": "select-model", "options": [
                    ["value": "provider::model", "label": "Provider · Multilingual model 用户模型", "group": "provider", "groupLabel": "Provider"]]],
                ["id": "runtime-reasoning", "kind": "Selector", "variant": "composer-reasoning", "label": "Thinking",
                 "value": "high", "action": "reasoning", "options": [["value": "high", "label": "High"]]],
                ["id": "send", "kind": "IconButton", "label": "Send", "icon": "arrow.up", "action": "send"],
            ]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
#endif
