import Contacts
import Foundation
import Tauri

private struct ContactListArgs: Decodable { let query: String; let limit: Int }
private struct ContactPayload: Encodable {
    let id: String
    let name: String
    let phones: [String]
    let emails: [String]
}
private struct ContactListPayload: Encodable {
    let contacts: [ContactPayload]
    let truncated: Bool
    let accessLimited: Bool
}

enum ContactsAccess {
    static var permissionState: String {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .authorized { return "granted" }
        if #available(iOS 18.0, *), status == .limited { return "granted" }
        return status == .notDetermined ? "prompt" : "denied"
    }

    static func request(_ completed: @escaping () -> Void) {
        CNContactStore().requestAccess(for: .contacts) { _, _ in
            DispatchQueue.main.async(execute: completed)
        }
    }

    static func list(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ContactListArgs.self)
        guard args.limit >= 1, args.limit <= 200, args.query.utf8.count <= 1024 else {
            invoke.reject("Contact query/limit exceeds its bound"); return
        }
        // Recheck the OS authority at execution; listing never opens a dialog.
        guard permissionState == "granted" else {
            invoke.reject("Contacts permission is required"); return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let request = CNContactFetchRequest(keysToFetch: [
                    CNContactIdentifierKey as CNKeyDescriptor,
                    CNContactGivenNameKey as CNKeyDescriptor,
                    CNContactFamilyNameKey as CNKeyDescriptor,
                    CNContactMiddleNameKey as CNKeyDescriptor,
                    CNContactOrganizationNameKey as CNKeyDescriptor,
                    CNContactPhoneNumbersKey as CNKeyDescriptor,
                    CNContactEmailAddressesKey as CNKeyDescriptor,
                ])
                let query = args.query.trimmingCharacters(in: .whitespacesAndNewlines)
                if !query.isEmpty { request.predicate = CNContact.predicateForContacts(matchingName: query) }
                request.sortOrder = .userDefault
                var contacts: [ContactPayload] = []
                var truncated = false
                try CNContactStore().enumerateContacts(with: request) { contact, stop in
                    guard contacts.count < args.limit else {
                        truncated = true; stop.pointee = true; return
                    }
                    let name = [contact.givenName, contact.middleName, contact.familyName]
                        .filter { !$0.isEmpty }.joined(separator: " ")
                    let displayName = name.isEmpty ? contact.organizationName : name
                    if displayName.count > 512 || contact.phoneNumbers.count > 16 || contact.emailAddresses.count > 16 { truncated = true }
                    let phones = contact.phoneNumbers.prefix(16).map { value -> String in
                        if value.value.stringValue.count > 64 { truncated = true }
                        return String(value.value.stringValue.prefix(64))
                    }
                    let emails = contact.emailAddresses.prefix(16).map { value -> String in
                        let email = value.value as String
                        if email.count > 320 { truncated = true }
                        return String(email.prefix(320))
                    }
                    contacts.append(ContactPayload(id: contact.identifier,
                        name: String(displayName.prefix(512)), phones: phones, emails: emails))
                }
                var limited = false
                if #available(iOS 18.0, *) { limited = CNContactStore.authorizationStatus(for: .contacts) == .limited }
                invoke.resolve(ContactListPayload(contacts: contacts, truncated: truncated, accessLimited: limited))
            } catch { invoke.reject("Unable to read authorized contacts: \(error.localizedDescription)") }
        }
    }
}
