import type { PdfHighlight } from "./workspacePdfHighlights";

type PdfSelectionViewport = {
  width: number;
  height: number;
  convertToPdfPoint: (x: number, y: number) => number[];
};

/** Convert actual selected text geometry, including rotated pages, into PDF points. */
export function pdfSelectionRectangles(
  layer: HTMLElement,
  viewport: PdfSelectionViewport,
  selection: Selection | null,
): PdfHighlight["rects"] {
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !layer.contains(selection.anchorNode) ||
    !layer.contains(selection.focusNode)
  )
    return [];
  const origin = layer.getBoundingClientRect();
  const rects: PdfHighlight["rects"] = [];
  for (let index = 0; index < selection.rangeCount; index++) {
    for (const rect of selection.getRangeAt(index).getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue;
      const start = viewport.convertToPdfPoint(
        Math.max(0, Math.min(viewport.width, rect.left - origin.left)),
        Math.max(0, Math.min(viewport.height, rect.top - origin.top)),
      );
      const end = viewport.convertToPdfPoint(
        Math.max(0, Math.min(viewport.width, rect.right - origin.left)),
        Math.max(0, Math.min(viewport.height, rect.bottom - origin.top)),
      );
      const value: PdfHighlight["rects"][number] = [
        Math.min(start[0], end[0]),
        Math.min(start[1], end[1]),
        Math.abs(end[0] - start[0]),
        Math.abs(end[1] - start[1]),
      ];
      if (
        value[2] &&
        value[3] &&
        !rects.some((other) => other.every((point, i) => Math.abs(point - value[i]) < 0.5))
      )
        rects.push(value);
      if (rects.length === 256) return rects;
    }
  }
  return rects;
}
