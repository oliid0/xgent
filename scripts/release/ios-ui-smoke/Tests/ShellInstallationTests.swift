import XCTest

final class ShellInstallationTests: XCTestCase {
    func testInstallAndExecuteBundledShell() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.ohi.xgent")
        app.launch()
        defer {
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "ios-shell-result"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "ios-shell-accessibility"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
            app.terminate()
        }

        tap(app.buttons["tools"], in: app)
        tap(app.buttons["tool:shell"], in: app)
        let version = app.staticTexts["shell-version"]
        if !version.exists {
            tap(app.buttons["install-shell"], in: app)
        }
        let error = app.descendants(matching: .any)["error"].firstMatch
        let installed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in version.exists || error.exists }, object: nil
        )
        XCTAssertEqual(XCTWaiter.wait(for: [installed], timeout: 180), .completed,
                       "The bundled a-Shell installation must finish")
        XCTAssertTrue(version.exists, "Installation failed: \(error.exists ? error.label : app.debugDescription)")
        XCTAssertTrue(version.label.contains("a-Shell"))

        let back = app.buttons.matching(NSPredicate(format: "label IN %@", ["Back", "返回"])).firstMatch
        tap(back, in: app)
        tap(app.buttons["Close"], in: app)
        tap(app.buttons["tools"], in: app)
        tap(app.buttons["tool:terminal"], in: app)
        let command = app.textFields["Command"]
        tap(command, in: app)
        command.typeText("printf xgent-ios-shell-ok")
        tap(app.buttons["run"], in: app)

        let output = app.staticTexts.matching(NSPredicate(format: "identifier ENDSWITH ':output'")).firstMatch
        let exit = app.staticTexts.matching(NSPredicate(format: "identifier ENDSWITH ':exit'")).firstMatch
        XCTAssertTrue(exit.waitForExistence(timeout: 45), "The installed a-Shell command must return")
        XCTAssertEqual(exit.label, "Exit: 0")
        XCTAssertTrue(output.label.contains("xgent-ios-shell-ok"), "Verify actual command output")
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 30), "Missing control: \(element)")
        for _ in 0..<6 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isEnabled && element.isHittable, "Control must accept touch: \(element)")
        element.tap()
    }
}
