import JSZip from "jszip";
import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";

const PRESENTATION = "http://schemas.openxmlformats.org/presentationml/2006/main";
const DRAWING = "http://schemas.openxmlformats.org/drawingml/2006/main";
const RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function parseXml(source: string) {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length)
    throw new Error("Invalid presentation XML");
  return document;
}

/** Saves a standard PDF comment or an editable PowerPoint text box in the original document. */
export async function annotateDocument(
  bytes: Uint8Array,
  format: "pdf" | "pptx",
  pageNumber: number,
  text: string,
) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1)
    throw new Error("Choose a valid page or slide number");
  if (!text.trim() || text.length > 12000)
    throw new Error("Enter an annotation of 1–12000 characters");
  if (format === "pdf") {
    const document = await PDFDocument.load(bytes);
    const page = document.getPages()[pageNumber - 1];
    if (!page) throw new Error("Page number is outside this document");
    const box = page.getCropBox();
    const annotation = document.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Text"),
      Rect: [box.x + 12, box.y + box.height - 36, box.x + 36, box.y + box.height - 12],
      Contents: PDFHexString.fromText(text),
      T: PDFHexString.fromText("Xgent"),
      Name: PDFName.of("Comment"),
      C: [1, 0.85, 0.2],
      Open: false,
      F: 4,
    });
    page.node.addAnnot(document.context.register(annotation));
    return document.save();
  }
  const zip = await JSZip.loadAsync(bytes);
  const xml = async (path: string) => {
    const entry = zip.file(path);
    if (!entry) throw new Error(`Missing presentation part: ${path}`);
    return parseXml(await entry.async("string"));
  };
  const presentation = await xml("ppt/presentation.xml");
  const slide = presentation.getElementsByTagNameNS(PRESENTATION, "sldId")[pageNumber - 1];
  if (!slide) throw new Error("Slide number is outside this presentation");
  const relationships = await xml("ppt/_rels/presentation.xml.rels");
  const relationship = Array.from(relationships.getElementsByTagName("Relationship")).find(
    (item) => item.getAttribute("Id") === slide.getAttributeNS(RELATIONSHIP, "id"),
  );
  const target = relationship?.getAttribute("Target");
  if (!target || relationship?.getAttribute("TargetMode") === "External")
    throw new Error("Invalid slide relationship");
  const path = new URL(target, "https://package.invalid/ppt/presentation.xml").pathname.slice(1);
  if (!path.startsWith("ppt/slides/")) throw new Error("Unsupported slide part location");
  const document = await xml(path);
  const tree = document.getElementsByTagNameNS(PRESENTATION, "spTree")[0];
  if (!tree) throw new Error("Slide has no shape tree");
  const size = presentation.getElementsByTagNameNS(PRESENTATION, "sldSz")[0];
  const width = Number(size?.getAttribute("cx"));
  const height = Number(size?.getAttribute("cy"));
  if (!(width > 0 && height > 0)) throw new Error("Invalid presentation dimensions");
  const id =
    Math.max(
      0,
      ...Array.from(document.getElementsByTagNameNS(PRESENTATION, "cNvPr")).map(
        (item) => Number(item.getAttribute("id")) || 0,
      ),
    ) + 1;
  const note = parseXml(`<p:sp xmlns:p="${PRESENTATION}" xmlns:a="${DRAWING}">
    <p:nvSpPr><p:cNvPr id="${id}" name="Xgent annotation ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.72)}"/><a:ext cx="${Math.round(width * 0.9)}" cy="${Math.round(height * 0.23)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFF2B3"/></a:solidFill></p:spPr>
    <p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr sz="1600"><a:solidFill><a:srgbClr val="252525"/></a:solidFill></a:rPr><a:t/></a:r></a:p></p:txBody>
  </p:sp>`);
  note.getElementsByTagNameNS(DRAWING, "t")[0].textContent = text;
  tree.appendChild(document.importNode(note.documentElement, true));
  zip.file(path, new XMLSerializer().serializeToString(document));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
