const namespace = "http://www.w3.org/2000/svg";
const paint = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "color",
  "display",
  "font-family",
  "font-size",
  "text-anchor",
  "dominant-baseline",
];

/** Keep the shared layout, resolving browser paint and arrow markers for native SVG. */
export function nativeDiagramSvg(source: string): string {
  if (source.length > 4 * 1024 * 1024) throw new Error("Diagram SVG is too large");
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = parsed.documentElement;
  if (
    svg.localName !== "svg" ||
    parsed.querySelector("parsererror") ||
    svg.querySelector("foreignObject,script,image,iframe,animate,animateTransform")
  ) {
    throw new Error("Diagram requires unsupported embedded content");
  }
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none;opacity:0";
  const live = document.importNode(svg, true) as unknown as SVGSVGElement;
  host.append(live);
  document.body.append(host);
  try {
    const box = live.viewBox.baseVal;
    if (
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.width > 100_000 ||
      box.height > 100_000
    ) {
      throw new Error("Diagram has invalid dimensions");
    }
    live.setAttribute("width", String(box.width));
    live.setAttribute("height", String(box.height));
    const elements = [live, ...live.querySelectorAll<SVGElement>("*")];
    const markers = new Map<string, Element>();
    for (const marker of live.querySelectorAll("marker[id]")) markers.set(marker.id, marker);
    // Resolve styles while their original ID-scoped stylesheet is still present.
    const styles = elements.map((element) => getComputedStyle(element));
    const resolved = styles.map((style) =>
      Object.fromEntries(paint.map((name) => [name, style.getPropertyValue(name)])),
    );
    // SwiftDraw reads only a direct text value or the first tspan, whereas
    // Mermaid nests and wraps its labels. Measure each leaf's real browser
    // baseline before removing CSS, then emit independent native text runs.
    const textRuns = [...live.querySelectorAll<SVGTextElement>("text")]
      .filter((text) => text.querySelector("tspan"))
      .map((text) => ({
        text,
        runs: [...text.querySelectorAll<SVGTSpanElement>("tspan")]
          .filter((span) => !span.querySelector("tspan") && span.getNumberOfChars() > 0)
          .map((span) => ({ span, position: span.getStartPositionOfChar(0) })),
      }));
    const arrows = elements.flatMap((element, index) => {
      const style = styles[index];
      if (style.getPropertyValue("marker-mid") !== "none" && style.getPropertyValue("marker-mid")) {
        throw new Error("Diagram uses unsupported intermediate arrows");
      }
      return ["start", "end"].flatMap((position) => {
        const value = style.getPropertyValue(`marker-${position}`);
        if (!value || value === "none") return [];
        const match = /#([^"')]+)["']?\)$/.exec(value);
        const marker = match && markers.get(match[1]);
        if (!marker || !(element instanceof SVGGeometryElement))
          throw new Error("Invalid diagram arrow");
        return [{ element, marker, position, strokeWidth: Number.parseFloat(style.strokeWidth) }];
      });
    });
    elements.forEach((element, index) => {
      // SVG defaults an omitted rectangle dimension to zero. Mermaid leaves
      // empty label backgrounds in its output; native parsers require the
      // attributes even though these rectangles paint nothing in the browser.
      if (element.localName === "rect") {
        for (const dimension of ["width", "height"])
          if (!element.hasAttribute(dimension)) element.setAttribute(dimension, "0");
      }
      for (const attribute of [...element.attributes]) {
        if (
          /^on/i.test(attribute.name) ||
          (["href", "xlink:href"].includes(attribute.name) && !attribute.value.startsWith("#"))
        ) {
          element.removeAttribute(attribute.name);
        }
      }
      element.removeAttribute("style");
      for (const [name, value] of Object.entries(resolved[index]))
        if (value) {
          // Computed CSS serializes dash lengths with px. SwiftDraw's SVG
          // number-list parser consumes unitless numbers, including commas.
          const nativeValue = name === "stroke-dasharray" ? value.replace(/px\b/g, "") : value;
          // A local fragment remains valid after crossing the native boundary.
          element.setAttribute(
            name,
            nativeValue.replace(/url\(["']?[^#)]*#([^"')]+)["']?\)/g, "url(#$1)"),
          );
        }
      for (const position of ["start", "mid", "end"]) element.removeAttribute(`marker-${position}`);
    });
    for (const arrow of arrows)
      expandArrow(
        arrow.element as SVGGeometryElement,
        arrow.marker,
        arrow.position,
        arrow.strokeWidth,
      );
    for (const { text, runs } of textRuns) {
      const group = document.createElementNS(namespace, "g");
      for (const attribute of ["transform", "opacity", "clip-path", "filter"]) {
        const value = text.getAttribute(attribute);
        if (value !== null) group.setAttribute(attribute, value);
      }
      for (const { span, position } of runs) {
        if (![position.x, position.y].every(Number.isFinite))
          throw new Error("Diagram text has invalid geometry");
        const label = document.createElementNS(namespace, "text");
        for (const attribute of [...span.attributes])
          label.setAttribute(attribute.name, attribute.value);
        for (const attribute of ["dx", "dy", "rotate", "transform"])
          label.removeAttribute(attribute);
        label.setAttribute("x", String(position.x));
        label.setAttribute("y", String(position.y));
        label.setAttribute("text-anchor", "start");
        label.setAttribute("dominant-baseline", "auto");
        label.textContent = span.textContent;
        group.append(label);
      }
      text.replaceWith(group);
    }
    for (const element of live.querySelectorAll("style,marker")) element.remove();
    const result = new XMLSerializer().serializeToString(live);
    if (result.length > 4 * 1024 * 1024) throw new Error("Native diagram SVG is too large");
    return result;
  } finally {
    host.remove();
  }
}

