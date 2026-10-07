import Foundation
import OrderedCollections

struct XgentModelOptionGroup: Identifiable {
    let id: String
    let label: String
    let options: [XgentOption]
}

enum XgentModelOptions {
    // Provider IDs stay distinct even when two configured providers share a name.
    // Preserve the wire order across search updates instead of reordering a Dictionary.
    static func groups(_ options: [XgentOption], query: String = "") -> [XgentModelOptionGroup] {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        var grouped = OrderedDictionary<String, [XgentOption]>()
        for option in options {
            guard search.isEmpty || option.label.localizedStandardContains(search)
                || (option.groupLabel?.localizedStandardContains(search) ?? false) else { continue }
            let key = option.group ?? ""
            var items = grouped[key] ?? []
            items.append(option)
            grouped[key] = items
        }
        return grouped.elements.map { key, items in
            XgentModelOptionGroup(id: key, label: items.first?.groupLabel ?? "", options: items)
        }
    }
}
