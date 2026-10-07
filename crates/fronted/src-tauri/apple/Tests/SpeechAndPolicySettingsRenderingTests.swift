import Foundation
import SnapshotTesting
import SwiftUI
import XCTest
#if os(iOS)
import AccessibilitySnapshotParser
import UIKit
#else
import AppKit
#endif
@testable import XgentNativeUI

final class SpeechAndPolicySettingsRenderingTests: XCTestCase {
    @MainActor func testSpeechCredentialsAndPoliciesFitNarrowAndAccessibilityLayouts() async throws {
        #if os(iOS)
        let widths: [CGFloat] = [320, 430, 768]
        #else
        let widths: [CGFloat] = [480, 1040]
        #endif
        for width in widths {
            for size in [DynamicTypeSize.large, .accessibility3] {
                for voice in [false, true] {
                    let document = try fixture(voice: voice)
                    let model = XgentPresentationModel()
                    model.update(document)
                    let content = ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            #if os(iOS)
                            XgentIOSNodes(nodes: document.nodes, document: document, model: model)
                            #else
                            ForEach(document.nodes) { XgentNodeView(node: $0, document: document, model: model) }
                            #endif
                        }.padding(16)
                    }.frame(width: width, height: 920).dynamicTypeSize(size)
                        .modifier(XgentPresentationThemeModifier(theme: .fallback,
                            appearance: size == .large ? .light : .dark))
                    #if os(iOS)
                    let host = UIHostingController(rootView: content)
                    host.safeAreaRegions = []
                    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 920))
                    window.rootViewController = host
                    window.makeKeyAndVisible()
                    defer { window.isHidden = true; window.rootViewController = nil }
                    host.view.layoutIfNeeded()
                    try await Task.sleep(nanoseconds: 150_000_000)
                    if voice {
                        let elements = AccessibilityHierarchyParser().parseAccessibilityHierarchy(in: host.view).flattenToElements()
                        let field = try XCTUnwrap(elements.first { $0.identifier == "voice:tencent_cloud:secretKey" })
                        XCTAssertTrue(field.traits.contains(.secureTextField))
                        XCTAssertLessThanOrEqual(field.shape.bezierPath.bounds.maxX, width + 1)
                        XCTAssertGreaterThanOrEqual(field.shape.bezierPath.bounds.minX, -1)
                    }
                    let strategy = Snapshotting<UIView, UIImage>.image(size: CGSize(width: width, height: 920))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(host.view).run { continuation.resume(returning: $0) }
                    }
                    #else
                    let host = NSHostingView(rootView: content)
                    host.frame = CGRect(x: 0, y: 0, width: width, height: 920)
                    host.layoutSubtreeIfNeeded()
                    XCTAssertLessThanOrEqual(host.fittingSize.width, width + 1)
                    let strategy = Snapshotting<NSView, NSImage>.image(size: CGSize(width: width, height: 920))
                    let image = await withCheckedContinuation { continuation in
                        strategy.snapshot(host).run { continuation.resume(returning: $0) }
                    }
                    #endif
                    let attachment = XCTAttachment(image: image)
                    attachment.name = "\(voice ? "speech" : "policies")-\(Int(width))-\(size)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    model.invalidate()
                }
            }
        }
    }

    private func fixture(voice: Bool) throws -> XgentDocument {
        let credentials: [String: Any] = ["id": "voice-credentials", "kind": "VStack", "variant": "voice-credentials", "children": [
            ["id": "voice:tencent_cloud:appId", "kind": "TextInput", "label": "AppId", "value": "123456", "action": "appId"],
            ["id": "voice:tencent_cloud:engineModelType", "kind": "TextInput", "label": "Engine Model Type", "value": "16k_zh", "action": "engine"],
            ["id": "voice:tencent_cloud:secretId", "kind": "TextInput", "label": "SecretId", "value": "", "secure": true, "text": "已保存，留空保持原凭据", "action": "secretId"],
            ["id": "voice:tencent_cloud:secretKey", "kind": "TextInput", "label": "SecretKey", "value": "", "secure": true, "text": "已保存，留空保持原凭据", "action": "secretKey"],
        ]]
        let policy: [String: Any] = ["id": "policy:Bash:row", "kind": "VStack", "variant": "tool-policy-row", "label": "执行 Shell 命令", "text": "Bash", "children": [
            ["id": "policy:Bash", "kind": "Selector", "label": "执行 Shell 命令", "accessibilityLabel": "执行 Shell 命令 (Bash)", "value": "ask", "action": "policy",
             "options": [["value": "allow", "label": "允许"], ["value": "ask", "label": "每次询问"], ["value": "deny", "label": "禁止"]]],
            ["id": "policy:Bash:description", "kind": "Text", "secondary": true, "text": "在当前工作空间执行命令，并按照执行模式和工具权限请求用户确认。长说明应自动换行，不挤压权限选择框。"],
        ]]
        let actions: [String: Any] = ["id": "category:process:actions", "kind": "VStack", "variant": "tool-category-actions", "label": "应用到整个类别", "children": [
            ["id": "category:process:allow", "kind": "Button", "label": "允许", "action": "allow"],
            ["id": "category:process:ask", "kind": "Button", "label": "每次询问", "action": "ask"],
            ["id": "category:process:deny", "kind": "Button", "label": "禁止", "action": "deny"],
        ]]
        #if os(iOS)
        let factor = "mobile"
        #else
        let factor = "desktop"
        #endif
        let payload: [String: Any] = ["version": 1, "surface": "settings", "revision": 1, "mode": "sheet",
            "title": voice ? "语音输入" : "工具权限", "appearance": "light", "formFactor": factor, "nodes": voice ? [credentials] : [actions, policy]]
        let document = try JSONDecoder().decode(XgentDocument.self, from: JSONSerialization.data(withJSONObject: payload))
        try document.validate()
        return document
    }
}
