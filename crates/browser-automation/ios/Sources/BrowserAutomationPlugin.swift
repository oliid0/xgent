import Foundation
import Tauri
import UIKit
import WebKit

private struct BrowserViewportArgs: Decodable {
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
    let visible: Bool?
    let scaleFactor: Double?
}

private struct OpenSessionArgs: Decodable {
    let sessionId: String
    let url: String
    let viewport: BrowserViewportArgs?
    let userAgent: String?
    let runtimeScript: String
}

private struct SessionArgs: Decodable {
    let sessionId: String
}

private struct SetViewportArgs: Decodable {
    let sessionId: String
    let viewport: BrowserViewportArgs
}

private struct BrowserActionInputArgs: Decodable {
    let url: String?
    let ref: String?
    let selector: String?
    let text: String?
    let key: String?
    let script: String?
    let direction: String?
    let amount: Double?
    let x: Double?
    let y: Double?
    let limit: Double?
    let maxDepth: Double?
    let maxNodes: Double?
    let smooth: Bool?
    let submit: Bool?

    var dictionary: [String: Any] {
        var value: [String: Any] = [:]
        if let url { value["url"] = url }
        if let ref { value["ref"] = ref }
        if let selector { value["selector"] = selector }
        if let text { value["text"] = text }
        if let key { value["key"] = key }
        if let script { value["script"] = script }
        if let direction { value["direction"] = direction }
        if let amount { value["amount"] = amount }
        if let x { value["x"] = x }
        if let y { value["y"] = y }
        if let limit { value["limit"] = limit }
        if let maxDepth { value["maxDepth"] = maxDepth }
        if let maxNodes { value["maxNodes"] = maxNodes }
        if let smooth { value["smooth"] = smooth }
        if let submit { value["submit"] = submit }
        return value
    }
}

private struct ActionArgs: Decodable {
    let sessionId: String
    let action: String
    let input: BrowserActionInputArgs?
    let timeoutMs: UInt64?
    let runtimeScript: String?
}

private enum BrowserAutomationError: LocalizedError {
    case invalidRequest(String)
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let message), .unavailable(let message):
            return message
        }
    }
}

@MainActor
private final class BrowserSession {
    let sessionId: String
    let webView: WKWebView
    var runtimeScript: String
    var title: String?
    var loading = false
    var visible = false
    var navigationDelegate: BrowserNavigationDelegate?

    init(sessionId: String, webView: WKWebView, runtimeScript: String) {
        self.sessionId = sessionId
        self.webView = webView
        self.runtimeScript = runtimeScript
    }
}

@MainActor
private final class BrowserNavigationDelegate: NSObject, WKNavigationDelegate {
    weak var owner: BrowserAutomationPlugin?
    let sessionId: String

    init(owner: BrowserAutomationPlugin, sessionId: String) {
        self.owner = owner
        self.sessionId = sessionId
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(["http", "https"].contains(url.scheme?.lowercased() ?? "") ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        owner?.updateLoading(sessionId: sessionId, loading: true)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        owner?.pageDidFinish(sessionId: sessionId)
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation?,
        withError error: Error
    ) {
        owner?.updateLoading(sessionId: sessionId, loading: false)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation?,
        withError error: Error
    ) {
        owner?.updateLoading(sessionId: sessionId, loading: false)
    }
}

private final class BrowserInvocationGate {
    private let invoke: Invoke
    private var completed = false
    private var timeoutWorkItem: DispatchWorkItem?

    init(invoke: Invoke, timeoutMs: UInt64) {
        self.invoke = invoke
        let normalizedTimeout = min(30_000, max(500, timeoutMs))
        let workItem = DispatchWorkItem { [weak self] in
            self?.reject("Browser action timed out after \(normalizedTimeout) ms")
        }
        timeoutWorkItem = workItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + .milliseconds(Int(normalizedTimeout)),
            execute: workItem
        )
    }

    func resolve(_ payload: [String: Any]) {
        guard !completed else { return }
        completed = true
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        invoke.resolve(payload)
    }

