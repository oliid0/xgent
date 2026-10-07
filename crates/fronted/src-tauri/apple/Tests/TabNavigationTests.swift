import SwiftUI
import XCTest
@testable import XgentNativeUI

final class TabNavigationTests: XCTestCase {
    func testWorkspaceAndFileTabsMatchSharedKeyboardNavigationInBothDirections() {
        let ids = ["browser", "terminal", "file"]
        for rtl in [false, true] {
            XCTAssertEqual(XgentTabNavigation.destination(ids: ids, current: "terminal", key: .home, rtl: rtl), "browser")
            XCTAssertEqual(XgentTabNavigation.destination(ids: ids, current: "terminal", key: .end, rtl: rtl), "file")
            XCTAssertEqual(XgentTabNavigation.destination(ids: ids, current: "browser", key: .leftArrow, rtl: rtl), rtl ? "terminal" : "file")
            XCTAssertEqual(XgentTabNavigation.destination(ids: ids, current: "file", key: .rightArrow, rtl: rtl), rtl ? "terminal" : "browser")
        }
        XCTAssertNil(XgentTabNavigation.destination(ids: [], current: "file", key: .home, rtl: false))
        XCTAssertNil(XgentTabNavigation.destination(ids: ids, current: "retired", key: .end, rtl: false))
        XCTAssertNil(XgentTabNavigation.destination(ids: ids, current: "file", key: .return, rtl: false))
    }
}
