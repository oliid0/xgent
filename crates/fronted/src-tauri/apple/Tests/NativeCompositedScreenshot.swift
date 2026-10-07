#if os(iOS)
import UIKit
import XCTest

extension XCTestCase {
    // Layer snapshots remain useful for pixel assertions, but don't reproduce
    // every UIKit material. Capture the mounted hierarchy as separate evidence.
    @MainActor
    func attachCompositedNativeScreenshot(of view: UIView, name: String) throws {
        XCTAssertTrue(view is UIWindow || view.window != nil, "Composited evidence requires a mounted view")
        let format = UIGraphicsImageRendererFormat()
        format.scale = view.traitCollection.displayScale
        let renderer = UIGraphicsImageRenderer(bounds: view.bounds, format: format)
        var rendered = false
        let image = renderer.image { _ in
            rendered = view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        XCTAssertTrue(rendered, "The complete visible hierarchy must be captured")
        XCTAssertGreaterThan(try XCTUnwrap(image.pngData()).count, 2_000)
        let attachment = XCTAttachment(image: image)
        attachment.name = "\(name)-composited"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
#endif
