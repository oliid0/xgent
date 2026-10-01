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

@MainActor
private final class NotificationActions {
    var values: [XgentAction] = []
    func record(_ action: XgentAction) { values.append(action) }
}

final class NotificationRenderingTests: XCTestCase {
    @MainActor
    func testShortNotificationsHugContentAndLongNotificationsStayWithinTheirCardBudget() async throws {
        for (message, expectedMaximum) in [("Backup saved", CGFloat(120)), (String(repeating: "Connection failed. ", count: 60), CGFloat(220))] {
            let model = XgentPresentationModel(), document = try toast(surface: "measured", message: message)
            model.update(document)
            let view = XgentNotificationCard(document: document, maximumHeight: 220, model: model)
                .frame(width: 320)
                .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
            #if os(iOS)
            let hosting = UIHostingController(rootView: view)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 320, height: 720))
            window.rootViewController = hosting
            window.makeKeyAndVisible()
            defer { window.isHidden = true; window.rootViewController = nil }
            hosting.view.frame = CGRect(x: 0, y: 0, width: 320, height: 720)
            hosting.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 100_000_000)
            let height = hosting.sizeThatFits(in: CGSize(width: 320, height: 720)).height
            #else
            let hosting = NSHostingView(rootView: view)
            hosting.frame = CGRect(x: 0, y: 0, width: 320, height: 720)
            hosting.layoutSubtreeIfNeeded()
            try await Task.sleep(nanoseconds: 100_000_000)
            let height = hosting.fittingSize.height
            #endif
            XCTAssertGreaterThanOrEqual(height, 44)
            if message.count > 100 { XCTAssertGreaterThanOrEqual(height, 180) }
            XCTAssertLessThanOrEqual(height, expectedMaximum)
        }
    }

    @MainActor
    func testReadingDismissAndAnnouncementUseCurrentSurfaceAndRetireOnRemoval() throws {
        let model = XgentPresentationModel(), actions = NotificationActions()
        model.actionSink = actions.record
        let notification = try toast(surface: "copy", message: "Path copied")
        XCTAssertFalse(model.consumeNotificationAnnouncement(notification))
        model.update(notification)
        XCTAssertTrue(model.consumeNotificationAnnouncement(notification))
        XCTAssertFalse(model.consumeNotificationAnnouncement(notification))
        model.setNotificationReading(true, in: notification)
        model.setNotificationReading(false, in: notification)
        model.dismiss(notification)
        model.dismiss(notification)
        XCTAssertEqual(actions.values.map(\.action), ["reading", "reading", "dismiss"])
        XCTAssertEqual(actions.values.map(\.value), [.bool(true), .bool(false), .null])
        let removal = try decode([
            "version": 1, "surface": "copy", "revision": 2, "mode": "root",
            "title": "", "appearance": "system", "removed": true, "nodes": [],
        ])
        model.update(removal)
        model.setNotificationReading(true, in: notification)
        model.dismiss(notification)
        XCTAssertFalse(model.consumeNotificationAnnouncement(notification))
        XCTAssertEqual(actions.values.count, 3)
        model.complete(XgentActionResult(surface: "copy", requestId: actions.values[2].requestId, ok: true, error: nil))
        XCTAssertTrue(model.busy.isEmpty)
        model.invalidate()
        model.update(notification)
        XCTAssertTrue(model.documents.isEmpty)
    }

    @MainActor
    func testNativeNotificationsRenderAboveRootAndSettingsAtNarrowWideAndAccessibilitySizes() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 768]
        #else
        let widths: [CGFloat] = [640, 1040]
        #endif
        for width in widths {
            for mode in ["root", "sheet"] {
                for size in [DynamicTypeSize.large, .accessibility3] {
                    let model = XgentPresentationModel()
                    let base = try decode([
                        "version": 1, "surface": "page", "revision": 1, "mode": mode,
                        "title": "Workspace", "appearance": "light", "dismissAction": "page-close",
                        "nodes": [["id": "setting", "kind": "TextInput", "label": "Workspace name", "value": "Fort Mason", "action": "name"]],
                    ])
                    model.update(base)
                    for (index, message) in ["Backup saved", "Copied /Documents/workspaces/Fort Mason", String(repeating: "The connection failed. Check the SSH server address and try again. ", count: 8)].enumerated() {
                        model.update(try toast(surface: "toast-\(index)", message: message, error: index == 2))
                    }
                    #if os(iOS)
                    let content = Group {
                        if mode == "sheet" { XgentIOSSheetPresentation(initialDocument: base, model: model) }
                        else { XgentPresentationView(model: model) }
                    }
                    #else
                    let content = Group {
                        if mode == "sheet" { XgentSheetView(document: base, model: model) }
                        else { XgentPresentationView(model: model) }
                    }
                    #endif
                    let view = content.frame(width: width, height: 720).dynamicTypeSize(size)
                        .preferredColorScheme(.light)
                        .modifier(XgentPresentationThemeModifier(theme: .fallback, appearance: .light))
                    #if os(iOS)
                    let hosting = UIHostingController(rootView: view)
                    hosting.view.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                    hosting.view.layoutIfNeeded()
                    let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 720))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(hosting.view).run { continuation.resume(returning: $0) }
                    }
                    XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 2_000)
                    #else
                    let hosting = NSHostingView(rootView: view)
                    hosting.frame = CGRect(x: 0, y: 0, width: width, height: 720)
                    hosting.layoutSubtreeIfNeeded()
                    let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 720))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(hosting).run { continuation.resume(returning: $0) }
                    }
                    XCTAssertGreaterThan(try XCTUnwrap(image.tiffRepresentation).count, 2_000)
                    #endif
                    XCTAssertEqual(image.size.width, width)
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "notifications-\(mode)-\(Int(width))-\(size == .large ? "standard" : "accessibility")"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
        }
    }

    private func toast(surface: String, message: String, error: Bool = false) throws -> XgentDocument {
        try decode([
            "version": 1, "surface": surface, "revision": 1, "mode": "toast", "title": "",
            "appearance": "light", "dismissAction": "dismiss", "readingAction": "reading",
            "nodes": [["id": "message", "kind": "Banner", "variant": "toast", "text": message,
                       "status": error ? "error" : "completed", "icon": error ? "exclamationmark.circle" : "info.circle",
                       "children": [["id": "close", "kind": "Button", "label": "Close", "action": "dismiss"]]]],
        ])
    }

    private func decode(_ value: [String: Any]) throws -> XgentDocument {
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: value))
        try document.validate()
        return document
    }
}
