import JSZip from "jszip";
import { read, utils } from "xlsx";

export const SPREADSHEET_MAX_ROWS = 250;
export const SPREADSHEET_MAX_COLUMNS = 80;
export const SPREADSHEET_MAX_CELL_LENGTH = 32767;
export function boundedSpreadsheetText(value: string): string {
  if (value.length <= SPREADSHEET_MAX_CELL_LENGTH) return value;
  let text = "";
  for (const scalar of value) {
    if (text.length + scalar.length > SPREADSHEET_MAX_CELL_LENGTH) break;
    text += scalar;
  }
  return text;
}
export type SpreadsheetEdits = Record<string, Record<string, string>>;
export type SpreadsheetTable = {
  sheetNames: string[];
  rows: Array<{
    id: string;
    rowIndex: number;
    cells: Array<{ id: string; columnIndex: number; value: string }>;
  }>;
  activeSheetName: string;
  truncatedRows: boolean;
  truncatedColumns: boolean;
  error: string | null;
};

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index++)
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}

/** Shared formatted cells and bounds for Astryx and the native spreadsheet grid. */
export function buildSpreadsheetTable(
  preview: { kind: string; bytes: Uint8Array } | null,
  activeSheetName: string,
  fallbackError: string,
): SpreadsheetTable | null {
  if (!preview || preview.kind !== "spreadsheet") return null;
  try {
    const workbook = read(preview.bytes, { type: "array", cellDates: true, sheetStubs: true });
    const sheetNames = workbook.SheetNames;
    const selectedSheetName =
      sheetNames.find((name) => name === activeSheetName) ?? sheetNames[0] ?? "";
    const sheet = selectedSheetName ? workbook.Sheets[selectedSheetName] : null;
    if (!sheet)
      return {
        sheetNames,
        rows: [],
        activeSheetName: selectedSheetName,
        truncatedRows: false,
        truncatedColumns: false,
        error: null,
      };
    const range = utils.decode_range(sheet["!ref"] || "A1");
    const rawRows = utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: true,
      defval: "",
      raw: false,
      range: {
        s: { r: 0, c: 0 },
        e: {
          r: Math.min(range.e.r, SPREADSHEET_MAX_ROWS - 1),
          c: Math.min(range.e.c, SPREADSHEET_MAX_COLUMNS - 1),
        },
      },
    });
    const maxColumns = Math.max(
      range.e.c + 1,
      rawRows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0),
    );
    const rows = rawRows.slice(0, SPREADSHEET_MAX_ROWS).map((row, rowIndex) => {
      const cells = Array.from(
        { length: Math.min(maxColumns, SPREADSHEET_MAX_COLUMNS) },
        (_, index) => {
          const source = sheet[utils.encode_cell({ r: rowIndex, c: index })];
          return {
            id: `c${index}`,
            columnIndex: index,
            value:
              source?.f && (source.t === "z" || source.v === undefined)
                ? `=${source.f}`
                : String(Array.isArray(row) ? (row[index] ?? "") : ""),
          };
        },
      );
      return {
        id: `r${rowIndex}-${hashString(cells.map((cell) => cell.value).join("\u0000"))}`,
        rowIndex,
        cells,
      };
    });
    return {
      sheetNames,
      rows,
      activeSheetName: selectedSheetName,
      truncatedRows: range.e.r >= SPREADSHEET_MAX_ROWS,
      truncatedColumns: range.e.c >= SPREADSHEET_MAX_COLUMNS,
      error: null,
    };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message.trim() : "";
    return {
      sheetNames: [],
      rows: [],
      activeSheetName: "",
      truncatedRows: false,
      truncatedColumns: false,
      error: detail || fallbackError,
    };
  }
}

