#if os(macOS)
import AppKit

// SwiftUI can vend NSObject accessibility proxies without declaring formal
// NSAccessibilityProtocol conformance. Keep those nodes in the real tree.
@MainActor
struct NativeMacAccessibilityElement {
    let object: NSObject

    func accessibilityIdentifier() -> String? {
        attribute(.identifier, getter: "accessibilityIdentifier") as? String
    }
    func accessibilityRole() -> NSAccessibility.Role? {
        if let modern = object as? any NSAccessibilityProtocol { return modern.accessibilityRole() }
        let value = attribute(.role, getter: "accessibilityRole")
        if let role = value as? NSAccessibility.Role { return role }
        guard let role = value as? String else { return nil }
        return NSAccessibility.Role(rawValue: role)
    }
    func accessibilityLabel() -> String? {
        attribute(.description, getter: "accessibilityLabel") as? String
            ?? attribute(.title, getter: "accessibilityTitle") as? String
    }
    func accessibilityText() -> String? {
        if let label = accessibilityLabel(), !label.isEmpty { return label }
        let value = attribute(.value, getter: "accessibilityValue")
        return (value as? String) ?? (value as? NSAttributedString)?.string
    }
    func accessibilityFrame() -> CGRect {
        if let modern = object as? any NSAccessibilityProtocol { return modern.accessibilityFrame() }
        // KVC boxes a struct return; perform(_:), which expects an object,
        // cannot be used for a CGRect or a Boolean selector.
        if object.responds(to: NSSelectorFromString("accessibilityFrame")),
           let value = object.value(forKey: "accessibilityFrame") as? NSValue { return value.rectValue }
        guard let position = legacy(.position) as? NSValue, let size = legacy(.size) as? NSValue else { return .zero }
        return CGRect(origin: position.pointValue, size: size.sizeValue)
    }
    func isAccessibilityEnabled() -> Bool {
        if let modern = object as? any NSAccessibilityProtocol { return modern.isAccessibilityEnabled() }
        if object.responds(to: NSSelectorFromString("isAccessibilityEnabled")),
           let value = object.value(forKey: "accessibilityEnabled") as? NSNumber { return value.boolValue }
        return (legacy(.enabled) as? NSNumber)?.boolValue ?? false
    }
    func accessibilityPerformPress() -> Bool {
        if let modern = object as? any NSAccessibilityProtocol { return modern.accessibilityPerformPress() }
        let selector = NSSelectorFromString("accessibilityPerformPress")
        if object.responds(to: selector), let implementation = object.method(for: selector) {
            typealias Press = @convention(c) (AnyObject, Selector) -> Bool
            return unsafeBitCast(implementation, to: Press.self)(object, selector)
        }
        guard object.accessibilityActionNames().contains(.press) else { return false }
        object.accessibilityPerformAction(.press)
        return true
    }
    fileprivate var children: [Any] {
        guard let children = attribute(.children, getter: "accessibilityChildren") as? [Any] else { return [] }
        return NSAccessibility.unignoredChildren(from: children)
    }
    private func attribute(_ name: NSAccessibility.Attribute, getter: String) -> Any? {
        let selector = NSSelectorFromString(getter)
        if object.responds(to: selector), let value = object.perform(selector)?.takeUnretainedValue() { return value }
        return legacy(name)
    }
    private func legacy(_ name: NSAccessibility.Attribute) -> Any? {
        guard object.accessibilityAttributeNames().contains(name) else { return nil }
        return object.accessibilityAttributeValue(name)
    }
}

@MainActor
func nativeMacAccessibilityTree(_ root: Any) -> [NativeMacAccessibilityElement] {
    var result: [NativeMacAccessibilityElement] = []
    var seen = Set<ObjectIdentifier>()
    func visit(_ value: Any, depth: Int) {
        guard depth < 256, let object = value as? NSObject,
              seen.insert(ObjectIdentifier(object)).inserted else { return }
        // Retain proxies so allocations during traversal cannot reuse IDs.
        let element = NativeMacAccessibilityElement(object: object)
        result.append(element)
        for child in element.children { visit(child, depth: depth + 1) }
        if let view = object as? NSView {
            for child in view.subviews { visit(child, depth: depth + 1) }
        }
    }
    visit(root, depth: 0)
    return result
}
#endif
