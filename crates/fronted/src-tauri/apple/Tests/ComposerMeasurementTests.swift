import SwiftUI
import XCTest
@testable import XgentNativeUI

final class ComposerMeasurementTests: XCTestCase {
    @MainActor func testUnboundedLayoutProbesPreserveFiniteTextKitGeometryAndSelection() throws {
        let state = XgentComposerFieldState()
        let configuration = XgentComposerFieldConfiguration(
            readText: { "Native draft with multiple words" },
            canonicalText: "Native draft with multiple words", references: "[]", readReferences: { [] },
            pasteRules: "", selectionRequest: nil, focusRequest: nil, lease: "measurement",
            label: "Message", identifier: "draft", disabled: false, fontFamily: nil, fontSize: 17,
            palette: XgentPresentationTheme.fallback.palette(for: .light), fieldState: state,
            consumeFocus: { false }, edit: { _, _, _ in }, select: { _, _ in }, key: { _ in .ignored })
        let coordinator = XgentComposerNativeCoordinator(configuration)
        defer { coordinator.retire() }
        coordinator.configure(configuration)
        let initial = coordinator.size(width: 240)
        #if os(iOS)
        coordinator.view.selectedRange = NSRange(location: 7, length: 0)
        let selected = coordinator.view.selectedRange
        #else
        coordinator.view.setSelectedRange(NSRange(location: 7, length: 0))
        let selected = coordinator.view.selectedRange()
        #endif
        let frame = coordinator.view.frame
        let probes: [CGFloat] = [.infinity, -.infinity, .nan, .greatestFiniteMagnitude]
        for probe in probes {
            let measured = coordinator.size(width: probe)
            XCTAssertEqual(measured, initial)
            XCTAssertEqual(coordinator.view.frame, frame, "A maximum-size probe must not resize the native editor")
            XCTAssertTrue(measured.width.isFinite && measured.height.isFinite)
            #if os(iOS)
            XCTAssertEqual(coordinator.view.selectedRange, selected)
            #else
            XCTAssertEqual(coordinator.view.selectedRange(), selected)
            XCTAssertEqual(coordinator.view.textContainer?.containerSize.width, initial.width)
            #endif
        }
        let resized = coordinator.size(width: 480)
        XCTAssertEqual(resized.width, 480)
        XCTAssertTrue(resized.height.isFinite)
        XCTAssertEqual(coordinator.size(width: .infinity), resized,
                       "The next split-view probe uses the accepted finite viewport")
    }
}
