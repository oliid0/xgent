import XCTest

/// Exercise the installed Rust-backed application, rather than a rendering fixture.
final class PackagedSettingsTests: XCTestCase {
    private var testedApp: XCUIApplication?

    override func tearDownWithError() throws {
        if let app = testedApp {
            record(app, name: "ios-settings-final-state")
            app.terminate()
            testedApp = nil
        }
        try super.tearDownWithError()
    }

    func testActualSettingsNavigationAndDetailedRoutes() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.ohi.xgent")
        testedApp = app
        app.launch()
        openSettings(app)
        record(app, name: "ios-packaged-settings-index")

        // Mobile capability routes match Android; desktop shortcuts/computer-use
        // are replaced by the mobile permission and execution environments.
        let pages: [(id: String, anchor: String, back: String)] = [
            ("system", "mode", "back"),
            ("providers", "add-provider", "back"),
            ("soul", "soul-preset", "back"),
            ("memory", "memory-category", "back"),
            ("mobileAssistant", "refresh-permissions", "back"),
            ("toolPermissions", "tool-policy-description", "back"),
            ("mobileExecution", "shell-installation-status", "back"),
            ("voice", "voice-enabled", "back"),
            ("other", "other:hooks:hook-add", "back"),
            ("access", "lan-url", "back"),
            ("backup", "backup-preset", "back"),
            ("about", "about-version", "back"),
        ]
        for page in pages {
            let navigation = app.buttons["nav:" + page.id].firstMatch
            reveal(navigation, in: app)
            let label = navigation.label
            tap(navigation, in: app)
            let title = activeTitle(app)
            let settled = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label CONTAINS[c] %@", label), object: title)
            XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 20), .completed,
                           "The actual shared settings action must replace the page")
            let anchor = app.descendants(matching: .any)[page.anchor].firstMatch
            reveal(anchor, in: app)
            assertOnscreen(anchor, in: app)
            let back = activeButton(page.back, in: app)
            assertOnscreen(back, in: app)
            XCTAssertGreaterThanOrEqual(back.frame.height, 43.5)
            XCTAssertFalse(title.frame.intersects(back.frame), "Header controls must not overlap the title")
            record(app, name: "ios-packaged-settings-" + page.id)

            if page.id == "other" {
                let editors: [(area: String, action: String, field: String)] = [
                    ("hooks", "other:hooks:hook-add", "hook-name"),
                    ("cron", "other:cron:add", "cron"),
                    ("ssh", "other:ssh:add", "host"),
                ]
                for editor in editors {
                    let row = app.buttons[editor.action].firstMatch
                    reveal(row, in: app)
                    XCTAssertEqual(app.buttons.matching(identifier: editor.action).count, 1,
                                   "The actual action must have one accessibility identity")
                    tap(row, in: app)
                    let field = app.descendants(matching: .any)[editor.field].firstMatch
                    reveal(field, in: app); assertOnscreen(field, in: app)
                    XCTAssertFalse(app.buttons[editor.action].exists,
                                   "An actual editor must replace the inline lists")
                    let editorBack = activeButton("back", in: app)
                    assertOnscreen(editorBack, in: app)
                    XCTAssertGreaterThanOrEqual(editorBack.frame.height, 43.5)
                    XCTAssertFalse(activeTitle(app).frame.intersects(editorBack.frame))
                    record(app, name: "ios-packaged-settings-other-" + editor.area)
                    tap(editorBack, in: app)
                    XCTAssertTrue(app.buttons[editor.action].waitForExistence(timeout: 20),
                                  "A detail must return to Other, rather than close Settings")
                }
            }
            tap(activeButton(page.back, in: app), in: app)
            reveal(app.buttons["nav:system"].firstMatch, in: app)
        }
        closeSettings(app)
        record(app, name: "ios-packaged-chat-after-settings")
    }

    func testVoicePreferencePersistsAfterSettingsReopenAndApplicationRelaunch() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.ohi.xgent")
        testedApp = app
        app.launch()
        openSettings(app)
        tap(app.buttons["nav:voice"].firstMatch, in: app)
        let toggle = app.switches["voice-enabled"].firstMatch
        reveal(toggle, in: app)
        XCTAssertEqual(app.switches.matching(identifier: "voice-enabled").count, 1)
        let original = try XCTUnwrap(toggle.value as? String)
        XCTAssertTrue(["0", "1"].contains(original))
        let changed = original == "1" ? "0" : "1"
        tap(toggle, in: app)
        waitForValue(toggle, changed)
        XCTAssertFalse(app.staticTexts["save-status"].exists, "Normal saves must not add a visible settings badge")
        tap(app.buttons["back"].firstMatch, in: app)
        closeSettings(app)
        openSettings(app)
        tap(app.buttons["nav:voice"].firstMatch, in: app)
        waitForValue(toggle, changed)
        app.terminate()
        app.launch()
        openSettings(app)
        tap(app.buttons["nav:voice"].firstMatch, in: app)
        waitForValue(toggle, changed)
        record(app, name: "ios-packaged-voice-persisted")
        tap(toggle, in: app)
        waitForValue(toggle, original)
        XCTAssertFalse(app.staticTexts["save-status"].exists)
        tap(app.buttons["back"].firstMatch, in: app)
        closeSettings(app)
        app.terminate()
        app.launch()
        openSettings(app)
        tap(app.buttons["nav:voice"].firstMatch, in: app)
        waitForValue(toggle, original)
        tap(app.buttons["back"].firstMatch, in: app)
        closeSettings(app)
    }

    private func openSettings(_ app: XCUIApplication) {
        let draft = app.textViews["draft"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 60), "The actual native chat must render")
        if !app.buttons["settings"].firstMatch.isHittable {
            tap(app.buttons["sidebar"].firstMatch, in: app)
        }
        tap(app.buttons["settings"].firstMatch, in: app)
        XCTAssertTrue(app.buttons["presentation-sheet-close"].firstMatch.waitForExistence(timeout: 30))
        reveal(app.buttons["nav:system"].firstMatch, in: app)
        XCTAssertFalse(app.staticTexts["presentation-sheet-title"].exists,
                       "The settings index starts with its sections, without an extra page title")
    }

    private func closeSettings(_ app: XCUIApplication) {
        tap(activeButton("presentation-sheet-close", in: app), in: app)
        let draft = app.textViews["draft"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 30))
        XCTAssertTrue(draft.isHittable, "Settings must return pointer/touch ownership to the composer")
    }

    private func activeTitle(_ app: XCUIApplication) -> XCUIElement {
        let query = app.staticTexts.matching(identifier: "presentation-sheet-title")
        XCTAssertTrue(query.firstMatch.waitForExistence(timeout: 30))
        return query.allElementsBoundByIndex.first { $0.isHittable } ?? query.firstMatch
    }

    private func activeButton(_ id: String, in app: XCUIApplication) -> XCUIElement {
        let query = app.buttons.matching(identifier: id)
        return query.allElementsBoundByIndex.first { $0.isHittable } ?? query.firstMatch
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        _ = element.waitForExistence(timeout: 3)
        for _ in 0..<14 where !(element.exists && element.isHittable) {
            if app.scrollViews.firstMatch.exists { app.scrollViews.firstMatch.swipeUp() }
            else if app.collectionViews.firstMatch.exists { app.collectionViews.firstMatch.swipeUp() }
            else { app.swipeUp() }
        }
        XCTAssertTrue(element.exists && element.isHittable, "Missing or obscured control: \(element)")
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        reveal(element, in: app)
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true AND hittable == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        element.tap()
    }

    private func assertOnscreen(_ element: XCUIElement, in app: XCUIApplication) {
        let frame = element.frame, bounds = app.frame
        XCTAssertGreaterThan(frame.width, 0)
        XCTAssertGreaterThan(frame.height, 0)
        XCTAssertGreaterThanOrEqual(frame.minX, bounds.minX - 1)
        XCTAssertLessThanOrEqual(frame.maxX, bounds.maxX + 1)
        XCTAssertGreaterThanOrEqual(frame.minY, bounds.minY - 1)
        XCTAssertLessThanOrEqual(frame.maxY, bounds.maxY + 1)
    }

    private func waitForValue(_ element: XCUIElement, _ value: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 30))
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 30), .completed)
    }

    private func record(_ app: XCUIApplication, name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name; image.lifetime = .keepAlways; add(image)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-accessibility"; hierarchy.lifetime = .keepAlways; add(hierarchy)
    }
}
