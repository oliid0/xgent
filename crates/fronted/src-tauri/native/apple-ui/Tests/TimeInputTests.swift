import Foundation
import XCTest
@testable import XgentNativeUI

final class TimeInputTests: XCTestCase {
    func testScheduleRoundTripsWithoutLocaleOrDaylightSavingChanges() throws {
        for value in ["00:00", "02:30", "09:05", "12:00", "23:59"] {
            let date = try XCTUnwrap(XgentTimeOfDay.date(value))
            XCTAssertEqual(XgentTimeOfDay.string(date), value)
            XCTAssertEqual(XgentTimeOfDay.calendar.component(.year, from: date), 2000)
        }
        for value in ["24:00", "12:60", "2:30", "12:3", "12:30:00", " 12:30", "12:30\n", "", "noon"] {
            XCTAssertNil(XgentTimeOfDay.date(value), value)
        }
    }
}