/** Patch the original package: serializers of a new workbook discard unsupported parts. */
export async function writeSpreadsheetEdits(
  bytes: Uint8Array,
  edits: SpreadsheetEdits,
): Promise<Uint8Array> {
  if (!spreadsheetHasEdits(edits)) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const xml = async (name: string): Promise<Document> => {
    const part = zip.file(name);
    if (!part) throw new Error("Spreadsheet part is unavailable");
    const document: Document = new DOMParser().parseFromString(
      await part.async("string"),
      "application/xml",
    );
    if (document.getElementsByTagName("parsererror").length)
      throw new Error("Invalid spreadsheet XML");
    return document;
  };
  const workbook = await xml("xl/workbook.xml");
  const namespace = workbook.documentElement.namespaceURI;
  if (
    namespace !== "http://schemas.openxmlformats.org/spreadsheetml/2006/main" &&
    namespace !== "http://purl.oclc.org/ooxml/spreadsheetml/main"
  )
    throw new Error("Unsupported spreadsheet namespace");
  const relationshipNamespace =
    namespace === "http://purl.oclc.org/ooxml/spreadsheetml/main"
      ? "http://purl.oclc.org/ooxml/officeDocument/relationships"
      : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const packageNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  const relationships = await xml("xl/_rels/workbook.xml.rels");
  const links = Array.from(relationships.getElementsByTagNameNS(packageNamespace, "Relationship"));
  const sheets = Array.from(workbook.getElementsByTagNameNS(namespace, "sheet"));
  const serialize = (name: string, document: Document) =>
    zip.file(name, new XMLSerializer().serializeToString(document));
  const targetPath = (link: Element, folder: string) => {
    if (link.getAttribute("TargetMode") === "External")
      throw new Error("External spreadsheet part is unavailable");
    const target = link.getAttribute("Target");
    if (!target || target.includes("\\")) throw new Error("Invalid spreadsheet relationship");
    const url = new URL(target, "https://package.invalid/xl/workbook.xml");
    const path = decodeURIComponent(url.pathname).slice(1);
    if (
      url.origin !== "https://package.invalid" ||
      url.search ||
      url.hash ||
      !path.startsWith(folder) ||
      path.split("/").some((segment) => segment === ".." || segment === ".")
    )
      throw new Error("Invalid spreadsheet relationship");
    return path;
  };
  for (const [sheetName, changes] of Object.entries(edits)) {
    if (!Object.keys(changes).length) continue;
    const sheet = sheets.find((entry) => entry.getAttribute("name") === sheetName);
    const id = sheet?.getAttributeNS(relationshipNamespace, "id");
    const link = links.find((entry) => entry.getAttribute("Id") === id);
    if (!sheet || !link || link.getAttribute("Type") !== `${relationshipNamespace}/worksheet`)
      throw new Error("Spreadsheet sheet is unavailable");
    const path = targetPath(link, "xl/");
    const document: Document = await xml(path);
    if (
      document.documentElement.localName !== "worksheet" ||
      document.documentElement.namespaceURI !== namespace
    )
      throw new Error("Invalid spreadsheet worksheet");
    const data: Element | undefined = document.getElementsByTagNameNS(namespace, "sheetData")[0];
    if (!data) throw new Error("Spreadsheet cells are unavailable");
    const element = (name: string): Element => document.createElementNS(namespace, name);
    const rows: Element[] = Array.from(data.children).filter(
      (entry) => entry.localName === "row" && entry.namespaceURI === namespace,
    );
    const dimension = document.getElementsByTagNameNS(namespace, "dimension")[0];
    let range = dimension?.getAttribute("ref")
      ? utils.decode_range(dimension.getAttribute("ref")!)
      : null;
    if (!range) {
      for (const cell of Array.from(data.getElementsByTagNameNS(namespace, "c"))) {
        const reference = cell.getAttribute("r");
        if (!reference || !/^[A-Z]+[1-9]\d*$/.test(reference)) continue;
        const point = utils.decode_cell(reference);
        range = range
          ? {
              s: { r: Math.min(range.s.r, point.r), c: Math.min(range.s.c, point.c) },
              e: { r: Math.max(range.e.r, point.r), c: Math.max(range.e.c, point.c) },
            }
          : { s: point, e: point };
      }
    }
    const groups = Array.from(document.getElementsByTagNameNS(namespace, "f"))
      .filter(
        (formula) =>
          formula.hasAttribute("ref") &&
          ["shared", "array", "dataTable"].includes(formula.getAttribute("t") ?? ""),
      )
      .map((formula) => utils.decode_range(formula.getAttribute("ref")!));
    for (const [coordinate, value] of Object.entries(changes)) {
      const match = /^(\d+):(\d+)$/.exec(coordinate);
      const row = Number(match?.[1]),
        column = Number(match?.[2]);
      if (
        !match ||
        !Number.isSafeInteger(row) ||
        !Number.isSafeInteger(column) ||
        row >= SPREADSHEET_MAX_ROWS ||
        column >= SPREADSHEET_MAX_COLUMNS ||
        typeof value !== "string" ||
        value.length > SPREADSHEET_MAX_CELL_LENGTH
      )
        throw new Error("Invalid spreadsheet cell");
      for (const scalar of value) {
        const code = scalar.codePointAt(0)!;
        if (code >= 0xd800 && code <= 0xdfff) throw new Error("Invalid spreadsheet Unicode text");
      }
      // Replacing one member of a shared/array formula would invalidate its other members.
      for (const group of groups) {
        if (row >= group.s.r && row <= group.e.r && column >= group.s.c && column <= group.e.c)
          throw new Error(
            "This cell belongs to a shared or array formula; edit it in a spreadsheet application",
          );
      }
      const address = utils.encode_cell({ r: row, c: column });
      let rowElement: Element | undefined = rows.find(
        (entry) => Number(entry.getAttribute("r")) === row + 1,
      );
      if (!rowElement) {
        rowElement = element("row");
        rowElement.setAttribute("r", String(row + 1));
        data.insertBefore(
          rowElement,
          rows.find((entry) => Number(entry.getAttribute("r")) > row + 1) ?? null,
        );
        rows.push(rowElement);
        rows.sort((a, b) => Number(a.getAttribute("r")) - Number(b.getAttribute("r")));
      }
      const cells: Element[] = Array.from(rowElement.children).filter(
        (entry) => entry.localName === "c" && entry.namespaceURI === namespace,
      );
      let cell: Element | undefined = cells.find((entry) => entry.getAttribute("r") === address);
      if (!cell) {
        cell = element("c");
        cell.setAttribute("r", address);
        rowElement.insertBefore(
          cell,
          cells.find((entry) => utils.decode_cell(entry.getAttribute("r") ?? "A1").c > column) ??
            Array.from(rowElement.children).find(
              (entry) => entry.namespaceURI === namespace && entry.localName === "extLst",
            ) ??
            null,
        );
      }
      if (
        Array.from(cell.children).some(
          (entry) =>
            entry.localName === "f" &&
            ["shared", "array", "dataTable"].includes(entry.getAttribute("t") ?? ""),
        )
      )
        throw new Error(
          "This cell belongs to a shared or array formula; edit it in a spreadsheet application",
        );
      // OfficeCLI ApplyCellProperties and GenOffice serializeStyledCell retain
      // numeric/boolean storage independently of style. This text-only editor
      // preserves an existing value's type when the new input is unambiguous;
      // text identifiers and '='-leading text stay literal.
      const previousType = cell.getAttribute("t");
      const hadValue = Array.from(cell.children).some(
        (entry) => entry.namespaceURI === namespace && entry.localName === "v",
      );
      const input = value.trim();
      const numeric =
        (previousType === null || previousType === "n") &&
        hadValue &&
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input) &&
        !/^[+-]?0\d/.test(input) &&
        Number.isFinite(Number(input)) &&
        (!Number.isInteger(Number(input)) || Number.isSafeInteger(Number(input)));
      const boolean = previousType === "b" && /^(?:true|false|yes|no|1|0)$/i.test(input);
      for (const child of Array.from(cell.children)) {
        if (child.namespaceURI === namespace && ["f", "v", "is"].includes(child.localName))
          cell.removeChild(child);
      }
      if (numeric || boolean) {
        cell.setAttribute("t", numeric ? "n" : "b");
        const content = element("v");
        content.textContent = numeric
          ? String(Number(input))
          : /^(?:true|yes|1)$/i.test(input)
            ? "1"
            : "0";
        cell.insertBefore(content, cell.firstChild);
      } else {
        cell.setAttribute("t", "inlineStr");
        const inline = element("is"),
          text = element("t");
        text.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
        // OOXML escapes XML-invalid controls and literal escape sequences independently of XML entities.
        text.textContent = Array.from(
          value.replace(/_x[0-9a-f]{4}_/gi, (sequence) => `_x005F_${sequence.slice(1)}`),
        )
          .map((character) => {
            const code = character.codePointAt(0)!;
            return (code < 32 && code !== 9 && code !== 10) || code === 0xfffe || code === 0xffff
              ? `_x${code.toString(16).padStart(4, "0")}_`
              : character;
          })
          .join("");
        inline.appendChild(text);
        cell.insertBefore(inline, cell.firstChild);
      }
      rowElement.removeAttribute("spans");
      range = range
        ? {
            s: { r: Math.min(range.s.r, row), c: Math.min(range.s.c, column) },
            e: { r: Math.max(range.e.r, row), c: Math.max(range.e.c, column) },
          }
        : { s: { r: row, c: column }, e: { r: row, c: column } };
    }
    if (range) {
      const nextDimension = dimension ?? element("dimension");
      nextDimension.setAttribute("ref", utils.encode_range(range));
      if (!dimension) {
        const afterProperties = Array.from(document.documentElement.children).find(
          (entry) => entry.localName !== "sheetPr",
        );
        document.documentElement.insertBefore(nextDimension, afterProperties ?? null);
      }
    }
    serialize(path, document);
  }
  // The chain is an optional calculation cache. Rebuild it on open after changing formula inputs.
  const calculationLinks = links.filter(
    (entry) => entry.getAttribute("Type") === `${relationshipNamespace}/calcChain`,
  );
  if (calculationLinks.length) {
    const types = await xml("[Content_Types].xml");
    for (const link of calculationLinks) {
      const path = targetPath(link, "xl/");
      zip.remove(path);
      link.parentNode?.removeChild(link);
      for (const entry of Array.from(types.documentElement.children)) {
        if (entry.getAttribute("PartName") === `/${path}`) types.documentElement.removeChild(entry);
      }
    }
    serialize("xl/_rels/workbook.xml.rels", relationships);
    serialize("[Content_Types].xml", types);
  }
  let calculation = workbook.getElementsByTagNameNS(namespace, "calcPr")[0];
  if (!calculation) {
    calculation = workbook.createElementNS(namespace, "calcPr");
    const following = new Set([
      "oleSize",
      "customWorkbookViews",
      "pivotCaches",
      "smartTagPr",
      "smartTagTypes",
      "webPublishing",
      "fileRecoveryPr",
      "webPublishObjects",
      "extLst",
    ]);
    workbook.documentElement.insertBefore(
      calculation,
      Array.from(workbook.documentElement.children).find((entry) =>
        following.has(entry.localName),
      ) ?? null,
    );
  }
  calculation.setAttribute("fullCalcOnLoad", "1");
  calculation.setAttribute("forceFullCalc", "1");
  serialize("xl/workbook.xml", workbook);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export function spreadsheetHasEdits(edits: SpreadsheetEdits | undefined) {
  return !!edits && Object.values(edits).some((sheet) => Object.keys(sheet).length > 0);
}