function expandArrow(
  path: SVGGeometryElement,
  marker: Element,
  position: string,
  strokeWidth: number,
) {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) throw new Error("Diagram arrow has no path");
  const start = position === "start";
  const point = path.getPointAtLength(start ? 0 : length);
  const near = path.getPointAtLength(start ? Math.min(length, 0.1) : Math.max(0, length - 0.1));
  const angle =
    (Math.atan2(
      start ? near.y - point.y : point.y - near.y,
      start ? near.x - point.x : point.x - near.x,
    ) *
      180) /
    Math.PI;
  const number = (name: string, fallback: number) =>
    marker.hasAttribute(name) ? Number(marker.getAttribute(name)) : fallback;
  const units = marker.getAttribute("markerUnits") === "userSpaceOnUse" ? 1 : strokeWidth;
  const width = number("markerWidth", 3),
    height = number("markerHeight", 3);
  const viewBox = marker
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  let scaleX = 1,
    scaleY = 1,
    offsetX = 0,
    offsetY = 0;
  if (viewBox) {
    if (viewBox.length !== 4 || viewBox[2] <= 0 || viewBox[3] <= 0)
      throw new Error("Invalid diagram arrow viewport");
    scaleX = width / viewBox[2];
    scaleY = height / viewBox[3];
    const preserve = marker.getAttribute("preserveAspectRatio") ?? "xMidYMid meet";
    if (preserve !== "none") {
      const scale = preserve.includes("slice")
        ? Math.max(scaleX, scaleY)
        : Math.min(scaleX, scaleY);
      offsetX = preserve.includes("xMin")
        ? 0
        : (width - viewBox[2] * scale) / (preserve.includes("xMax") ? 1 : 2);
      offsetY = preserve.includes("YMin")
        ? 0
        : (height - viewBox[3] * scale) / (preserve.includes("YMax") ? 1 : 2);
      scaleX = scale;
      scaleY = scale;
    }
    offsetX -= viewBox[0] * scaleX;
    offsetY -= viewBox[1] * scaleY;
  }
  const refX = number("refX", 0),
    refY = number("refY", 0);
  const orient = marker.getAttribute("orient") ?? "0";
  const rotation = orient.startsWith("auto")
    ? angle + (start && orient === "auto-start-reverse" ? 180 : 0)
    : Number.parseFloat(orient);
  if (
    ![
      units,
      width,
      height,
      refX,
      refY,
      scaleX,
      scaleY,
      offsetX,
      offsetY,
      rotation,
      point.x,
      point.y,
    ].every(Number.isFinite) ||
    units <= 0 ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Invalid diagram arrow geometry");
  const group = document.createElementNS(namespace, "g");
  group.setAttribute("data-xgent-arrow", position);
  group.setAttribute(
    "transform",
    `${path.getAttribute("transform") ?? ""} translate(${point.x},${point.y}) rotate(${rotation}) scale(${units}) translate(${-refX * scaleX},${-refY * scaleY}) scale(${scaleX},${scaleY})`,
  );
  for (const child of [...marker.children]) group.append(child.cloneNode(true));
  path.after(group);
}
