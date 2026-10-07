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
        #if os(macOS)
        let containerWidth = coordinator.view.textContainer?.containerSize.width
        let contents = coordinator.view.attributedString().copy() as! NSAttributedString
        #endif
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
            XCTAssertEqual(coordinator.view.textContainer?.containerSize.width, containerWidth)
            #endif
        }
        let resized = coordinator.size(width: 480)
        XCTAssertEqual(resized.width, 480)
        XCTAssertTrue(resized.height.isFinite)
        #if os(macOS)
        let finiteProbes: [CGFloat] = [44, 240, 480, 320, 480]
        for probe in finiteProbes {
            XCTAssertTrue(coordinator.size(width: probe).height.isFinite)
            XCTAssertEqual(coordinator.view.frame, frame, "Finite fitting proposals must not resize the live editor")
            XCTAssertEqual(coordinator.view.textContainer?.containerSize.width, containerWidth)
            XCTAssertEqual(coordinator.view.selectedRange(), selected)
            XCTAssertTrue(coordinator.view.attributedString().isEqual(to: contents))
        }
        #endif
        XCTAssertEqual(coordinator.size(width: .infinity), resized,
                       "The next split-view probe uses the accepted finite viewport")
    }
}
