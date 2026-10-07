#if os(iOS)
import UIKit
import XCTest

final class HostedApplicationTests: XCTestCase {
    @MainActor
    func testRenderingRunsInsideAStartedApplication() {
        XCTAssertNotNil(UIApplication.shared.delegate,
                        "UIKit interaction and accessibility tests require a running application host")
    }
}
#endif
