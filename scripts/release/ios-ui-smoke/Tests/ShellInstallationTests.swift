import XCTest

final class ShellInstallationTests: XCTestCase {
    private var testedApp: XCUIApplication?

    override func tearDownWithError() throws {
        if let app = testedApp {
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "ios-shell-result"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "ios-shell-accessibility"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
            app.terminate()
            testedApp = nil
        }
        try super.tearDownWithError()
    }

    func testInstallAndExecuteBundledShell() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.ohi.xgent")
        testedApp = app
        app.launch()

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
        XCTAssertTrue(version.exists, "Installation failed: \(app.debugDescription)")
        XCTAssertTrue(version.label.contains("a-Shell"))

        tap(app.buttons["browse-shell-files"], in: app)
        tap(app.buttons["shell-files-entry:cacert.pem"], in: app)
        let certificate = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "-----BEGIN CERTIFICATE-----")).firstMatch
        XCTAssertTrue(certificate.waitForExistence(timeout: 30), "Read the actual installed CA bundle")
        let filesScreenshot = XCTAttachment(screenshot: app.screenshot())
        filesScreenshot.name = "ios-shell-file-preview"
        filesScreenshot.lifetime = .keepAlways
        add(filesScreenshot)
        tap(app.buttons["shell-files-list"], in: app)
        tap(app.buttons["back"], in: app)
        XCTAssertTrue(version.waitForExistence(timeout: 30), "Return to the same Shell settings route")

        tap(app.buttons["back"], in: app)
        tap(app.buttons["Close"], in: app)
        tap(app.buttons["tools"], in: app)
        tap(app.buttons["tool:terminal"], in: app)
        let command = app.textFields["command"]
        tap(command, in: app)
        command.typeText("printf xgent-ios-shell-ok")
        tap(app.buttons["run"], in: app)

        let output = app.scrollViews.matching(NSPredicate(format: "identifier ENDSWITH ':stdout'")).firstMatch.staticTexts
        let exit = app.staticTexts.matching(NSPredicate(format: "identifier ENDSWITH ':exit'")).firstMatch
        XCTAssertTrue(exit.waitForExistence(timeout: 45), "The installed a-Shell command must return")
        assertExit(0, element: exit)
        XCTAssertTrue(output.matching(NSPredicate(format: "label CONTAINS %@", "xgent-ios-shell-ok")).firstMatch.exists, "Verify actual command output")

        XCTAssertFalse(app.scrollViews.matching(NSPredicate(format: "identifier ENDSWITH ':stderr'")).firstMatch.exists,
                       "A plain task command must not execute the simulator host profile")

        tap(app.buttons["clear"], in: app)
        tap(command, in: app)
        command.typeText("printf xgent-before-error; exit 7")
        tap(app.buttons["run"], in: app)
        XCTAssertTrue(exit.waitForExistence(timeout: 45))
        assertExit(7, element: exit)
        XCTAssertTrue(output.matching(NSPredicate(format: "label CONTAINS %@", "xgent-before-error")).firstMatch.exists)

        tap(app.buttons["clear"], in: app)
        tap(command, in: app)
        command.typeText("printf xgent-after-error-ok")
        tap(app.buttons["run"], in: app)
        XCTAssertTrue(exit.waitForExistence(timeout: 45))
        assertExit(0, element: exit)
        XCTAssertTrue(output.matching(NSPredicate(format: "label CONTAINS %@", "xgent-after-error-ok")).firstMatch.exists)

        tap(app.buttons["clear"], in: app)
        tap(command, in: app)
        command.typeText("python3 -c 'import sqlite3, ssl, zlib; print(\"xgent-python-modules-ok\")'; python3.9 -m pip --version")
        tap(app.buttons["run"], in: app)
        XCTAssertTrue(exit.waitForExistence(timeout: 45), "Both Python invocations must finish")
        assertExit(0, element: exit)
        XCTAssertTrue(output.matching(NSPredicate(format: "label CONTAINS %@", "xgent-python-modules-ok")).firstMatch.exists)
        XCTAssertTrue(output.matching(NSPredicate(format: "label CONTAINS %@", "pip 22.")).firstMatch.exists)

        tap(app.buttons["clear"], in: app)
        tap(command, in: app)
        command.typeText("read answer; printf 'xgent-input-%s' \"$answer\"")
        tap(app.buttons["run"], in: app)
        let programInput = app.textFields["program-input"]
        tap(programInput, in: app)
        programInput.typeText("ready")
        tap(app.buttons["send-input"], in: app)
        XCTAssertTrue(exit.waitForExistence(timeout: 45), "Live stdin must unblock the actual command")
        assertExit(0, element: exit)
        XCTAssertTrue(output.matching(NSPredicate(format: "label CONTAINS %@", "xgent-input-ready")).firstMatch.exists)

        tap(app.buttons["clear"], in: app)
        tap(command, in: app)
        command.typeText("cat")
        tap(app.buttons["run"], in: app)
        tap(app.buttons["input-eof"], in: app)
        XCTAssertTrue(exit.waitForExistence(timeout: 45), "EOF must finish a command waiting on stdin")
        assertExit(0, element: exit)

        tap(app.buttons["clear"], in: app)
        tap(command, in: app)
        command.typeText("cat")
        tap(app.buttons["run"], in: app)
        XCTAssertTrue(programInput.waitForExistence(timeout: 30), "The cancellable native command must start")
        tap(app.buttons["cancel"], in: app)
        let cancelled = app.descendants(matching: .any).matching(NSPredicate(format: "identifier ENDSWITH ':cancelled'")).firstMatch
        XCTAssertTrue(cancelled.waitForExistence(timeout: 45), "Cancelling a native thread must finish without terminating the app")
        tap(app.buttons["clear"], in: app)
        tap(command, in: app)
        command.typeText("printf xgent-ios-after-cancel-ok")
        tap(app.buttons["run"], in: app)
        XCTAssertTrue(exit.waitForExistence(timeout: 45))
        assertExit(0, element: exit)
        XCTAssertTrue(output.matching(NSPredicate(format: "label CONTAINS %@", "xgent-ios-after-cancel-ok")).firstMatch.exists)
    }

    private func assertExit(_ code: Int, element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertNotNil(element.label.range(of: "(?:^|[^0-9])\(code)$", options: .regularExpression),
                        "Expected actual exit code \(code), received \(element.label)", file: file, line: line)
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 30), "Missing control: \(element)")
        for _ in 0..<6 where !element.isHittable { app.swipeUp() }
        let ready = NSPredicate(format: "enabled == true AND hittable == true")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: element)], timeout: 30), .completed)
        XCTAssertTrue(element.isEnabled && element.isHittable, "Control must accept touch: \(element)")
        element.tap()
    }
}
