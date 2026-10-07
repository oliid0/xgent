import Foundation
import XCTest
@testable import XgentNativeUI

final class ModelOptionsTests: XCTestCase {
    func testSameNamedProvidersAndModelsRemainDistinct() throws {
        let options = try decode([
            ["value": "a:large", "label": "Shared · large", "group": "a", "groupLabel": "Shared"],
            ["value": "b:large", "label": "Shared · large", "group": "b", "groupLabel": "Shared"],
            ["value": "a:small", "label": "Shared · small", "group": "a", "groupLabel": "Shared"],
        ])
        let groups = XgentModelOptions.groups(options)
        XCTAssertEqual(groups.map(\.id), ["a", "b"])
        XCTAssertEqual(groups[0].options.map(\.value), ["a:large", "a:small"])
        XCTAssertEqual(groups[1].options.map(\.value), ["b:large"])
        XCTAssertEqual(options[0].displayLabel, "large")
    }

    func testSearchMatchesModelAndProviderWithoutChangingValuesOrDisabledState() throws {
        let options = try decode([
            ["value": "a:large", "label": "Work · large", "group": "a", "groupLabel": "Work", "disabled": true],
            ["value": "b:small", "label": "Home · small", "group": "b", "groupLabel": "Home"],
        ])
        let byProvider = XgentModelOptions.groups(options, query: " WORK ")
        XCTAssertEqual(byProvider.first?.options.first?.value, "a:large")
        XCTAssertEqual(byProvider.first?.options.first?.disabled, true)
        XCTAssertEqual(XgentModelOptions.groups(options, query: "SMALL").map(\.id), ["b"])
        XCTAssertTrue(XgentModelOptions.groups(options, query: "missing").isEmpty)
    }

    func testExistingUngroupedSelectorsStayCompatible() throws {
        let options = try decode([["value": "dark", "label": "Dark"]])
        XCTAssertEqual(options[0].displayLabel, "Dark")
        XCTAssertEqual(XgentModelOptions.groups(options).first?.options.map(\.value), ["dark"])
    }

    private func decode(_ options: [[String: Any]]) throws -> [XgentOption] {
        try JSONDecoder().decode([XgentOption].self, from: JSONSerialization.data(withJSONObject: options))
    }
}
