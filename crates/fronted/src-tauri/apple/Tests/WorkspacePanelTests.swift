import XCTest
@testable import XgentNativeUI

final class WorkspacePanelTests: XCTestCase {
    func testOutputUpdatesPreserveSelectionButUserRequestsReopenThePanel() {
        var state = XgentWorkspacePanelState()
        let browser = XgentWorkspacePanelIdentity(surface: "browser", focusRequest: 0)
        let terminal = XgentWorkspacePanelIdentity(surface: "terminal", focusRequest: 0)
        state.synchronize([browser])
        state.synchronize([browser, terminal])
        XCTAssertEqual(state.selectedSurface, "terminal")
        state.select("browser")
        state.synchronize([browser, terminal])
        XCTAssertEqual(state.selectedSurface, "browser", "Output revisions cannot steal the selected tab")
        state.visible = false
        state.synchronize([browser, terminal])
        XCTAssertFalse(state.visible)
        state.synchronize([XgentWorkspacePanelIdentity(surface: "browser", focusRequest: 1), terminal])
        XCTAssertTrue(state.visible)
        XCTAssertEqual(state.selectedSurface, "browser")
        state.select("retired")
        XCTAssertEqual(state.selectedSurface, "browser")
    }

    func testClosingUsesTheSameNeighborRuleAsSharedDesktopTabs() {
        var state = XgentWorkspacePanelState()
        let items = ["browser", "terminal", "preview"].map { XgentWorkspacePanelIdentity(surface: $0, focusRequest: 0) }
        state.synchronize(items)
        state.select("terminal")
        state.synchronize([items[0], items[2]])
        XCTAssertEqual(state.selectedSurface, "preview")
        state.synchronize([items[0]])
        XCTAssertEqual(state.selectedSurface, "browser")
        state.expanded = true
        state.synchronize([])
        XCTAssertNil(state.selectedSurface)
        XCTAssertFalse(state.expanded)
    }

    func testDockKeepsBrowserSelectionAndOutputCannotMoveTerminalBackToSide() {
        var state = XgentWorkspacePanelState()
        let browser = XgentWorkspacePanelIdentity(surface: "browser", focusRequest: 0)
        let terminal = XgentWorkspacePanelIdentity(surface: "terminal", focusRequest: 0)
        state.synchronize([browser, terminal])
        state.dock("terminal")
        XCTAssertEqual(state.dockedSurface, "terminal")
        XCTAssertEqual(state.selectedSurface, "browser")
        state.synchronize([browser, XgentWorkspacePanelIdentity(surface: "terminal", focusRequest: 1)])
        XCTAssertEqual(state.selectedSurface, "browser", "New terminal sessions stay in the dock")
        state.restoreDock()
        XCTAssertNil(state.dockedSurface)
        XCTAssertEqual(state.selectedSurface, "terminal")
        state.dock("terminal")
        state.hideDock()
        XCTAssertEqual(state.selectedSurface, "browser", "Hiding the dock preserves the browser")
        state.dock("terminal")
        state.synchronize([browser])
        XCTAssertNil(state.dockedSurface, "A retired document cannot expose a previous workspace")
        XCTAssertEqual(state.selectedSurface, "browser")
        state.dock("retired")
        XCTAssertNil(state.dockedSurface)
    }

    func testNarrowWindowAndInvalidSavedWidthCannotSqueezeTheMainChat() {
        XCTAssertFalse(XgentWorkspacePanelState.canSplit(width: 640, minimumMainWidth: 440))
        XCTAssertFalse(XgentWorkspacePanelState.canSplit(width: 1040, minimumMainWidth: 800))
        XCTAssertTrue(XgentWorkspacePanelState.canSplit(width: 1280, minimumMainWidth: 800))
        XCTAssertEqual(XgentWorkspacePanelState.panelWidth(.nan, available: 1280, minimumMainWidth: 800), 420)
        XCTAssertEqual(XgentWorkspacePanelState.panelWidth(900, available: 1280, minimumMainWidth: 800), 472)
    }
}
