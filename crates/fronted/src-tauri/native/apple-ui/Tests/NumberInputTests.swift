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

final class NumberInputTests: XCTestCase {
    func testFiniteLimitsAndValueClampingDoNotRoundFractionalMeasurementInputs() throws {
        let limits = try XCTUnwrap(XgentNumberInputConstraints(minimum: 5, maximum: 3600, step: 1))
        XCTAssertEqual(limits.bounded(0), 5)
        XCTAssertEqual(limits.bounded(9000), 3600)
        XCTAssertEqual(limits.bounded(12.5), 12.5)
        XCTAssertNil(limits.bounded(.nan))
        XCTAssertNil(limits.bounded(.infinity))
        XCTAssertNil(XgentNumberInputConstraints(minimum: nil, maximum: 10, step: 1))
        XCTAssertNil(XgentNumberInputConstraints(minimum: 10, maximum: 1, step: 1))
        XCTAssertNil(XgentNumberInputConstraints(minimum: 1, maximum: .infinity, step: 1))
        XCTAssertNil(XgentNumberInputConstraints(minimum: 1, maximum: 10, step: 0))
        XCTAssertNil(XgentNumberInputConstraints(minimum: 1, maximum: 10, step: .nan))
    }

    func testNumericDocumentRejectsMissingBoundsAndValuesOutsideTheNativeRange() throws {
        for extra in [["value": "12"], ["value": 4000], ["minimum": 4000], ["maximum": NSNull()], ["step": 0]] as [[String: Any]] {
            let document = try decode(extra: extra)
            XCTAssertThrowsError(try document.validate())
        }
        try decode().validate()
    }

    @MainActor
    func testNativeNumericEntryAndStepperRenderAtNarrowAndWideWidths() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        #else
        let widths: [CGFloat] = [640, 1040]
        #endif
        let document = try decode()
        let model = XgentPresentationModel()
        model.update(document)
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                let content = XgentNumberInput(node: document.nodes[0], document: document, model: model)
                    .environment(\.dynamicTypeSize, size)
                    .environment(\.xgentSettingsRow, true)
                    .padding(16)
                    .frame(width: width, height: 260)
                #if os(iOS)
                let hosting = UIHostingController(rootView: content)
                hosting.view.frame = CGRect(x: 0, y: 0, width: width, height: 260)
                hosting.view.layoutIfNeeded()
                XCTAssertLessThanOrEqual(hosting.sizeThatFits(in: CGSize(width: width, height: 260)).width, width + 1)
                let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 260))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(hosting.view).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 1000)
                #else
                let hosting = NSHostingView(rootView: content)
                hosting.frame = CGRect(x: 0, y: 0, width: width, height: 260)
                hosting.layoutSubtreeIfNeeded()
                XCTAssertLessThanOrEqual(hosting.fittingSize.width, width + 1)
                let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 260))
                let image = await withCheckedContinuation { continuation in
                    strategy.snapshot(hosting).run { continuation.resume(returning: $0) }
                }
                XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 1000)
                #endif
                XCTAssertEqual(image.size.width, width)
                let attachment = XCTAttachment(image: image)
                attachment.name = "numeric-input-\(Int(width))-\(size)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
        model.invalidate()
    }

    private func decode(extra: [String: Any] = [:]) throws -> XgentDocument {
        var node: [String: Any] = ["id": "cooldown", "kind": "NumberInput", "action": "cooldown",
            "label": "Cooldown in seconds before retrying a failed provider", "value": 300,
            "minimum": 5, "maximum": 3600, "step": 1]
        node.merge(extra) { _, new in new }
        let data: [String: Any] = ["version": 1, "surface": "numeric-input", "revision": 1,
            "mode": "sheet", "appearance": "light", "title": "Runtime settings", "nodes": [node]]
        return try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: data))
    }
}
