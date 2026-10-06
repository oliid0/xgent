#if os(iOS)
import AccessibilitySnapshotParser
import SwiftUI
import UIKit
import XCTest
@testable import XgentNativeUI

final class MobileSwitchInteractionTests: XCTestCase {
    @MainActor func testSwitchIdentityTargetsTheActualUIKitControlAndSendsSharedEdits() async throws {
        for width in [CGFloat(240), 320, 430] {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let payload: [String: Any] = [
                    "version": 1, "surface": "settings:voice", "revision": 1,
                    "mode": "sheet", "title": "语音输入", "appearance": "light", "formFactor": "mobile",
                    "nodes": [["id": "voice-general", "kind": "SettingsGroup", "children": [
                        ["id": "voice-enabled", "kind": "Toggle", "label": "Enable voice input · 将语音转换为输入框文字",
                         "text": "The full description wraps without covering the switch. 不会自动发送。",
                         "action": "voice-enabled", "value": false]
                    ]]]
                ]
                let document = try JSONDecoder().decode(XgentDocument.self,
                    from: JSONSerialization.data(withJSONObject: payload))
                try document.validate()
                let model = XgentPresentationModel(); model.update(document)
                var actions: [XgentAction] = []; model.actionSink = { actions.append($0) }
                let content = XgentIOSSheetPresentation(initialDocument: document, model: model)
                    .frame(width: width, height: 780).dynamicTypeSize(size)
                let host = UIHostingController(rootView: content); host.safeAreaRegions = []
                let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 780))
                window.rootViewController = host; window.makeKeyAndVisible()
                defer { model.invalidate(); window.isHidden = true; window.rootViewController = nil }
                host.view.layoutIfNeeded(); try await Task.sleep(for: .milliseconds(200))

                let hierarchy = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view)
                let identified = hierarchy.flattenToElements().filter { $0.identifier == "voice-enabled" }
                XCTAssertEqual(identified.count, 1, "Only the actual switch owns the action identity")
                let frame = try XCTUnwrap(identified.first).shape.bezierPath.bounds
                XCTAssertGreaterThanOrEqual(frame.height, 43.5)
                XCTAssertGreaterThanOrEqual(frame.minX, 0); XCTAssertLessThanOrEqual(frame.maxX, width)
                let control = try XCTUnwrap(switches(in: host.view).first)
                let physicalFrame = control.convert(control.bounds, to: host.view)
                let tap = CGPoint(x: frame.midX, y: frame.midY)
                XCTAssertTrue(physicalFrame.contains(tap),
                    "A normal tap at the accessibility frame's center must hit UISwitch, rather than its label")
                let hit = try XCTUnwrap(host.view.hitTest(tap, with: nil))
                XCTAssertTrue(hit === control || hit.isDescendant(of: control))
                try attachNativeAccessibilityEvidence(hierarchy, name: "voice-switch-\(Int(width))-\(size)")
                try attachCompositedNativeScreenshot(of: host.view, name: "voice-switch-\(Int(width))-\(size)")

                control.setOn(true, animated: false); control.sendActions(for: .valueChanged)
                try await Task.sleep(for: .milliseconds(50))
                XCTAssertEqual(actions.count, 1)
                XCTAssertEqual(actions.last?.action, "voice-enabled")
                XCTAssertEqual(actions.last?.value, .bool(true))
                XCTAssertEqual(model.value(try XCTUnwrap(document.node(id: "voice-enabled")), in: document), .bool(true))
                model.invalidate()
                control.setOn(false, animated: false); control.sendActions(for: .valueChanged)
                try await Task.sleep(for: .milliseconds(50))
                XCTAssertEqual(actions.count, 1, "A retired native switch must not write to shared settings")
            }
        }
    }

    @MainActor private func switches(in view: UIView) -> [UISwitch] {
        (view as? UISwitch).map { [$0] } ?? view.subviews.flatMap { switches(in: $0) }
    }
}
#endif