    func reject(_ message: String) {
        guard !completed else { return }
        completed = true
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        invoke.reject(message)
    }
}

private struct BrowserSessionListItem: Encodable {
    let sessionId: String
    let url: String
    let title: String?
    let visible: Bool
    let loading: Bool
}

final class BrowserAutomationPlugin: Plugin {
    @MainActor private var sessions: [String: BrowserSession] = [:]

    @objc func status(_ invoke: Invoke) {
        invoke.resolve([
            "backend": "ios-wk-webview",
            "available": true,
            "detail": "Private WKWebView sessions with an isolated Xgent automation bridge",
            "capabilities": [
                "visibleSessions": true,
                "domAutomation": true,
                "javascript": true,
                "screenshots": true,
                "downloads": false,
                "multipleSessions": true,
            ],
        ])
    }

    @objc func openSession(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(OpenSessionArgs.self)
        let sessionId = try validatedSessionId(request.sessionId)
        let url = try validatedURL(request.url)
        guard !request.runtimeScript.isEmpty else {
            throw BrowserAutomationError.invalidRequest("The browser runtime script is missing")
        }

        Task { @MainActor in
            do {
                if let existing = sessions[sessionId] {
                    existing.runtimeScript = request.runtimeScript
                    applyViewport(request.viewport, to: existing)
                    existing.webView.load(URLRequest(url: url))
                    invoke.resolve(summary(existing))
                    return
                }

                let configuration = WKWebViewConfiguration()
                configuration.websiteDataStore = .nonPersistent()
                configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
                configuration.defaultWebpagePreferences.allowsContentJavaScript = true
                let webView = WKWebView(frame: .zero, configuration: configuration)
                webView.allowsBackForwardNavigationGestures = true
                webView.allowsLinkPreview = false
                webView.scrollView.keyboardDismissMode = .interactive
                if let userAgent = request.userAgent, !userAgent.isEmpty {
                    webView.customUserAgent = userAgent
                }
                if #available(iOS 16.4, *) {
                    webView.isInspectable = false
                }

                let session = BrowserSession(
                    sessionId: sessionId,
                    webView: webView,
                    runtimeScript: request.runtimeScript
                )
                let delegate = BrowserNavigationDelegate(owner: self, sessionId: sessionId)
                session.navigationDelegate = delegate
                webView.navigationDelegate = delegate
                try rootView().addSubview(webView)
                sessions[sessionId] = session
                applyViewport(request.viewport, to: session)
                webView.load(URLRequest(url: url))
                invoke.resolve(summary(session))
            } catch {
                invoke.reject("Failed to create browser session: \(error.localizedDescription)")
            }
        }
    }

    @objc func listSessions(_ invoke: Invoke) {
        Task { @MainActor in
            let payload = sessions.values.map(sessionListItem).sorted {
                $0.sessionId < $1.sessionId
            }
            invoke.resolve(payload)
        }
    }

    @objc func closeSession(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(SessionArgs.self)
        let sessionId = try validatedSessionId(request.sessionId)
        Task { @MainActor in
            guard let session = sessions.removeValue(forKey: sessionId) else {
                invoke.reject("Browser session was not found")
                return
            }
            let response = summary(session)
            session.webView.stopLoading()
            session.webView.navigationDelegate = nil
            session.webView.removeFromSuperview()
            invoke.resolve(response)
        }
    }

    @objc func setViewport(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(SetViewportArgs.self)
        let sessionId = try validatedSessionId(request.sessionId)
        Task { @MainActor in
            guard let session = sessions[sessionId] else {
                invoke.reject("Browser session was not found")
                return
            }
            applyViewport(request.viewport, to: session)
            invoke.resolve(summary(session))
        }
    }

    @objc func action(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(ActionArgs.self)
        let sessionId = try validatedSessionId(request.sessionId)
        let action = request.action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !action.isEmpty else {
            throw BrowserAutomationError.invalidRequest("Browser action is required")
        }
        Task { @MainActor in
            guard let session = sessions[sessionId] else {
                invoke.reject("Browser session was not found")
                return
            }
            if let runtimeScript = request.runtimeScript, !runtimeScript.isEmpty {
                session.runtimeScript = runtimeScript
            }
            executeAction(
                invoke,
                session: session,
                action: action,
                timeoutMs: request.timeoutMs ?? 30_000,
                input: request.input ?? BrowserActionInputArgs(
                    url: nil,
                    ref: nil,
                    selector: nil,
                    text: nil,
                    key: nil,
                    script: nil,
                    direction: nil,
                    amount: nil,
                    x: nil,
                    y: nil,
                    limit: nil,
                    maxDepth: nil,
                    maxNodes: nil,
                    smooth: nil,
                    submit: nil
                )
            )
        }
    }

    @MainActor
    fileprivate func updateLoading(sessionId: String, loading: Bool) {
        sessions[sessionId]?.loading = loading
    }

    @MainActor
    fileprivate func pageDidFinish(sessionId: String) {
        guard let session = sessions[sessionId] else { return }
        session.loading = false
        session.title = session.webView.title
        session.webView.evaluateJavaScript(session.runtimeScript)
    }

    @MainActor
    private func executeAction(
        _ invoke: Invoke,
        session: BrowserSession,
        action: String,
        timeoutMs: UInt64,
        input: BrowserActionInputArgs
    ) {
        switch action {
        case "navigate":
            do {
                guard let target = input.url else {
                    throw BrowserAutomationError.invalidRequest("navigate requires input.url")
                }
                session.webView.load(URLRequest(url: try validatedURL(target)))
                invoke.resolve(actionResponse(
                    session,
                    action: action,
                    data: ["navigated": true, "url": target]
                ))
            } catch {
                invoke.reject(error.localizedDescription)
            }
        case "reload":
            session.webView.reload()
            invoke.resolve(actionResponse(session, action: action, data: ["reloaded": true]))
        case "go_back":
            if session.webView.canGoBack { session.webView.goBack() }
            invoke.resolve(actionResponse(session, action: action, data: ["navigated": true]))
        case "go_forward":
            if session.webView.canGoForward { session.webView.goForward() }
            invoke.resolve(actionResponse(session, action: action, data: ["navigated": true]))
        case "screenshot":
            captureScreenshot(invoke, session: session, action: action, timeoutMs: timeoutMs)
        default:
            evaluateDOMAction(
                invoke,
                session: session,
                action: action,
                input: input.dictionary,
                timeoutMs: timeoutMs
            )
        }
    }

    @MainActor
    private func evaluateDOMAction(
        _ invoke: Invoke,
        session: BrowserSession,
        action: String,
        input: [String: Any],
        timeoutMs: UInt64
    ) {
        let gate = BrowserInvocationGate(invoke: invoke, timeoutMs: timeoutMs)
        do {
            let actionJSON = try jsonLiteral(action)
            let inputJSON = try jsonLiteral(input)
            let script = """
            (() => {
              if (!window.__xgentBrowserRuntime) {
                \(session.runtimeScript)
              }
              return window.__xgentBrowserRuntime.execute(\(actionJSON), \(inputJSON));
            })()
            """
            session.webView.evaluateJavaScript(script) { [weak self] result, error in
                guard let self else { return }
                if let error {
                    gate.reject("Browser action failed: \(error.localizedDescription)")
                    return
                }
                do {
                    guard let raw = result as? String,
                          let data = raw.data(using: .utf8),
                          let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    else {
                        throw BrowserAutomationError.invalidRequest("Browser returned an invalid response")
                    }
                    if envelope["ok"] as? Bool != true {
                        throw BrowserAutomationError.invalidRequest(
                            envelope["error"] as? String ?? "Browser DOM action failed"
                        )
                    }
                    gate.resolve(self.actionResponse(
                        session,
                        action: action,
                        data: envelope["data"] ?? NSNull()
                    ))
                } catch {
                    gate.reject("Browser action failed: \(error.localizedDescription)")
                }
            }
        } catch {
            gate.reject("Browser action failed: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func captureScreenshot(
        _ invoke: Invoke,
        session: BrowserSession,
        action: String,
        timeoutMs: UInt64
    ) {
        let gate = BrowserInvocationGate(invoke: invoke, timeoutMs: timeoutMs)
        let configuration = WKSnapshotConfiguration()
        configuration.rect = session.webView.bounds
        session.webView.takeSnapshot(with: configuration) { [weak self] image, error in
            guard let self else { return }
            if let error {
                gate.reject("Browser screenshot failed: \(error.localizedDescription)")
                return
            }
            guard let image, let data = image.pngData() else {
                gate.reject("Browser screenshot returned no image")
                return
            }
            gate.resolve(self.actionResponse(
                session,
                action: action,
                data: [
                    "width": image.size.width,
                    "height": image.size.height,
                    "mimeType": "image/png",
                ],
                screenshotBase64: data.base64EncodedString()
            ))
        }
    }

    @MainActor
    private func applyViewport(_ raw: BrowserViewportArgs?, to session: BrowserSession) {
        let x = CGFloat(max(0, raw?.x ?? 0))
        let y = CGFloat(max(0, raw?.y ?? 0))
        let width = CGFloat(max(1, raw?.width ?? 1))
        let height = CGFloat(max(1, raw?.height ?? 1))
        session.webView.frame = CGRect(
            x: x,
            y: y,
            width: width,
            height: height
        )
        session.visible = raw?.visible ?? false
        session.webView.isHidden = !session.visible
        if session.visible {
            session.webView.superview?.bringSubviewToFront(session.webView)
        }
    }

    @MainActor
    private func summary(_ session: BrowserSession) -> [String: Any] {
        [
            "sessionId": session.sessionId,
            "url": session.webView.url?.absoluteString ?? "",
            "title": session.title.map { $0 as Any } ?? NSNull(),
            "visible": session.visible,
            "loading": session.loading,
        ]
    }

    @MainActor
    private func sessionListItem(_ session: BrowserSession) -> BrowserSessionListItem {
        BrowserSessionListItem(
            sessionId: session.sessionId,
            url: session.webView.url?.absoluteString ?? "",
            title: session.title,
            visible: session.visible,
            loading: session.loading
        )
    }

    @MainActor
    private func actionResponse(
        _ session: BrowserSession,
        action: String,
        data: Any,
        screenshotBase64: String? = nil
    ) -> [String: Any] {
        [
            "sessionId": session.sessionId,
            "action": action,
            "url": session.webView.url?.absoluteString ?? "",
            "title": session.title.map { $0 as Any } ?? NSNull(),
            "data": data,
            "screenshotBase64": screenshotBase64.map { $0 as Any } ?? NSNull(),
        ]
    }

    @MainActor
    private func rootView() throws -> UIView {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
            ?? scenes.flatMap(\.windows).first
        guard let view = window?.rootViewController?.view else {
            throw BrowserAutomationError.unavailable("The iOS application view is unavailable")
        }
        return view
    }

    private func validatedSessionId(_ raw: String) throws -> String {
        let sessionId = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        guard !sessionId.isEmpty,
              sessionId.count <= 64,
              sessionId.unicodeScalars.allSatisfy({ allowed.contains($0) })
        else {
            throw BrowserAutomationError.invalidRequest(
                "sessionId must contain 1-64 ASCII letters, digits, '-' or '_'"
            )
        }
        return sessionId
    }

    private func validatedURL(_ raw: String) throws -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: normalized),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil
        else {
            throw BrowserAutomationError.invalidRequest(
                "Browser navigation only supports valid http and https URLs"
            )
        }
        return url
    }

    private func jsonLiteral(_ value: Any) throws -> String {
        if let string = value as? String {
            let data = try JSONSerialization.data(withJSONObject: [string])
            let array = String(decoding: data, as: UTF8.self)
            return String(array.dropFirst().dropLast())
        }
        let data = try JSONSerialization.data(withJSONObject: value)
        return String(decoding: data, as: UTF8.self)
    }
}

@_cdecl("init_plugin_browser_automation")
func initPlugin() -> Plugin {
    BrowserAutomationPlugin()
}
