import Foundation

struct XgentCodeBlockConfiguration: Decodable, Equatable {
    struct Labels: Decodable, Equatable {
        let copy: String
        let copied: String
        let expand: String
        let collapse: String
        var code: String? = nil
        var expandedState: String? = nil
        var collapsedState: String? = nil

        static let fallback = Self(copy: "Copy code", copied: "Copied", expand: "Expand {count} lines", collapse: "Collapse code",
                                   code: "Code", expandedState: "Expanded", collapsedState: "Collapsed")
    }

    var maxHeight: Double? = nil
    var viewportFraction: Double? = nil
    var collapseLines: Int? = nil
    var hasLanguageLabel = true
    var container = "card"
    var labels = Labels.fallback
    var diagram = XgentDiagramLabels.fallback
    var syntaxTheme: String? = nil
    var syntaxBackground: XgentReadOnlySyntax.Style? = nil
    var syntaxComment: XgentReadOnlySyntax.Style? = nil
    var syntaxForeground: XgentReadOnlySyntax.Style? = nil

    static let plain = Self()
    static let markdown = Self(maxHeight: 576, viewportFraction: 0.6, collapseLines: 12)

    static func decode(_ raw: String?, fallback: Self) -> Self {
        guard let data = raw?.data(using: .utf8), let value = try? JSONDecoder().decode(Self.self, from: data),
              value.maxHeight.map({ $0.isFinite && $0 > 0 }) ?? true,
              value.viewportFraction.map({ $0.isFinite && $0 > 0 && $0 <= 1 }) ?? true,
              value.collapseLines.map({ $0 > 0 }) ?? true,
              ["card", "section"].contains(value.container),
              value.syntaxBackground.map(\.valid) ?? true, value.syntaxComment.map(\.valid) ?? true,
              value.syntaxForeground.map(\.valid) ?? true else { return fallback }
        return value
    }

    private enum CodingKeys: String, CodingKey {
        case maxHeight, viewportFraction, collapseLines, hasLanguageLabel, container, labels, diagram, syntaxTheme, syntaxBackground, syntaxComment, syntaxForeground
    }

    init(maxHeight: Double? = nil, viewportFraction: Double? = nil, collapseLines: Int? = nil,
         hasLanguageLabel: Bool = true, container: String = "card", labels: Labels = .fallback) {
        self.maxHeight = maxHeight; self.viewportFraction = viewportFraction; self.collapseLines = collapseLines
        self.hasLanguageLabel = hasLanguageLabel; self.container = container; self.labels = labels
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        maxHeight = try values.decodeIfPresent(Double.self, forKey: .maxHeight)
        viewportFraction = try values.decodeIfPresent(Double.self, forKey: .viewportFraction)
        collapseLines = try values.decodeIfPresent(Int.self, forKey: .collapseLines)
        hasLanguageLabel = try values.decodeIfPresent(Bool.self, forKey: .hasLanguageLabel) ?? true
        container = try values.decodeIfPresent(String.self, forKey: .container) ?? "card"
        labels = try values.decodeIfPresent(Labels.self, forKey: .labels) ?? .fallback
        diagram = try values.decodeIfPresent(XgentDiagramLabels.self, forKey: .diagram) ?? .fallback
        syntaxTheme = try values.decodeIfPresent(String.self, forKey: .syntaxTheme)
        syntaxBackground = try values.decodeIfPresent(XgentReadOnlySyntax.Style.self, forKey: .syntaxBackground)
        syntaxComment = try values.decodeIfPresent(XgentReadOnlySyntax.Style.self, forKey: .syntaxComment)
        syntaxForeground = try values.decodeIfPresent(XgentReadOnlySyntax.Style.self, forKey: .syntaxForeground)
    }
}
