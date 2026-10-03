import Foundation

private final class XgentMathBundleFinder {}

enum XgentMathFonts {
    static var available: Bool {
        let own = Bundle(for: XgentMathBundleFinder.self)
        let roots = [Bundle.main.resourceURL, Bundle.main.bundleURL,
                     own.resourceURL, own.bundleURL, own.bundleURL.deletingLastPathComponent()]
        return roots.compactMap { $0 }.contains { root in
            guard let bundle = Bundle(url: root.appendingPathComponent("SwaTex_SwaTexRender.bundle")),
                  let url = bundle.url(forResource: "KaTeX_Main-Regular", withExtension: "ttf", subdirectory: "Fonts") else { return false }
            return FileManager.default.fileExists(atPath: url.path)
        }
    }
}