export function parseSpreadsheetCellEdit(
  value: unknown,
): { sheet: string; row: number; column: number; value: string } | null {
  if (typeof value !== "string") return null;
  try {
    const cell = JSON.parse(value);
    if (
      !cell ||
      typeof cell.sheet !== "string" ||
      typeof cell.value !== "string" ||
      cell.value.length > SPREADSHEET_MAX_CELL_LENGTH ||
      !Number.isInteger(cell.row) ||
      !Number.isInteger(cell.column) ||
      cell.row < 0 ||
      cell.row >= SPREADSHEET_MAX_ROWS ||
      cell.column < 0 ||
      cell.column >= SPREADSHEET_MAX_COLUMNS
    )
      return null;
    return { sheet: cell.sheet, row: cell.row, column: cell.column, value: cell.value };
  } catch {
    return null;
  }
}

/** Rebase only acknowledged cells; edits made while a write was pending survive. */
export function remainingSpreadsheetEdits(
  current: SpreadsheetEdits | undefined,
  written: SpreadsheetEdits | undefined,
): SpreadsheetEdits {
  const next: SpreadsheetEdits = {};
  for (const [sheet, changes] of Object.entries(current ?? {})) {
    const remaining: Record<string, string> = {};
    for (const [coordinate, value] of Object.entries(changes)) {
      if (value !== written?.[sheet]?.[coordinate]) remaining[coordinate] = value;
    }
    if (Object.keys(remaining).length)
      Object.defineProperty(next, sheet, {
        value: remaining,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  return next;
}

export function previewBytes(data: string): Uint8Array {
  const payload = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  return Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
}

export function previewBytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
