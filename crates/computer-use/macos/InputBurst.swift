import AppKit
import CoreGraphics
import Foundation

extension InputSimulation {
    // Assigned only around a serialized input call, never by the preview stream.
    static var isCancelled: () -> Bool = { false }

    static func burst(app: RunningAppDescriptor, arguments: [String: Any]) throws {
        guard let duration = arguments["duration_ms"] as? Int, (1...2000).contains(duration) else {
            throw ComputerUseError.invalidArguments("duration_ms must be 1-2000")
        }
        let names = arguments["keys"] as? [String] ?? []
        let buttonNames = arguments["buttons"] as? [String] ?? []
        guard names.count <= 8, buttonNames.count <= 3 else { throw ComputerUseError.invalidArguments("Too many held inputs") }
        let modifierNames = ["shift", "ctrl", "control", "alt", "option", "meta", "cmd", "command", "super"]
        let parsed = try names.map { name in
            (try KeyPressParser.parse(modifierNames.contains(name.lowercased()) ? "\(name)+a" : name),
             modifierNames.contains(name.lowercased()))
        }
        var keys: [CGKeyCode] = []
        for (key, modifierOnly) in parsed {
            for code in key.modifiers.map(\.keyCode) + (modifierOnly ? [] : [key.keyCode]) where !keys.contains(code) {
                keys.append(code)
            }
        }
        let flags = parsed.flatMap { $0.0.modifiers }.reduce(actionFlags) { $0.union($1.flag) }
        let buttons = try buttonNames.map { name -> MouseButtonKind in
            guard let button = MouseButtonKind(rawValue: name) else { throw ComputerUseError.invalidArguments("Unknown mouse button") }
            return button
        }
        let dx = arguments["dx"] as? Int ?? 0
        let dy = arguments["dy"] as? Int ?? 0
        guard (-4096...4096).contains(dx), (-4096...4096).contains(dy) else { throw ComputerUseError.invalidArguments("Invalid relative movement") }
        var heldKeys: [CGKeyCode] = []
        var heldButtons: [MouseButtonKind] = []
        func mouse(_ button: MouseButtonKind, _ type: CGEventType, _ point: CGPoint) throws {
            guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button.cgButton) else {
                throw ComputerUseError.message("Cannot create mouse input")
            }
            event.flags = flags
            event.post(tap: .cghidEventTap)
        }
        defer {
            let point = CGEvent(source: nil)?.location ?? .zero
            for button in heldButtons.reversed() { try? mouse(button, button.upEvent, point) }
            for key in heldKeys.reversed() {
                CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)?.post(tap: .cghidEventTap)
            }
        }
        guard app.runningApplication.isActive, !isCancelled() else { throw ComputerUseError.message("Target is not focused or input was cancelled") }
        for key in keys {
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true) else { throw ComputerUseError.message("Cannot create key input") }
            heldKeys.append(key)
            event.flags = flags
            event.post(tap: .cghidEventTap)
        }
        for button in buttons {
            heldButtons.append(button)
            try mouse(button, button.downEvent, CGEvent(source: nil)?.location ?? .zero)
        }
        let started = ProcessInfo.processInfo.systemUptime
        let steps = max(1, (duration + 7) / 8)
        var sentX = 0
        var sentY = 0
        for step in 1...steps {
            guard !isCancelled(), app.runningApplication.isActive else { throw ComputerUseError.message("Input stopped; held keys and buttons released") }
            let x = dx * step / steps
            let y = dy * step / steps
            let deltaX = x - sentX
            let deltaY = y - sentY
            if deltaX != 0 || deltaY != 0 {
                let point = CGEvent(source: nil)?.location ?? .zero
                let button = buttons.first ?? .left
                guard let event = CGEvent(mouseEventSource: nil, mouseType: buttons.isEmpty ? .mouseMoved : button.dragEvent,
                    mouseCursorPosition: CGPoint(x: point.x + CGFloat(deltaX), y: point.y + CGFloat(deltaY)), mouseButton: button.cgButton) else { throw ComputerUseError.message("Cannot create pointer movement") }
                event.flags = flags
                event.setIntegerValueField(.mouseEventDeltaX, value: Int64(deltaX))
                event.setIntegerValueField(.mouseEventDeltaY, value: Int64(deltaY))
                event.post(tap: .cghidEventTap)
            }
            sentX = x
            sentY = y
            let deadline = started + Double(duration * step) / Double(steps * 1000)
            Thread.sleep(forTimeInterval: max(0, deadline - ProcessInfo.processInfo.systemUptime))
        }
    }
}
