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

        let output = app.staticTexts.matching(NSPredicate(format: "identifier ENDSWITH ':output'")).firstMatch
        let exit = app.staticTexts.matching(NSPredicate(format: "identifier ENDSWITH ':exit'")).firstMatch
        XCTAssertTrue(exit.waitForExistence(timeout: 45), "The installed a-Shell command must return")
        XCTAssertEqual(exit.label, "Exit: 0")
        XCTAssertTrue(output.label.contains("xgent-ios-shell-ok"), "Verify actual command output")

        tap(app.buttons["clear"], in: app)
        tap(command, in: app)
        command.typeText("python3 -c 'import sqlite3, ssl, zlib; print(\"xgent-python-modules-ok\")'; python3.9 -m pip --version")
        tap(app.buttons["run"], in: app)
        XCTAssertTrue(exit.waitForExistence(timeout: 45), "Both Python invocations must finish")
        XCTAssertEqual(exit.label, "Exit: 0")
        XCTAssertTrue(output.label.contains("xgent-python-modules-ok"))
        XCTAssertTrue(output.label.contains("pip 22."))
    }

    private func tap(_ element: XCUIElement, in app: XCUIApplication) {
        XCTAssertTrue(element.waitForExistence(timeout: 30), "Missing control: \(element)")
        for _ in 0..<6 where !element.isHittable { app.swipeUp() }
        XCTAssertTrue(element.isEnabled && element.isHittable, "Control must accept touch: \(element)")
        element.tap()
    }
}
