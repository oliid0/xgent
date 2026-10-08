import Foundation
import SwiftTerm
import XCTest
@testable import XgentNativeUI

final class TerminalInteractionTests: XCTestCase {
    func testPacketRejectsInvalidOffsetsAndPreservesBinaryInput() throws {
        XCTAssertNotNil(XgentTerminalPacket.decode(try packet("session", bytes: [0, 27, 255])))
        XCTAssertNil(XgentTerminalPacket.decode("{}"))
        XCTAssertNil(XgentTerminalPacket.decode(try packet("", bytes: [1])))
        XCTAssertNil(XgentTerminalPacket.decode(try packet("session", bytes: [1], start: -1)))
        XCTAssertNil(XgentTerminalPacket.decode(try packet("session", bytes: [1], end: 10)))
        let payload = try XCTUnwrap(XgentTerminalEvent.input(sessionId: "session", bytes: Data([0, 27, 255])).payload)
        let event = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: String])
        XCTAssertEqual(event["type"], "input")
        XCTAssertEqual(Data(base64Encoded: try XCTUnwrap(event["bytes"])), Data([0, 27, 255]))
    }

    @MainActor
    func testReplayDoesNotDuplicateOutputAndSessionChangesResetTheEmulator() throws {
        let view = TerminalView(frame: CGRect(x: 0, y: 0, width: 640, height: 300))
        let coordinator = XgentTerminalCoordinator { _ in }
        view.terminalDelegate = coordinator
        coordinator.update(value: try packet("one", bytes: Array("ready".utf8)), view: view)
        let repeated = try packet("one", bytes: Array("ready".utf8))
        coordinator.update(value: repeated, view: view)
        coordinator.update(value: try packet("one", bytes: Array("ady!".utf8), start: 2), view: view)
        let text = String(decoding: view.getTerminal().getBufferAsData(), as: UTF8.self)
        XCTAssertTrue(text.contains("ready!"))
        XCTAssertEqual(text.components(separatedBy: "ready").count, 2)
        coordinator.update(value: try packet("two", bytes: Array("second".utf8)), view: view)
        let switched = String(decoding: view.getTerminal().getBufferAsData(), as: UTF8.self)
        XCTAssertTrue(switched.contains("second"))
        XCTAssertFalse(switched.contains("ready"))
        coordinator.retire()
        view.terminalDelegate = nil
    }

    @MainActor
    func testUTF8SplitAcrossOutputPacketsAndPausedInput() throws {
        var events: [String] = []
        let view = TerminalView(frame: CGRect(x: 0, y: 0, width: 640, height: 300))
        let coordinator = XgentTerminalCoordinator { events.append($0) }
        view.terminalDelegate = coordinator
        coordinator.update(value: try packet("one", bytes: [0xc3]), view: view)
        coordinator.update(value: try packet("one", bytes: [0xc3, 0xa9]), view: view)
        XCTAssertTrue(String(decoding: view.getTerminal().getBufferAsData(), as: UTF8.self).contains("é"))
        coordinator.send(source: view, data: [UInt8(0), 27, 255][...])
        XCTAssertEqual(events.count, 1)
        coordinator.update(value: try packet("one", bytes: [0xc3, 0xa9], enabled: false), view: view)
        coordinator.send(source: view, data: [UInt8(13)][...])
        XCTAssertEqual(events.count, 1)
        coordinator.retire()
        coordinator.send(source: view, data: [UInt8(13)][...])
        XCTAssertEqual(events.count, 1)
        view.terminalDelegate = nil
    }

    @MainActor
    func testUnchangedReplayStillReportsAViewportThatBecameVisible() async throws {
        var events: [String] = []
        let view = TerminalView(frame: .zero)
        let coordinator = XgentTerminalCoordinator { events.append($0) }
        let replay = try packet("late-layout", bytes: Array("ready".utf8))
        coordinator.update(value: replay, view: view)
        view.frame = CGRect(x: 0, y: 0, width: 640, height: 300)
        coordinator.update(value: replay, view: view)
        await Task.yield()
        try await Task.sleep(nanoseconds: 10_000_000)
        let resize = try events.map { try XCTUnwrap(JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]) }
        XCTAssertEqual(resize.count, 1)
        XCTAssertEqual(resize.first?["cols"] as? Int, view.getTerminal().cols)
        XCTAssertEqual(resize.first?["rows"] as? Int, view.getTerminal().rows)
        coordinator.send(source: view, data: [UInt8(13)][...])
        XCTAssertEqual(events.count, 2, "Skipping repeated output must retain input readiness")
        coordinator.retire()
    }

    @MainActor
    func testContinuousActionsDoNotLockKeyboardOrReplaceTerminalOutput() throws {
        let json: [String: Any] = [
            "version": 1, "surface": "terminal", "revision": 1, "mode": "root",
            "title": "Terminal", "appearance": "system", "nodes": [
                ["id": "viewport", "kind": "TerminalViewport", "action": "events", "value": "output"],
                ["id": "button", "kind": "Button", "action": "close", "label": "Close"],
            ],
        ]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: json))
        try document.validate()
        let model = XgentPresentationModel()
        model.update(document)
        var actions: [XgentAction] = []
        model.actionSink = { actions.append($0) }
        let viewport = try XCTUnwrap(document.node(id: "viewport"))
        model.send(viewport, in: document, value: .string("first"), continuous: true)
        model.send(viewport, in: document, value: .string("second"), continuous: true)
        XCTAssertEqual(actions.count, 2)
        XCTAssertFalse(model.isBusy(viewport, in: document))
        XCTAssertEqual(model.value(viewport, in: document), .string("output"))
        model.send(try XCTUnwrap(document.node(id: "button")), in: document, continuous: true)
        XCTAssertEqual(actions.count, 2, "Only terminal events may bypass button busy state")
        model.invalidate()
        model.send(viewport, in: document, continuous: true)
        XCTAssertEqual(actions.count, 2)
    }

    @MainActor
    func testResizeReportsMeasuredCellsAndDropsSupersededOrRetiredGeometry() async throws {
        var events: [String] = []
        let view = TerminalView(frame: CGRect(x: 0, y: 0, width: 640, height: 300))
        let coordinator = XgentTerminalCoordinator { events.append($0) }
        view.terminalDelegate = coordinator
        coordinator.update(value: try packet("one", bytes: []), view: view)
        coordinator.sizeChanged(source: view, newCols: 90, newRows: 30)
        coordinator.sizeChanged(source: view, newCols: 100, newRows: 40)
        await Task.yield()
        try await Task.sleep(nanoseconds: 10_000_000)
        let sizes = try events.map { try XCTUnwrap(JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any]) }
        XCTAssertEqual(sizes.count, 1)
        XCTAssertEqual(sizes.first?["cols"] as? Int, 100)
        XCTAssertEqual(sizes.first?["rows"] as? Int, 40)
        coordinator.sizeChanged(source: view, newCols: 110, newRows: 50)
        coordinator.retire()
        await Task.yield()
        XCTAssertEqual(events.count, 1)
        view.terminalDelegate = nil
    }

    private func packet(_ session: String, bytes: [UInt8], start: Int = 0, end: Int? = nil,
                        enabled: Bool = true) throws -> String {
        let value: [String: Any] = ["sessionId": session, "generation": 1, "startOffset": start,
                                   "endOffset": end ?? start + bytes.count,
                                   "bytes": Data(bytes).base64EncodedString(), "enabled": enabled]
        return String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
    }
}
