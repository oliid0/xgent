import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import PptxGenJS from "pptxgenjs";
import { utils, write } from "xlsx";

export type OfficeCell = string | number | boolean | null | { formula: string };
export type OfficeDocument =
  | {
      format: "docx";
      paragraphs: Array<{ text: string; heading?: 1 | 2 | 3; bold?: boolean }>;
      tables?: string[][][];
    }
  | { format: "xlsx"; sheets: Array<{ name: string; rows: OfficeCell[][] }> }
  | {
      format: "pptx";
      slides: Array<{
        background?: string;
        notes?: string;
        elements: Array<{
          type: "text" | "rectangle";
          x: number;
          y: number;
          width: number;
          height: number;
          text?: string;
          color?: string;
          fontSize?: number;
          bold?: boolean;
        }>;
      }>;
    };

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
function text(value: unknown, label: string) {
  if (typeof value !== "string" || value.length > 32767)
    throw new Error(`${label} must be valid text of at most 32767 characters`);
  for (const scalar of value) {
    const code = scalar.codePointAt(0) ?? 0;
    if (
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    )
      throw new Error(`${label} contains a character that cannot be stored in Office XML`);
  }
  return value;
}
function color(value: string | undefined) {
  if (value !== undefined && !/^[0-9a-f]{6}$/i.test(value))
    throw new Error("Office colors must use six hex digits");
  return value;
}
function list<T>(value: T[], label: string, max: number) {
  if (!Array.isArray(value) || !value.length || value.length > max)
    throw new Error(`${label} needs 1–${max} entries`);
  return value;
}

/** Generates native editable OOXML in the shared runtime, with no subprocess or file download. */
export async function createOfficeDocument(document: OfficeDocument): Promise<Uint8Array> {
  if (!document || new TextEncoder().encode(JSON.stringify(document)).length > MAX_SOURCE_BYTES)
    throw new Error("Office document specification exceeds 2 MiB");
  if (document.format === "docx") {
    const headings = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
    };
    const children: Array<Paragraph | Table> = list(document.paragraphs, "Paragraphs", 10000).map(
      (paragraph) => {
        if (paragraph.heading !== undefined && ![1, 2, 3].includes(paragraph.heading))
          throw new Error("Unsupported heading level");
        return new Paragraph({
          heading: paragraph.heading ? headings[paragraph.heading] : undefined,
          children: [
            new TextRun({ text: text(paragraph.text, "Paragraph"), bold: paragraph.bold }),
          ],
        });
      },
    );
    for (const table of document.tables ?? []) {
      list(table, "Table rows", 1000);
      children.push(
        new Table({
          rows: table.map(
            (row) =>
              new TableRow({
                children: list(row, "Table columns", 100).map(
                  (cell) => new TableCell({ children: [new Paragraph(text(cell, "Table cell"))] }),
                ),
              }),
          ),
        }),
      );
    }
    return new Uint8Array(await Packer.toArrayBuffer(new Document({ sections: [{ children }] })));
  }
  if (document.format === "xlsx") {
    const workbook = utils.book_new();
    const names = new Set<string>();
    for (const sheet of list(document.sheets, "Sheets", 100)) {
      const name = text(sheet.name, "Sheet name");
      if (
        !name.trim() ||
        name.length > 31 ||
        /[\\/?*[\]:]/.test(name) ||
        names.has(name.toLowerCase())
      )
        throw new Error("Sheet names must be unique valid Excel names");
      names.add(name.toLowerCase());
      list(sheet.rows, "Sheet rows", 10000);
      const rows = sheet.rows.map((row) => {
        if (!Array.isArray(row) || row.length > 1000)
          throw new Error("Sheet row exceeds 1000 cells");
        return row.map((cell) => {
          if (cell === null || typeof cell === "boolean") return cell;
          if (typeof cell === "number") {
            if (!Number.isFinite(cell)) throw new Error("Cell number must be finite");
            return cell;
          }
          if (typeof cell === "string") return text(cell, "Cell");
          if (cell && typeof cell === "object" && typeof cell.formula === "string") {
            const formula = text(cell.formula, "Formula").replace(/^=/, "");
            if (!formula.trim()) throw new Error("Formula cannot be empty");
            return { t: "n", f: formula };
          }
          throw new Error("Unsupported spreadsheet cell");
        });
      });
      utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), name);
    }
    return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx", compression: true }));
  }
  if (document.format === "pptx") {
    const presentation = new PptxGenJS();
    presentation.layout = "LAYOUT_WIDE";
    presentation.author = "Xgent";
    for (const source of list(document.slides, "Slides", 200)) {
      const slide = presentation.addSlide();
      if (source.background) slide.background = { color: color(source.background) };
      if (source.notes !== undefined) slide.addNotes(text(source.notes, "Speaker notes"));
      for (const element of list(source.elements, "Slide elements", 500)) {
        const { x, y, width, height } = element;
        if (
          ![x, y, width, height].every(Number.isFinite) ||
          x < 0 ||
          y < 0 ||
          width <= 0 ||
          height <= 0 ||
          x + width > 13.333334 ||
          y + height > 7.5
        )
          throw new Error("Slide element lies outside the 13.333 × 7.5 inch slide");
        const options = { x, y, w: width, h: height, color: color(element.color) };
        if (element.type === "text") {
          if (
            element.fontSize !== undefined &&
            (!Number.isFinite(element.fontSize) || element.fontSize < 6 || element.fontSize > 200)
          )
            throw new Error("Slide font size must be 6–200 points");
          slide.addText(text(element.text, "Slide text"), {
            ...options,
            fontSize: element.fontSize ?? 24,
            bold: element.bold,
            breakLine: false,
            margin: 0,
          });
        } else if (element.type === "rectangle") {
          slide.addShape(presentation.ShapeType.rect, {
            ...options,
            fill: { color: element.color ?? "EEEEEE" },
            line: { color: element.color ?? "EEEEEE" },
          });
        } else throw new Error("Unsupported slide element");
      }
    }
    const result = await presentation.write({ outputType: "arraybuffer", compression: true });
    if (!(result instanceof ArrayBuffer))
      throw new Error("Presentation writer did not return binary data");
    return new Uint8Array(result);
  }
  throw new Error("Office generation supports docx, xlsx and pptx");
}
