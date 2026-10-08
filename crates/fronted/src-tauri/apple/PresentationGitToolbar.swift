#if os(macOS)
import Flow
import SwiftUI

/// Branch at the leading edge, real controller actions at the trailing edge.
struct XgentGitToolbar: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel
    @Environment(\.xgentPresentationTheme) private var theme
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dynamicTypeSize) private var textSize

    private var branch: XgentNode? { document.node(id: "git-branches") }
    private var head: XgentNode? { document.node(id: "git-head") }
    private let icons = ["git-ai-review": "sparkles", "git-refresh": "arrow.clockwise",
                         "git-fetch": "cloud", "git-pull": "arrow.down", "git-push": "arrow.up", "git-close": "xmark"]
    private var actions: [XgentNode] {
        ["git-ai-review", "git-refresh", "git-fetch", "git-pull", "git-push", "git-close"].compactMap { document.node(id: $0) }
    }

    @ViewBuilder private var branchControl: some View {
        if let branch {
            Button { model.send(branch, in: document) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.triangle.branch").foregroundStyle(Color(xgentHex: theme.palette(for: scheme).accentText))
                    Text(head?.text ?? branch.label ?? "").lineLimit(1)
                    Image(systemName: "chevron.down").font(.caption2).foregroundStyle(.secondary)
                }
                .modifier(XgentControlTypography(node: branch))
                .padding(.horizontal, 8).frame(minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(Color(xgentHex: theme.palette(for: scheme).muted),
                        in: RoundedRectangle(cornerRadius: CGFloat(theme.radius.inner), style: .continuous))
            .disabled(branch.disabled == true || model.isBusy(branch, in: document))
            .accessibilityLabel("\(branch.label ?? "") · \(head?.text ?? "")")
            .accessibilityIdentifier(branch.id)
            .help(head?.text ?? branch.label ?? "")
        } else if let head {
            Text(head.text ?? "").modifier(XgentControlTypography(node: head))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var actionButtons: some View {
        HFlow(alignment: .top, spacing: 4) {
            ForEach(actions) { action in
                Button { model.send(action, in: document) } label: {
                    Group {
                        if model.isBusy(action, in: document) { ProgressView().controlSize(.small) }
                        else { Image(systemName: icons[action.id] ?? "ellipsis") }
                    }.frame(minWidth: 32, minHeight: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain).modifier(XgentControlTypography(node: action))
                .disabled(action.disabled == true || model.isBusy(action, in: document))
                .accessibilityLabel(action.label ?? "").accessibilityIdentifier(action.id)
                .help(action.label ?? "")
            }
        }
    }

    private var stackedHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            branchControl
            actionButtons.frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    @ViewBuilder private var modeControl: some View {
        if let mode = document.node(id: "git-view") {
            let selection = Binding(get: { model.value(mode, in: document).text },
                                    set: { model.send(mode, in: document, value: .string($0), editing: true) })
            Group {
                if textSize.isAccessibilitySize {
                    Picker(mode.label ?? "", selection: selection) {
                        ForEach(mode.options ?? []) { option in Text(option.label).tag(option.value) }
                    }.pickerStyle(.menu)
                } else {
                    Picker(mode.label ?? "", selection: selection) {
                        ForEach(mode.options ?? []) { option in Text(option.label).tag(option.value) }
                    }.pickerStyle(.segmented)
                }
            }
            .labelsHidden().modifier(XgentControlTypography(node: mode))
            .disabled(mode.disabled == true).accessibilityIdentifier(mode.id)
            .accessibilityLabel(mode.label ?? "")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let repository = document.node(id: "git-repository") {
                XgentSelector(node: repository, document: document, model: model, showsLabel: false)
            }
            if textSize.isAccessibilitySize { stackedHeader }
            else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { branchControl; Spacer(minLength: 0); actionButtons.fixedSize(horizontal: true, vertical: false) }
                    stackedHeader
                }
            }
            if let summary = document.node(id: "git-summary") {
                Text(summary.text ?? "").modifier(XgentControlTypography(node: summary))
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                modeControl.frame(maxWidth: .infinity)
                if let toggle = document.node(id: "git-diff-visible") {
                    Button {
                        model.send(toggle, in: document, value: .bool(!model.value(toggle, in: document).boolean), editing: true)
                    } label: {
                        Image(systemName: model.value(toggle, in: document).boolean ? "eye" : "eye.slash")
                            .frame(minWidth: 32, minHeight: 32).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).disabled(toggle.disabled == true)
                    .accessibilityLabel(toggle.label ?? "").accessibilityIdentifier(toggle.id)
                    .help(toggle.label ?? "")
                }
            }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain).accessibilityIdentifier(node.id)
    }
}
#endif
