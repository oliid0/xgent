import SwiftDraw
import SwiftUI

// Exact shape, color layers and blur values from GeminiIconSource in icons.tsx.
// SwiftDraw 0.29 ignores SVG Gaussian filters; SwiftUI applies those filters
// after rendering each existing vector layer, before the same shape mask.
struct XgentGeminiGlyph: View {
    let size: CGFloat

    private struct Layer {
        let svg: SVG
        let blur: CGFloat
    }

    private static let shape = SVG(xml: ##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path fill="white" d="M57.067 28.61q-7.396-3.184-12.945-8.732q-5.547-5.546-8.732-12.944a38.4 38.4 0 0 1-1.97-5.824A1.464 1.464 0 0 0 32 .001c-.671 0-1.255.458-1.419 1.11a38.4 38.4 0 0 1-1.971 5.823q-3.186 7.397-8.732 12.944q-5.548 5.548-12.945 8.732a38.4 38.4 0 0 1-5.824 1.972A1.464 1.464 0 0 0 0 32c0 .67.458 1.255 1.11 1.418a38.4 38.4 0 0 1 5.823 1.972q7.396 3.184 12.945 8.732q5.55 5.546 8.732 12.944a38.4 38.4 0 0 1 1.971 5.824c.164.65.749 1.11 1.419 1.11s1.255-.458 1.419-1.11a38.4 38.4 0 0 1 1.971-5.823q3.185-7.395 8.732-12.944q5.548-5.548 12.945-8.732a38.4 38.4 0 0 1 5.824-1.972A1.464 1.464 0 0 0 64 32.001c0-.672-.458-1.255-1.11-1.42a38.4 38.4 0 0 1-5.823-1.97"/></svg>"##)!

    private static let layers: [Layer] = [
        layer(##"<ellipse cx="14.208" cy="16.716" fill="#ffe432" rx="14.208" ry="16.716" transform="rotate(19.552 -43.96 -16.268)"/>"##, blur: 2.46),
        layer(##"<ellipse cx="27.054" cy="2.551" fill="#fc413d" rx="18.394" ry="18.799"/>"##, blur: 11.891),
        layer(##"<ellipse cx="19.224" cy="24.904" fill="#00b95c" rx="19.224" ry="24.904" transform="rotate(-2.799 667.58 51.694)"/>"##, blur: 10.109),
        layer(##"<ellipse cx="18.843" cy="20.744" fill="#00b95c" rx="18.843" ry="20.744" transform="rotate(-31.317 81.174 36.482)"/>"##, blur: 10.109),
        layer(##"<ellipse cx="66.462" cy="24.977" fill="#3186ff" rx="18.093" ry="17.423"/>"##, blur: 9.606),
        layer(##"<ellipse cx="20.929" cy="22.075" fill="#fbbc04" rx="20.929" ry="22.075" transform="rotate(37.251 9.618 -7.898)"/>"##, blur: 8.706),
        layer(##"<ellipse cx="24.131" cy="22.292" fill="#3186ff" rx="24.131" ry="22.292" transform="rotate(34.51 19.317 63.957)"/>"##, blur: 7.775),
        layer(##"<path fill="#749bff" d="M54.226-2.304c2.794 3.799-.797 11.184-8.02 16.497c-7.222 5.312-15.342 6.539-18.136 2.74S28.866 5.75 36.09.436c7.223-5.312 15.343-6.539 18.136-2.74"/>"##, blur: 6.957),
        layer(##"<ellipse cx="27.585" cy="17.148" fill="#fc413d" rx="27.585" ry="17.148" transform="rotate(-42.847 5.973 20.37)"/>"##, blur: 5.876),
        layer(##"<ellipse cx="14.782" cy="8.596" fill="#ffee48" rx="14.782" ry="8.596" transform="rotate(35.592 -44.338 25.191)"/>"##, blur: 7.273),
    ]

    private static func layer(_ source: String, blur: CGFloat) -> Layer {
        // Extra canvas preserves off-canvas color before blurring and masking.
        Layer(svg: SVG(xml: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"128\" height=\"128\" viewBox=\"-32 -32 128 128\">\(source)</svg>")!, blur: blur)
    }

    var body: some View {
        let side = size * 0.875 // Existing 32px icon has 2px inset on each edge.
        ZStack {
            SVGView(svg: Self.shape).resizable().renderingMode(.original)
            ForEach(Self.layers.indices, id: \.self) { index in
                let layer = Self.layers[index]
                SVGView(svg: layer.svg).resizable().renderingMode(.original)
                    .frame(width: side * 2, height: side * 2)
                    .blur(radius: layer.blur * side / 64)
                    .frame(width: side, height: side)
            }
        }
        .frame(width: side, height: side)
        .mask { SVGView(svg: Self.shape).resizable() }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
