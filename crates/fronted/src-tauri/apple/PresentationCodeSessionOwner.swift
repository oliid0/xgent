import Foundation
import SwiftUI

@MainActor
final class XgentCodeSessionOwner: ObservableObject {
    let id = UUID()
    private var prepared = false

    func prepare(_ session: XgentCodeSessionIdentity?, store: XgentCodeSessionStore?) {
        guard !prepared, let session, let store else { return }
        prepared = true; store.prepare(session, owner: id, restoring: true)
    }
    func appear(_ session: XgentCodeSessionIdentity?, store: XgentCodeSessionStore?) {
        guard let session, let store else { return }
        prepared = true; store.prepare(session, owner: id, restoring: true)
    }
}
