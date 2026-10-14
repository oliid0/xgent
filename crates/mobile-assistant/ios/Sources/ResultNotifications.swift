import Foundation
import Tauri
import UserNotifications

private struct ResultNotificationArgs: Decodable { let entryId: String }

/// Generic result notices only. OS acceptance never acknowledges an inbox entry.
enum ResultNotifications {
    private static var pending = Set<String>() // Accessed only on the main queue.
    private static let prefix = "xgent.result."

    static func permissionState(_ settings: UNNotificationSettings) -> String {
        switch settings.authorizationStatus {
        case .notDetermined: return "prompt"
        case .denied: return "denied"
        case .authorized, .provisional, .ephemeral:
            return settings.alertSetting == .enabled ? "granted" : "denied"
        @unknown default: return "denied"
        }
    }

    static func post(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ResultNotificationArgs.self)
        post(entryId: args.entryId) { result in
            switch result {
            case .success(let receipt): invoke.resolve(receipt)
            case .failure(let error): invoke.reject(error.localizedDescription)
            }
        }
    }

    /// Shared with the OS refresh worker. No WebView/Invoke or permission
    /// request is needed; retain only actual OS acceptance for this exact ID.
    static func post(entryId: String, cancelled: @escaping () -> Bool = { false },
                     completion: @escaping (Result<String, Error>) -> Void) {
        guard UUID(uuidString: entryId)?.uuidString.lowercased() == entryId else {
            completion(.failure(ResultDeliveryStorage.failure("A canonical inbox entry ID is required"))); return
        }
        let identifier = prefix + entryId
        let receiptKey = identifier + ".accepted"
        DispatchQueue.main.async {
            guard !cancelled() else { completion(.failure(ResultDeliveryStorage.failure("Result notice stopped"))); return }
            if UserDefaults.standard.bool(forKey: receiptKey) {
                completion(.success("accepted")); return
            }
            guard pending.insert(identifier).inserted else {
                completion(.failure(ResultDeliveryStorage.failure("Result notification is already in flight"))); return
            }
            let center = UNUserNotificationCenter.current()
            let finish: (Error?) -> Void = { error in
                DispatchQueue.main.async {
                    pending.remove(identifier)
                    if let error { completion(.failure(error)); return }
                    // Retain the OS receipt even if the later Rust SQLite write fails.
                    UserDefaults.standard.set(true, forKey: receiptKey)
                    completion(.success("accepted"))
                }
            }
            center.getNotificationSettings { settings in
                guard permissionState(settings) == "granted" else {
                    DispatchQueue.main.async {
                        pending.remove(identifier)
                        completion(.success("blocked"))
                    }
                    return
                }
                // Recover a crash after OS submission but before recording acceptance.
                center.getPendingNotificationRequests { requests in
                    if requests.contains(where: { $0.identifier == identifier }) {
                        finish(nil); return
                    }
                    center.getDeliveredNotifications { notifications in
                        if notifications.contains(where: { $0.request.identifier == identifier }) {
                            finish(nil); return
                        }
                        guard !cancelled() else { finish(ResultDeliveryStorage.failure("Result notice expired")); return }
                        let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
                        let content = UNMutableNotificationContent()
                        content.title = "Xgent"
                        content.body = chinese ? "有任务结果可供查看。请打开应用收件箱。"
                            : "A task result is available. Open the app inbox."
                        content.sound = .default
                        // No task name, preview, health sample, or external attachment.
                        center.add(UNNotificationRequest(identifier: identifier,
                            content: content, trigger: nil), withCompletionHandler: finish)
                    }
                }
            }
        }
    }

    static func remove(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ResultNotificationArgs.self)
        guard UUID(uuidString: args.entryId)?.uuidString.lowercased() == args.entryId else {
            invoke.reject("A canonical inbox entry ID is required"); return
        }
        let identifiers = [prefix + args.entryId]
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
        invoke.resolve()
    }
}
