import Foundation
import XCTest
@testable import XgentNativeUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

final class FontSettingsTests: XCTestCase {
    func testFallbackListParsingPreservesFamilyNames() {
        XCTAssertEqual(XgentFonts.candidates("  \"Unknown Family\", 'PingFang SC', Menlo, monospace  "),
                       ["Unknown Family", "PingFang SC", "Menlo", "monospace"])
        XCTAssertEqual(XgentFonts.candidates(nil), [])
    }

    @MainActor func testResolvesAnInstalledFamilyAndSkipsMissingFallbacks() throws {
        #if os(iOS)
        let family = try XCTUnwrap(UIFont.familyNames.first)
        #else
        let family = try XCTUnwrap(NSFontManager.shared.availableFontFamilies.first)
        #endif
        let resolved = try XCTUnwrap(XgentFonts.name(for: family))
        XCTAssertEqual(XgentFonts.name(for: "\"Xgent Nonexistent Font 532\", \"\(family)\""), resolved)
        XCTAssertNil(XgentFonts.name(for: "Xgent Nonexistent Font 532"))
    }

    @MainActor func testFontInventoryFFIReturnsValidJSONWithExplicitOwnership() throws {
        let pointer = try XCTUnwrap(xgentNativeUIFontFamilies())
        defer { xgentNativeUIFontFamiliesFree(pointer) }
        let data = Data(String(cString: pointer).utf8)
        let families = try JSONDecoder().decode([String].self, from: data)
        XCTAssertFalse(families.isEmpty)
        XCTAssertEqual(families, families.sorted())
    }
}
