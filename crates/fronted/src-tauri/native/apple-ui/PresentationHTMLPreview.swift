import SwiftUI
import WebKit

enum XgentHTMLPreviewContent {
    static func decode(source: String, encoded: String) -> String? {
        if !source.isEmpty { return source }
        if encoded.isEmpty { return source }
        let payload = encoded.split(separator: ",", maxSplits: 1).last.map(String.init) ?? encoded
        guard let bytes = Data(base64Encoded: payload) else { return nil }
        return String(data: bytes, encoding: .utf8)
    }

    static func allows(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.absoluteString == "about:blank" || ["http", "https"].contains(url.scheme?.lowercased() ?? "")
    }
}

// Artifact HTML has its own ephemeral data store and no Tauri script handlers.
// It never shares the application transport or the AI browser session.
@MainActor final class XgentHTMLPreviewCoordinator: NSObject, WKNavigationDelegate {
    private var source: String?
    private var attempt = -1
    private var generation = 0
    private var navigation: WKNavigation?
    private var active = true
    var onState: (Bool, String?) -> Void

    init(onState: @escaping (Bool, String?) -> Void) { self.onState = onState }

    func makeView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = WKUserContentController()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        return view
    }

    func update(_ view: WKWebView, source: String, attempt: Int) {
        guard active, self.source != source || self.attempt != attempt else { return }
        self.source = source
        self.attempt = attempt
        generation += 1
        view.stopLoading()
        publish(loading: true)
        navigation = view.loadHTMLString(source, baseURL: nil)
    }

    private func publish(loading: Bool, error: String? = nil) {
        let revision = generation
        DispatchQueue.main.async { [weak self] in
            guard let self, self.active, self.generation == revision else { return }
            self.onState(loading, error)
        }
    }

    func retire(_ view: WKWebView) {
        active = false
        generation += 1
        navigation = nil
        view.navigationDelegate = nil
        view.stopLoading()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(XgentHTMLPreviewContent.allows(navigationAction.request.url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard active, navigation === self.navigation else { return }
        publish(loading: false)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard active else { return }
        self.navigation = navigation
        publish(loading: true)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard active, navigation === self.navigation else { return }
        publish(loading: false, error: error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        self.webView(webView, didFail: navigation, withError: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard active else { return }
        publish(loading: false, error: "The preview process stopped. Reload to continue.")
    }
}

#if os(iOS)
private struct XgentHTMLWebView: UIViewRepresentable {
    let source: String
    let attempt: Int
    let onState: (Bool, String?) -> Void
    func makeCoordinator() -> XgentHTMLPreviewCoordinator { .init(onState: onState) }
    func makeUIView(context: Context) -> WKWebView { context.coordinator.makeView() }
    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onState = onState
        context.coordinator.update(view, source: source, attempt: attempt)
    }
    static func dismantleUIView(_ view: WKWebView, coordinator: XgentHTMLPreviewCoordinator) { coordinator.retire(view) }
}
#else
private struct XgentHTMLWebView: NSViewRepresentable {
    let source: String
    let attempt: Int
    let onState: (Bool, String?) -> Void
    func makeCoordinator() -> XgentHTMLPreviewCoordinator { .init(onState: onState) }
    func makeNSView(context: Context) -> WKWebView { context.coordinator.makeView() }
    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.onState = onState
        context.coordinator.update(view, source: source, attempt: attempt)
    }
    static func dismantleNSView(_ view: WKWebView, coordinator: XgentHTMLPreviewCoordinator) { coordinator.retire(view) }
}
#endif

struct XgentHTMLPreview: View {
    let source: String
    let encoded: String
    let label: String
    @State private var loading = true
    @State private var failure: String?
    @State private var attempt = 0

    var body: some View {
        Group {
            if let html = XgentHTMLPreviewContent.decode(source: source, encoded: encoded) {
                ZStack {
                    XgentHTMLWebView(source: html, attempt: attempt) { loading, error in
                        self.loading = loading
                        failure = error
                    }
                    if loading { ProgressView().allowsHitTesting(false) }
                    if let failure {
                        VStack(spacing: 12) {
                            Label(failure, systemImage: "exclamationmark.triangle")
                                .fixedSize(horizontal: false, vertical: true)
                            Button { attempt += 1 } label: {
                                Image(systemName: "arrow.clockwise")
                            }
                            .accessibilityLabel("Reload preview")
                        }
                        .padding(20)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            } else {
                Label("The HTML preview could not be decoded.", systemImage: "doc.questionmark")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(label)
    }
}
