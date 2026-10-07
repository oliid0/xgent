import JSZip from "jszip";

const PRESENTATION = "http://schemas.openxmlformats.org/presentationml/2006/main";
const DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/main";
const RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIP = "http://schemas.openxmlformats.org/package/2006/relationships";
export const PRESENTATION_TEXT_MAX_LENGTH = 32767;
export function isEditablePresentation(path: string, mimeType: string) {
  return (
    /\.pptx$/i.test(path) &&
    mimeType.split(";", 1)[0].trim().toLowerCase() ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );
}
export type PresentationTextEdits = Record<string, string>;
export type PresentationTextEntry = {
  id: string;
  slide: number;
  label: string;
  text: string;
  editable: boolean;
};

async function xmlPart(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing presentation part: ${path}`);
  const bytes = await file.async("uint8array");
  if (bytes.length > 4 * 1024 * 1024) throw new Error("Presentation XML exceeds the editing limit");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("Presentation XML declarations are unsupported");
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length)
    throw new Error(`Invalid presentation XML: ${path}`);
  return document;
}

async function slideParts(zip: JSZip) {
  const presentation = await xmlPart(zip, "ppt/presentation.xml");
  const relationships = await xmlPart(zip, "ppt/_rels/presentation.xml.rels");
  const slides = Array.from(presentation.getElementsByTagNameNS(PRESENTATION, "sldId"));
  if (slides.length > 200) throw new Error("Presentation exceeds the 200-slide editing limit");
  return slides.map((slide) => {
    const relationship = Array.from(
      relationships.getElementsByTagNameNS(PACKAGE_RELATIONSHIP, "Relationship"),
    ).find((item) => item.getAttribute("Id") === slide.getAttributeNS(RELATIONSHIP, "id"));
    const target = relationship?.getAttribute("Target");
    if (!target || relationship?.getAttribute("TargetMode") === "External")
      throw new Error("Invalid slide relationship");
    const location = new URL(target, "https://package.invalid/ppt/presentation.xml");
    const path = decodeURIComponent(location.pathname.slice(1));
    if (location.origin !== "https://package.invalid" || !/^ppt\/slides\/[^/]+\.xml$/.test(path))
      throw new Error("Unsupported slide part location");
    return path;
  });
}

function entry(text: Element, index: number, part: string, slide: number): PresentationTextEntry {
  let shape: Element | null = text;
  while (
    shape &&
    !(shape.namespaceURI === PRESENTATION && ["sp", "graphicFrame"].includes(shape.localName))
  )
    shape = shape.parentElement;
  const name = shape
    ?.getElementsByTagNameNS(PRESENTATION, "cNvPr")[0]
    ?.getAttribute("name")
    ?.slice(0, 140);
  const value = text.textContent ?? "";
  return {
    id: `${part}#${index}`,
    slide,
    label: name || String(index + 1),
    text: value,
    editable:
      text.parentElement?.localName !== "fld" &&
      value.length <= PRESENTATION_TEXT_MAX_LENGTH &&
      !/[\r\n]/.test(value),
  };
}

/** Reads only editable DrawingML text runs; slide order comes from package relationships. */
export async function readPresentationText(bytes: Uint8Array): Promise<PresentationTextEntry[]> {
  const zip = await JSZip.loadAsync(bytes);
  const parts = await slideParts(zip);
  const entries: PresentationTextEntry[] = [];
  for (const [slide, part] of parts.entries()) {
    const document = await xmlPart(zip, part);
    const texts = Array.from(document.getElementsByTagNameNS(DRAWING, "t"));
    if (entries.length + texts.length > 2000)
      throw new Error("Presentation exceeds the 2000-text-field editing limit");
    entries.push(...texts.map((text, index) => entry(text, index, part, slide + 1)));
  }
  return entries;
}

export function presentationHasEdits(edits: PresentationTextEdits | undefined) {
  return !!edits && Object.keys(edits).length > 0;
}

export function validPresentationText(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > PRESENTATION_TEXT_MAX_LENGTH ||
    /[\r\n]/.test(value)
  )
    return false;
  return Array.from(value).every((scalar) => {
    const code = scalar.codePointAt(0) ?? 0;
    return (
      (code === 9 || code >= 32) &&
      !(code >= 0xd800 && code <= 0xdfff) &&
      code !== 0xfffe &&
      code !== 0xffff
    );
  });
}

export function remainingPresentationEdits(
  current: PresentationTextEdits | undefined,
  written: PresentationTextEdits | undefined,
) {
  return Object.fromEntries(
    Object.entries(current ?? {}).filter(([id, text]) => written?.[id] !== text),
  );
}

/** Changes text in place: run formatting, shapes and every unrelated ZIP part remain intact. */
export async function writePresentationText(bytes: Uint8Array, edits: PresentationTextEdits) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = await slideParts(zip);
  const pending = new Set(Object.keys(edits));
  if (pending.size > 2000 || Object.values(edits).some((text) => !validPresentationText(text)))
    throw new Error("Invalid presentation text edits");
  for (const [slide, part] of parts.entries()) {
    const document = await xmlPart(zip, part);
    let changed = false;
    const texts = Array.from(document.getElementsByTagNameNS(DRAWING, "t"));
    for (const [index, text] of texts.entries()) {
      const field = entry(text, index, part, slide + 1);
      if (!pending.has(field.id)) continue;
      if (!field.editable) throw new Error("This presentation field cannot be edited");
      pending.delete(field.id);
      if (text.textContent !== edits[field.id]) {
        text.textContent = edits[field.id];
        changed = true;
      }
    }
    if (changed) zip.file(part, new XMLSerializer().serializeToString(document));
  }
  if (pending.size) throw new Error("Presentation text field is no longer available");
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
