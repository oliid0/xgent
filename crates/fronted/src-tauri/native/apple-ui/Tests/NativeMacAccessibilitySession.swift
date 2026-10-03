#if os(macOS)
import AppKit
import XCTest

// SwiftUI lazily creates its AppKit accessibility nodes. Hosted tests need the
// same enhanced interface request that an accessibility client sends to NSApp.
@MainActor
final class NativeMacAccessibilitySession {
    private let attribute = NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface")
    private let previous: Bool

    init() throws {
        let application = NSApplication.shared
        guard application.accessibilityIsAttributeSettable(attribute) else {
            XCTFail("The hosted application must expose its enhanced accessibility interface")
            throw NSError(domain: "NativeAccessibility", code: 1)
        }
        previous = (application.accessibilityAttributeValue(attribute) as? NSNumber)?.boolValue ?? false
        application.accessibilitySetValue(true, forAttribute: attribute)
    }

    func restore() {
        NSApplication.shared.accessibilitySetValue(previous, forAttribute: attribute)
    }
}
#endif
