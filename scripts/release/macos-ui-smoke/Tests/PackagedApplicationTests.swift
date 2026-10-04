import XCTest

final class PackagedApplicationTests: XCTestCase {
    private var testedApp: XCUIApplication?

    override func tearDownWithError() throws {
        if let app = testedApp {
            record(app, name: "macos-final-state")
            app.terminate()
            testedApp = nil
        }
        try super.tearDownWithError()
    }

    func testActualPackagedChatAndEverySettingsPage() throws {
        continueAfterFailure = false
        let path = try XCTUnwrap(ProcessInfo.processInfo.environment["XGENT_MACOS_SMOKE_APP"])
        XCTAssertTrue(FileManager.default.fileExists(atPath: path + "/Contents/Info.plist"))
        let app = XCUIApplication(url: URL(fileURLWithPath: path))
        testedApp = app
        app.launch()
        let draft = app.descendants(matching: .any)["draft"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 60), "The actual SwiftUI chat must render after packaged launch")
        record(app, name: "macos-packaged-chat")
        XCTAssertEqual(app.webViews.count, 0, "The covered execution host must be excluded from native accessibility")
        XCTAssertTrue(draft.isHittable, "The composer must remain reachable")

        let settings = app.buttons["settings"].firstMatch
        if !settings.exists { click(app.buttons["sidebar"].firstMatch) }
        click(settings)
        let title = app.staticTexts["settings-detail-title"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        let sections = ["system", "providers", "shortcuts", "backup", "computerUse", "toolPermissions",
                        "voice", "soul", "memory", "other", "access", "about"]
        for section in sections {
            let navigation = app.buttons["desktop-nav:" + section].firstMatch
            if navigation.exists && !navigation.isHittable {
                app.scrollViews.containing(.button, identifier: "desktop-nav:" + section).firstMatch.scroll(byDeltaX: 0, deltaY: -200)
            }
            click(navigation)
            // The actual shared page may expand a short navigation label,
            // for example Shortcuts -> Global shortcuts in both frontends.
            let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS[c] %@", navigation.label), object: title)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 15), .completed, "The shared settings action must change the visible section")
            XCTAssertGreaterThan(title.frame.width, 0)
            XCTAssertGreaterThan(title.frame.minX, navigation.frame.maxX, "Settings content must not overlap navigation")
            let rows = sections.map { app.buttons["desktop-nav:" + $0].firstMatch }.filter { $0.exists && $0.isHittable }.map(\.frame).sorted { $0.minY < $1.minY }
            for (previous, next) in zip(rows, rows.dropFirst()) {
                XCTAssertLessThanOrEqual(previous.maxY, next.minY + 1, "Navigation rows must not overlap")
            }
            record(app, name: "macos-packaged-settings-" + section)
        }

        click(app.buttons["settings-close"].firstMatch)
        XCTAssertTrue(draft.waitForExistence(timeout: 30))
        click(settings)
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        let backdrop = app.buttons["settings-dismiss-backdrop"].firstMatch
        XCTAssertTrue(backdrop.waitForExistence(timeout: 15))
        backdrop.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.01)).click()
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title)
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 15), .completed,
            "Clicking outside the desktop settings dialog must dismiss it")
        XCTAssertTrue(draft.isHittable)
        let window = app.windows.firstMatch
        let before = window.frame
        let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1)).withOffset(CGVector(dx: -2, dy: -2))
        corner.press(forDuration: 0.1, thenDragTo: corner.withOffset(CGVector(dx: 640 - before.width, dy: 0)))
        if !settings.exists { click(app.buttons["sidebar"].firstMatch) }
        click(settings)
        let compact = app.descendants(matching: .any)["settings-navigation-menu"].firstMatch
        XCTAssertTrue(compact.waitForExistence(timeout: 15), "A narrow desktop must use the compact settings navigation")
        XCTAssertTrue(compact.isHittable)
        XCTAssertLessThan(window.frame.width, 760)
        record(app, name: "macos-packaged-settings-system-narrow")
        click(app.buttons["settings-close"].firstMatch)
        XCTAssertTrue(draft.waitForExistence(timeout: 30))
        XCTAssertTrue(draft.isHittable, "Closing settings must restore the actual composer")
        record(app, name: "macos-packaged-chat-narrow")
    }

    private func click(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 30), "Missing control: \(element)")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true AND hittable == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 15), .completed, "Controls must accept pointer input")
        element.click()
    }

    private func record(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name; screenshot.lifetime = .keepAlways; add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-accessibility"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
}
