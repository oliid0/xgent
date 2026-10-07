import SwiftUI

struct XgentBackupConnectionFields: View {
    let node: XgentNode
    let document: XgentDocument
    @ObservedObject var model: XgentPresentationModel

    private func item(_ id: String) -> XgentNode? { node.children?.first { $0.id == id } }

    @ViewBuilder private func field(_ id: String) -> some View {
        if let item = item(id) {
            #if os(iOS)
            XgentIOSNode(node: item, document: document, model: model)
            #else
            XgentNodeView(node: item, document: document, model: model)
            #endif
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            field("backup-preset")
            field("backup-url")
            XgentBackupFieldPair(mobile: document.formFactor == .mobile) {
                field("backup-username")
            } second: {
                VStack(alignment: .leading, spacing: 8) {
                    field("backup-password")
                    field("backup-password-saved")
                    field("backup-clear-password")
                }
            }
            XgentBackupFieldPair(mobile: document.formFactor == .mobile) {
                field("backup-directory")
            } second: {
                field("backup-profile")
            }
            field("backup-profile-hint")
            field("backup-auto")
        }
    }
}
