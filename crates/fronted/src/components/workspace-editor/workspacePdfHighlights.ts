import { workspacePathExtension } from "./workspaceImagePreview";

export const PDF_HIGHLIGHT_COLORS = {
  yellow: [1, 0.85, 0.15],
  green: [0.35, 0.85, 0.45],
  pink: [1, 0.45, 0.7],
} as const;
export type PdfHighlightColor = keyof typeof PDF_HIGHLIGHT_COLORS;
/** Coordinates are unrotated PDF page points, with the origin at the bottom left. */
export type PdfHighlight = {
  id: string;
  pageIndex: number;
  rects: Array<[number, number, number, number]>;
  color: PdfHighlightColor;
};

export function isEditablePdf(path: string, mimeType: string) {
  // Office conversions can be displayed as PDF, but must never overwrite their source.
  return workspacePathExtension(path) === "pdf" && mimeType === "application/pdf";
}

export function validPdfHighlights(value: unknown): value is PdfHighlight[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 512 &&
    new Set(value.map((entry) => entry?.id)).size === value.length &&
    value.every(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        /^[\w-]{1,80}$/.test(entry.id) &&
        Number.isSafeInteger(entry.pageIndex) &&
        entry.pageIndex >= 0 &&
        Object.hasOwn(PDF_HIGHLIGHT_COLORS, entry.color) &&
        Array.isArray(entry.rects) &&
        entry.rects.length > 0 &&
        entry.rects.length <= 256 &&
        entry.rects.every(
          (rect: unknown) =>
            Array.isArray(rect) &&
            rect.length === 4 &&
            rect.every((point) => typeof point === "number" && Number.isFinite(point)) &&
            rect[2] > 0 &&
            rect[3] > 0,
        ),
    )
  );
}

export function parsePdfHighlights(value: unknown): PdfHighlight[] | null {
  if (typeof value !== "string" || value.length > 1_000_000) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return validPdfHighlights(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function remainingPdfHighlights(current: PdfHighlight[] = [], written: PdfHighlight[] = []) {
  const committed = new Set(written.map((entry) => entry.id));
  return current.filter((entry) => !committed.has(entry.id));
}

/** Append real PDF Highlight annotations, keeping the original pages, forms and annotations. */
export async function writePdfHighlights(bytes: Uint8Array, highlights: PdfHighlight[]) {
  if (!validPdfHighlights(highlights)) throw new Error("Invalid PDF highlights");
  const { PDFDocument, PDFNumber, PDFString } = await import("pdf-lib");
  const number = (value: number) => PDFNumber.of(value).toString();
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = document.getPages();
  const context = document.context;
  // Validate the whole batch before mutating any page.
  for (const entry of highlights) {
    const page = pages[entry.pageIndex];
    if (!page) throw new Error("PDF highlight page is unavailable");
    const box = page.getMediaBox();
    if (
      entry.rects.some(
        ([x, y, width, height]) =>
          x < box.x - 0.5 ||
          y < box.y - 0.5 ||
          x + width > box.x + box.width + 0.5 ||
          y + height > box.y + box.height + 0.5,
      )
    )
      throw new Error("PDF highlight is outside the page");
  }
  for (const entry of highlights) {
    const page = pages[entry.pageIndex];
    const left = Math.min(...entry.rects.map((rect) => rect[0]));
    const bottom = Math.min(...entry.rects.map((rect) => rect[1]));
    const right = Math.max(...entry.rects.map(([x, , width]) => x + width));
    const top = Math.max(...entry.rects.map(([, y, , height]) => y + height));
    const color = [...PDF_HIGHLIGHT_COLORS[entry.color]];
    // PDF.js HighlightAnnotation uses TL, TR, BL, BR. An explicit appearance
    // stream keeps PDFKit and other readers from choosing a different opacity.
    const appearance = context.flateStream(
      `q /GS0 gs ${color.map(number).join(" ")} rg\n${entry.rects
        .map((rect) => `${rect.map(number).join(" ")} re f`)
        .join("\n")}\nQ`,
      {
        Type: "XObject",
        Subtype: "Form",
        FormType: 1,
        BBox: [left, bottom, right, top],
        Resources: { ExtGState: { GS0: { Type: "ExtGState", BM: "Multiply", ca: 0.4 } } },
      },
    );
    const annotation = context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      P: page.ref,
      Rect: [left, bottom, right, top],
      QuadPoints: entry.rects.flatMap(([x, y, width, height]) => [
        x,
        y + height,
        x + width,
        y + height,
        x,
        y,
        x + width,
        y,
      ]),
      C: color,
      CA: 0.4,
      F: 4,
      Border: [0, 0, 0],
      NM: PDFString.of(`xgent-${entry.id}`),
      AP: { N: context.register(appearance) },
    });
    page.node.addAnnot(context.register(annotation));
  }
  return document.save();
}
