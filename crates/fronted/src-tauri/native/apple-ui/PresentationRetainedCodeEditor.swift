import SwiftUI
#if os(iOS)
import UIKit

@MainActor
struct XgentRetainedCodeEditor: UIViewControllerRepresentable {
    let session: XgentCodeSessionIdentity
    let store: XgentCodeHostStore
    let configuration: XgentCodeEditor
    let content: String
    let environment: XgentCodeHostEnvironment
    let changed: (String) -> Void
    final class Coordinator {
        let lease = UUID()
        var entry: XgentCodeHost?
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIViewController(context: Context) -> UIViewController {
        let container = UIViewController()
        container.view = XgentCodeMountView()
        container.view.backgroundColor = .clear
        install(in: container, coordinator: context.coordinator)
        return container
    }
    func updateUIViewController(_ container: UIViewController, context: Context) {
        install(in: container, coordinator: context.coordinator)
    }
    private func install(in container: UIViewController, coordinator: Coordinator) {
        guard let entry = store.acquire(session, content: content) else {
            coordinator.entry?.detach(coordinator.lease); coordinator.entry = nil; return
        }
        if coordinator.entry !== entry { coordinator.entry?.detach(coordinator.lease); coordinator.entry = entry }
        if let mount = container.view as? XgentCodeMountView { mount.entry = entry; mount.lease = coordinator.lease }
        entry.update(lease: coordinator.lease, configuration: configuration, content: content, environment: environment, changed: changed)
        let host = entry.hosting
        if host.parent !== container {
            if host.parent != nil { host.willMove(toParent: nil); host.view.removeFromSuperview(); host.removeFromParent() }
            container.addChild(host)
            host.view.translatesAutoresizingMaskIntoConstraints = false
            host.view.backgroundColor = .clear
            container.view.addSubview(host.view)
            NSLayoutConstraint.activate([
                host.view.leadingAnchor.constraint(equalTo: container.view.leadingAnchor),
                host.view.trailingAnchor.constraint(equalTo: container.view.trailingAnchor),
                host.view.topAnchor.constraint(equalTo: container.view.topAnchor),
                host.view.bottomAnchor.constraint(equalTo: container.view.bottomAnchor),
            ])
            host.didMove(toParent: container)
        }
    }
    static func dismantleUIViewController(_ container: UIViewController, coordinator: Coordinator) {
        coordinator.entry?.detach(coordinator.lease); coordinator.entry = nil
    }
}
#else
import AppKit

@MainActor
struct XgentRetainedCodeEditor: NSViewRepresentable {
    let session: XgentCodeSessionIdentity
    let store: XgentCodeHostStore
    let configuration: XgentCodeEditor
    let content: String
    let environment: XgentCodeHostEnvironment
    let changed: (String) -> Void
    final class Coordinator {
        let lease = UUID()
        var entry: XgentCodeHost?
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSView {
        let container = XgentCodeMountView()
        install(in: container, coordinator: context.coordinator)
        return container
    }
    func updateNSView(_ container: NSView, context: Context) { install(in: container, coordinator: context.coordinator) }
    private func install(in container: NSView, coordinator: Coordinator) {
        guard let entry = store.acquire(session, content: content) else {
            coordinator.entry?.detach(coordinator.lease); coordinator.entry = nil; return
        }
        if coordinator.entry !== entry { coordinator.entry?.detach(coordinator.lease); coordinator.entry = entry }
        if let mount = container as? XgentCodeMountView { mount.entry = entry; mount.lease = coordinator.lease }
        entry.update(lease: coordinator.lease, configuration: configuration, content: content, environment: environment, changed: changed)
        let host = entry.hosting
        if host.superview !== container {
            host.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(host)
            NSLayoutConstraint.activate([
                host.leadingAnchor.constraint(equalTo: container.leadingAnchor), host.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                host.topAnchor.constraint(equalTo: container.topAnchor), host.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            ])
        }
    }
    static func dismantleNSView(_ container: NSView, coordinator: Coordinator) {
        coordinator.entry?.detach(coordinator.lease); coordinator.entry = nil
    }
}
#endif
