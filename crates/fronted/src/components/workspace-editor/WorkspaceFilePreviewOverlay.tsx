import { Banner } from "@astryxdesign/core/Banner";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text as AstryxText, Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { renderAsync } from "docx-preview";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { read, utils, write } from "xlsx";
import { useLocale } from "../../i18n";
import { cn } from "../../lib/shared/utils";
import { writeClipboardText } from "../../lib/system/clipboardText";
import { invokeFs, isFsBackendError } from "../../lib/tools/fsBackend";
import { type FileTypeIconComponent, getFileTypeIcon } from "../chat/fileTypeIcons";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCwSquare,
  Save,
  X,
} from "../icons";
import { MacOsTitleBarSpacer } from "../MacOsTitleBarSpacer";
import { WorkspaceMarkdownPreview } from "./WorkspaceMarkdownPreview";
import { buildSandboxedHtmlPreviewSource } from "./workspaceHtmlPreview";
import {
  getWorkspacePreviewKind,
  isWorkspaceEditablePreviewPath,
  type WorkspacePreviewKind,
} from "./workspaceImagePreview";
export type WorkspaceFilePreviewOpenRequest = {
  id: number;
  projectPathKey: string;
  workdir: string;
  path: string;
  imagePaths?: string[];
};

type ReadWorkspacePreviewResponse = {
  path: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string;
  content?: string | null;
};

type EditableAnnotationResponse = {
  content: string;
  mtimeMs: number;
  contentHash: string;
};

type WorkspaceFilePreviewOverlayProps = {
  openRequest: WorkspaceFilePreviewOpenRequest | null;
  isOpen: boolean;
  presentation: "side" | "fullscreen";
  width?: number | string;
  overlay?: boolean;
  embedded?: boolean;
  onPresentationChange: (presentation: "side" | "fullscreen") => void;
  onRequestClose: () => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

type LoadedPreview = ReadWorkspacePreviewResponse & {
  blobUrl: string;
  bytes: Uint8Array;
  kind: WorkspacePreviewKind;
  text: string | null;
};

type SpreadsheetTable = {
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

const FILE_PREVIEW_OVERLAY_ANIMATION_MS = 180;
const SPREADSHEET_MAX_ROWS = 250;
const SPREADSHEET_MAX_COLUMNS = 80;
const IMAGE_PREVIEW_MIN_SCALE = 0.25;
const IMAGE_PREVIEW_MAX_SCALE = 4;
const IMAGE_PREVIEW_SCALE_STEP = 0.25;
const IMAGE_PREVIEW_WHEEL_SCALE_STEP = 0.1;
const IMAGE_PREVIEW_ENTER_ANIMATION_MS = 200;

type ImagePreviewTransitionDirection = -1 | 0 | 1;

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  const text = String(error ?? "").trim();
  return text || fallback;
}

function base64ToBytes(data: string) {
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function isTextPreviewKind(kind: WorkspacePreviewKind) {
  return kind === "html" || kind === "markdown" || kind === "text";
}

function kindFromMimeType(mimeType: string): WorkspacePreviewKind | null {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "html";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";
  if (
    mime === "text/csv" ||
    mime === "text/tab-separated-values" ||
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "application/vnd.oasis.opendocument.spreadsheet"
  ) {
    return "spreadsheet";
  }
  if (mime.includes("wordprocessingml")) return "document";
  if (mime.includes("presentationml") || mime.includes("powerpoint")) return "presentation";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/")) return "text";
  return null;
}

function resolvePreviewKind(path: string, mimeType: string): WorkspacePreviewKind {
  const mimeKind = kindFromMimeType(mimeType);
  if (mimeKind === "html" || mimeKind === "markdown" || mimeKind === "text") return mimeKind;
  return getWorkspacePreviewKind(path) ?? mimeKind ?? "text";
}

function previewLanguage(path: string, kind: WorkspacePreviewKind) {
  if (kind === "html") return "html";
  if (kind === "markdown") return path.toLowerCase().endsWith(".mdx") ? "mdx" : "markdown";
  return path.split(".").pop()?.toLowerCase() || "plaintext";
}

function decodePreviewText(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

function clampImageScale(scale: number) {
  return Math.min(Math.max(scale, IMAGE_PREVIEW_MIN_SCALE), IMAGE_PREVIEW_MAX_SCALE);
}

function normalizeRotation(degrees: number) {
  const next = degrees % 360;
  return next < 0 ? next + 360 : next;
}

function normalizeImagePaths(paths: string[] | undefined, activePath: string) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const path of paths ?? []) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    normalized.push(path);
  }
  if (activePath && !seen.has(activePath)) {
    normalized.push(activePath);
  }
  return normalized;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getPreviewIcon(kind: WorkspacePreviewKind): FileTypeIconComponent {
  switch (kind) {
    case "audio":
      return getFileTypeIcon("preview.mp3", "file");
    case "document":
      return getFileTypeIcon("preview.docx", "file");
    case "html":
      return getFileTypeIcon("preview.html", "file");
    case "image":
      return getFileTypeIcon("preview.png", "file");
    case "markdown":
      return getFileTypeIcon("preview.md", "file");
    case "pdf":
      return getFileTypeIcon("preview.pdf", "file");
    case "presentation":
      return getFileTypeIcon("preview.pptx", "file");
    case "spreadsheet":
      return getFileTypeIcon("preview.xlsx", "file");
    case "video":
      return getFileTypeIcon("preview.mp4", "file");
    case "text":
      return getFileTypeIcon("preview.txt", "file");
  }
}

function buildSpreadsheetTable(
  preview: LoadedPreview | null,
  activeSheetName: string,
  fallbackError: string,
): SpreadsheetTable | null {
  if (!preview || preview.kind !== "spreadsheet") return null;
  try {
    const workbook = read(preview.bytes, { type: "array", cellDates: true });
    const sheetNames = workbook.SheetNames;
    const selectedSheetName =
      sheetNames.find((name) => name === activeSheetName) ?? sheetNames[0] ?? "";
    const sheet = selectedSheetName ? workbook.Sheets[selectedSheetName] : null;
    if (!sheet) {
      return {
        sheetNames,
        rows: [],
        activeSheetName: selectedSheetName,
        truncatedRows: false,
        truncatedColumns: false,
        error: null,
      };
    }
    const sheetRange = utils.decode_range(sheet["!ref"] || "A1");
    const rawRows = utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: true,
      range: {
        s: { r: 0, c: 0 },
        e: {
          r: Math.min(sheetRange.e.r, SPREADSHEET_MAX_ROWS - 1),
          c: Math.min(sheetRange.e.c, SPREADSHEET_MAX_COLUMNS - 1),
        },
      },
      defval: "",
      raw: false,
    });
    const maxColumns = rawRows.reduce(
      (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
      0,
    );
    const rows = rawRows.slice(0, SPREADSHEET_MAX_ROWS).map((row, rowIndex) => {
      const cells = Array.from(
        { length: Math.min(maxColumns, SPREADSHEET_MAX_COLUMNS) },
        (_, index) => ({
          id: `c${index}`,
          columnIndex: index,
          value: String(Array.isArray(row) ? (row[index] ?? "") : ""),
        }),
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
      truncatedRows: rawRows.length > SPREADSHEET_MAX_ROWS,
      truncatedColumns: maxColumns > SPREADSHEET_MAX_COLUMNS,
      error: null,
    };
  } catch (error) {
    return {
      sheetNames: [],
      rows: [],
      activeSheetName: "",
      truncatedRows: false,
      truncatedColumns: false,
      error: toMessage(error, fallbackError),
    };
  }
}

export function WorkspaceFilePreviewOverlay(props: WorkspaceFilePreviewOverlayProps) {
  const {
    openRequest,
    isOpen,
    presentation,
    width,
    overlay = false,
    embedded = false,
    onPresentationChange,
    onRequestClose,
    onClose,
  } = props;
  const { t } = useLocale();
  const closeAnimationTimeoutRef = useRef<number | null>(null);
  const loadSequenceRef = useRef(0);
  const previewBlobUrlRef = useRef<string | null>(null);
  const previewRef = useRef<LoadedPreview | null>(null);
  const [preview, setPreview] = useState<LoadedPreview | null>(null);
  const [activeRequest, setActiveRequest] = useState<WorkspaceFilePreviewOpenRequest | null>(null);
  const [imageTransitionDirection, setImageTransitionDirection] =
    useState<ImagePreviewTransitionDirection>(0);
  const [activeSheetName, setActiveSheetName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [sourceCopied, setSourceCopied] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceSaved, setSourceSaved] = useState("");
  const [sourceSaving, setSourceSaving] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [annotationSaved, setAnnotationSaved] = useState("");
  const [annotationVersion, setAnnotationVersion] = useState<{
    mtimeMs: number;
    contentHash: string;
  } | null>(null);
  const [spreadsheetEdits, setSpreadsheetEdits] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [activeTab, setActiveTab] = useState<"preview" | "source" | "annotations">("preview");
  const [isVisible, setIsVisible] = useState(false);
  const dirty =
    sourceDraft !== sourceSaved ||
    annotationDraft !== annotationSaved ||
    Object.values(spreadsheetEdits).some((edits) => Object.keys(edits).length > 0);
  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);

  const replacePreview = useCallback((next: LoadedPreview | null) => {
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
    }
    previewBlobUrlRef.current = next?.blobUrl ?? null;
    previewRef.current = next;
    setActiveSheetName("");
    setSourceCopied(false);
    setSourceDraft(next?.text ?? "");
    setSourceSaved(next?.text ?? "");
    setSpreadsheetEdits({});
    setPreview(next);
  }, []);

  useEffect(
    () => () => {
      if (previewBlobUrlRef.current) {
        URL.revokeObjectURL(previewBlobUrlRef.current);
        previewBlobUrlRef.current = null;
      }
      previewRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (isOpen) {
      if (closeAnimationTimeoutRef.current !== null) {
        window.clearTimeout(closeAnimationTimeoutRef.current);
        closeAnimationTimeoutRef.current = null;
      }
      const animationFrame = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(animationFrame);
    }

    setIsVisible(false);
    closeAnimationTimeoutRef.current = window.setTimeout(() => {
      closeAnimationTimeoutRef.current = null;
      onClose();
    }, FILE_PREVIEW_OVERLAY_ANIMATION_MS);
  }, [isOpen, onClose]);

  useEffect(
    () => () => {
      if (closeAnimationTimeoutRef.current !== null) {
        window.clearTimeout(closeAnimationTimeoutRef.current);
      }
    },
    [],
  );

  const loadPreview = useCallback(
    async (
      request: WorkspaceFilePreviewOpenRequest,
      transitionDirection: ImagePreviewTransitionDirection = 0,
    ) => {
      const sequence = loadSequenceRef.current + 1;
      loadSequenceRef.current = sequence;
      const keepCurrentImagePreview =
        transitionDirection !== 0 &&
        previewRef.current?.kind === "image" &&
        getWorkspacePreviewKind(request.path) === "image";
      setImageTransitionDirection(transitionDirection);
      setLoading(true);
      setError(null);
      setRenderError(null);
      setActiveTab("preview");
      setActiveRequest(request);
      if (!keepCurrentImagePreview) {
        replacePreview(null);
      }
      try {
        const response = await invokeFs<ReadWorkspacePreviewResponse>("fs_read_workspace_image", {
          workdir: request.workdir,
          path: request.path,
        });
        if (loadSequenceRef.current !== sequence) return;
        const bytes = base64ToBytes(response.data);
        const kind = resolvePreviewKind(response.path || request.path, response.mimeType);
        const text =
          response.content ??
          (isTextPreviewKind(kind) || isWorkspaceEditablePreviewPath(response.path || request.path)
            ? decodePreviewText(bytes)
            : null);
        const blobBytes =
          kind === "html" && text !== null
            ? new TextEncoder().encode(buildSandboxedHtmlPreviewSource(text))
            : bytes;
        const blob = new Blob([bytesToArrayBuffer(blobBytes)], { type: response.mimeType });
        const loaded: LoadedPreview = {
          ...response,
          blobUrl: URL.createObjectURL(blob),
          bytes,
          kind,
          text,
        };
        replacePreview(loaded);
      } catch (loadError) {
        if (loadSequenceRef.current !== sequence) return;
        if (!keepCurrentImagePreview) {
          replacePreview(null);
        }
        setError(toMessage(loadError, t("workspaceFilePreview.openFailed")));
      } finally {
        if (loadSequenceRef.current === sequence) {
          setLoading(false);
        }
      }
    },
    [replacePreview, t],
  );

  useEffect(() => {
    if (!openRequest) {
      setActiveRequest(null);
      return;
    }
    void loadPreview(openRequest, 0);
  }, [loadPreview, openRequest]);

  const spreadsheet = useMemo(
    () => buildSpreadsheetTable(preview, activeSheetName, t("workspaceFilePreview.renderFailed")),
    [activeSheetName, preview, t],
  );

  useEffect(() => {
    if (!spreadsheet?.activeSheetName) return;
    setActiveSheetName((current) => current || spreadsheet.activeSheetName);
  }, [spreadsheet?.activeSheetName]);

  const activePreviewRequest = activeRequest ?? openRequest;
  const activePath = preview?.path ?? activePreviewRequest?.path ?? "";
  const kind = preview?.kind ?? (activePath ? getWorkspacePreviewKind(activePath) : null) ?? "text";
  const PreviewIcon = getPreviewIcon(kind);
  const imagePaths = useMemo(
    () =>
      kind === "image" ? normalizeImagePaths(activePreviewRequest?.imagePaths, activePath) : [],
    [activePath, activePreviewRequest?.imagePaths, kind],
  );
  const canEditDocument = Boolean(
    preview?.kind === "document" &&
      activePath.toLowerCase().endsWith(".docx") &&
      preview.text !== null &&
      preview.text !== undefined,
  );
  const canShowSource = Boolean(
    activePreviewRequest &&
      (isWorkspaceEditablePreviewPath(activePath) || canEditDocument) &&
      preview?.text !== null &&
      preview?.text !== undefined,
  );
  const canOpenExternal = Boolean(activePreviewRequest && activePath);
  const canAnnotate = kind === "pdf" || kind === "presentation";
  const canEditSpreadsheet =
    preview?.kind === "spreadsheet" && activePath.toLowerCase().endsWith(".xlsx");
  const spreadsheetHasEdits = Object.values(spreadsheetEdits).some(
    (sheet) => Object.keys(sheet).length > 0,
  );

  useEffect(() => {
    setAnnotationDraft("");
    setAnnotationSaved("");
    setAnnotationVersion(null);
    if (!activePreviewRequest || !canAnnotate || !activePath) return;
    let cancelled = false;
    void invokeFs<EditableAnnotationResponse>("fs_read_editable_text", {
      workdir: activePreviewRequest.workdir,
      path: `${activePath}.xgent-annotations.md`,
    })
      .then((response) => {
        if (cancelled) return;
        setAnnotationDraft(response.content);
        setAnnotationSaved(response.content);
        setAnnotationVersion({
          mtimeMs: response.mtimeMs,
          contentHash: response.contentHash,
        });
      })
      .catch((annotationError) => {
        if (
          cancelled ||
          (isFsBackendError(annotationError) && annotationError.code === "not_found")
        ) {
          return;
        }
        setError(toMessage(annotationError, t("workspaceFilePreview.openFailed")));
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, activePreviewRequest, canAnnotate, t]);

  const copyPreviewSource = useCallback(async () => {
    if (preview?.text === null || preview?.text === undefined) return;
    if (await writeClipboardText(sourceDraft)) {
      setSourceCopied(true);
      window.setTimeout(() => setSourceCopied(false), 1600);
    } else {
      setError(t("workspaceFilePreview.copyFailed"));
    }
  }, [preview?.text, sourceDraft, t]);

  const saveSource = useCallback(async () => {
    if (!activePreviewRequest || !preview || sourceDraft === sourceSaved || sourceSaving) return;
    setSourceSaving(true);
    setError(null);
    try {
      const path = activePath || activePreviewRequest.path;
      if (canEditDocument) {
        await invokeFs("fs_write_docx_text", {
          workdir: activePreviewRequest.workdir,
          path,
          content: sourceDraft,
          expected_mtime_ms: preview.mtimeMs,
          expected_content_hash: preview.contentHash,
        });
      } else {
        await invokeFs("fs_write_text", {
          workdir: activePreviewRequest.workdir,
          path,
          content: sourceDraft,
          mode: "rewrite",
          expected_mtime_ms: preview.mtimeMs,
          expected_content_hash: preview.contentHash,
        });
      }
      await loadPreview(activePreviewRequest, 0);
      setActiveTab("source");
    } catch (saveError) {
      setError(toMessage(saveError, t("workspaceEditor.saveFailed")));
    } finally {
      setSourceSaving(false);
    }
  }, [
    activePath,
    activePreviewRequest,
    canEditDocument,
    loadPreview,
    preview,
    sourceDraft,
    sourceSaved,
    sourceSaving,
    t,
  ]);

  const saveSpreadsheet = useCallback(async () => {
    if (!activePreviewRequest || !preview || !canEditSpreadsheet || !spreadsheetHasEdits) return;
    setSourceSaving(true);
    setError(null);
    try {
      const workbook = read(preview.bytes, { type: "array", cellDates: true });
      for (const [sheetName, edits] of Object.entries(spreadsheetEdits)) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        for (const [coordinate, value] of Object.entries(edits)) {
          const [rowText, columnText] = coordinate.split(":");
          const row = Number(rowText);
          const column = Number(columnText);
          if (!Number.isInteger(row) || !Number.isInteger(column)) continue;
          sheet[utils.encode_cell({ r: row, c: column })] = { t: "s", v: value };
        }
      }
      const output = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
      await invokeFs("fs_write_binary", {
        workdir: activePreviewRequest.workdir,
        path: activePath || activePreviewRequest.path,
        content_base64: bytesToBase64(output),
        expected_mtime_ms: preview.mtimeMs,
        expected_content_hash: preview.contentHash,
      });
      await loadPreview(activePreviewRequest, 0);
    } catch (saveError) {
      setError(toMessage(saveError, t("workspaceEditor.saveFailed")));
    } finally {
      setSourceSaving(false);
    }
  }, [
    activePath,
    activePreviewRequest,
    canEditSpreadsheet,
    loadPreview,
    preview,
    spreadsheetEdits,
    spreadsheetHasEdits,
    t,
  ]);

  const saveAnnotations = useCallback(async () => {
    if (!activePreviewRequest || !canAnnotate || annotationDraft === annotationSaved) return;
    setSourceSaving(true);
    setError(null);
    try {
      const response = await invokeFs<{
        mtimeMs: number;
        contentHash: string;
      }>("fs_write_text", {
        workdir: activePreviewRequest.workdir,
        path: `${activePath || activePreviewRequest.path}.xgent-annotations.md`,
        content: annotationDraft,
        mode: "rewrite",
        expected_mtime_ms: annotationVersion?.mtimeMs,
        expected_content_hash: annotationVersion?.contentHash,
      });
      setAnnotationSaved(annotationDraft);
      setAnnotationVersion({
        mtimeMs: response.mtimeMs,
        contentHash: response.contentHash,
      });
    } catch (saveError) {
      setError(toMessage(saveError, t("workspaceEditor.saveFailed")));
    } finally {
      setSourceSaving(false);
    }
  }, [
    activePath,
    activePreviewRequest,
    annotationDraft,
    annotationSaved,
    annotationVersion,
    canAnnotate,
    t,
  ]);

  const saveImageRotation = useCallback(
    async (degrees: number) => {
      if (!activePreviewRequest || !preview || preview.kind !== "image") return;
      setSourceSaving(true);
      setError(null);
      try {
        const image = new Image();
        image.src = preview.blobUrl;
        await image.decode();
        const normalized = normalizeRotation(degrees);
        const swapsAxes = normalized === 90 || normalized === 270;
        const canvas = document.createElement("canvas");
        canvas.width = swapsAxes ? image.naturalHeight : image.naturalWidth;
        canvas.height = swapsAxes ? image.naturalWidth : image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas image editing is unavailable");
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate((normalized * Math.PI) / 180);
        context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
        const mimeType = preview.mimeType === "image/jpg" ? "image/jpeg" : preview.mimeType;
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) => (result ? resolve(result) : reject(new Error("Image encoding failed"))),
            mimeType,
            mimeType === "image/jpeg" || mimeType === "image/webp" ? 0.94 : undefined,
          );
        });
        await invokeFs("fs_write_binary", {
          workdir: activePreviewRequest.workdir,
          path: activePath || activePreviewRequest.path,
          content_base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
          expected_mtime_ms: preview.mtimeMs,
          expected_content_hash: preview.contentHash,
        });
        await loadPreview(activePreviewRequest, 0);
      } catch (saveError) {
        setError(toMessage(saveError, t("workspaceEditor.saveFailed")));
      } finally {
        setSourceSaving(false);
      }
    },
    [activePath, activePreviewRequest, loadPreview, preview, t],
  );

  const openImagePath = useCallback(
    (path: string, transitionDirection: ImagePreviewTransitionDirection = 0) => {
      if (!activePreviewRequest || !path || path === activePath) return;
      void loadPreview({ ...activePreviewRequest, path }, transitionDirection);
    },
    [activePath, activePreviewRequest, loadPreview],
  );

  const openExternal = useCallback(async () => {
    if (!activePreviewRequest) return;
    const path = activePath || activePreviewRequest.path;
    try {
      setError(null);
      await invokeFs("fs_open_workspace_path", {
        workdir: activePreviewRequest.workdir,
        path,
        mode: "open",
      });
    } catch (openError) {
      setError(toMessage(openError, t("workspaceFilePreview.openExternalFailed")));
    }
  }, [activePath, activePreviewRequest, t]);

  return (
    <VStack
      className="xgent-workspace-preview-overlay"
      data-visible={isVisible ? "true" : "false"}
      width="100%"
      height="100%"
      style={{
        position: overlay ? "absolute" : "relative",
        inset: overlay ? 0 : undefined,
        zIndex: "var(--xgent-z-workspace-overlay)",
        flex: embedded || presentation === "fullscreen" ? "1 1 auto" : "0 0 auto",
        width: embedded || presentation === "fullscreen" ? "100%" : width,
        maxWidth: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        backgroundColor: "var(--color-background-body)",
        borderInlineStart:
          overlay || embedded ? undefined : "var(--border-width) solid var(--color-border)",
        paddingBlockStart: overlay ? "env(safe-area-inset-top, 0px)" : undefined,
        paddingBlockEnd: overlay ? "env(safe-area-inset-bottom, 0px)" : undefined,
      }}
    >
      {!embedded ? <MacOsTitleBarSpacer /> : null}
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={0}>
            <VStack gap={0} width="100%">
              <Toolbar
                label={t("workspaceFilePreview.title")}
                size="sm"
                startContent={
                  <HStack gap={2} vAlign="center">
                    <Icon icon={PreviewIcon} size="sm" color="accent" />
                    <StackItem size="fill">
                      <VStack gap={0.5}>
                        <Heading level={4}>{t("workspaceFilePreview.title")}</Heading>
                        <Text type="supporting" color="secondary" maxLines={1}>
                          {activePath}
                        </Text>
                      </VStack>
                    </StackItem>
                  </HStack>
                }
                endContent={
                  <HStack gap={1} vAlign="center">
                    {preview?.text !== null && preview?.text !== undefined ? (
                      <IconButton
                        label={
                          sourceCopied
                            ? t("workspaceFilePreview.copied")
                            : t("workspaceFilePreview.copySource")
                        }
                        tooltip={
                          sourceCopied
                            ? t("workspaceFilePreview.copied")
                            : t("workspaceFilePreview.copySource")
                        }
                        icon={<Icon icon={sourceCopied ? Check : Copy} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        onClick={() => void copyPreviewSource()}
                      />
                    ) : null}
                    {canShowSource && activeTab === "source" ? (
                      <IconButton
                        label={t("workspaceEditor.save")}
                        tooltip={t("workspaceEditor.save")}
                        icon={<Icon icon={Save} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        isLoading={sourceSaving}
                        isDisabled={sourceDraft === sourceSaved || sourceSaving}
                        onClick={() => void saveSource()}
                      />
                    ) : null}
                    {canEditSpreadsheet ? (
                      <IconButton
                        label={t("workspaceEditor.save")}
                        tooltip={t("workspaceEditor.save")}
                        icon={<Icon icon={Save} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        isLoading={sourceSaving}
                        isDisabled={!spreadsheetHasEdits || sourceSaving}
                        onClick={() => void saveSpreadsheet()}
                      />
                    ) : null}
                    {canAnnotate && activeTab === "annotations" ? (
                      <IconButton
                        label={t("workspaceEditor.save")}
                        tooltip={t("workspaceEditor.save")}
                        icon={<Icon icon={Save} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        isLoading={sourceSaving}
                        isDisabled={annotationDraft === annotationSaved || sourceSaving}
                        onClick={() => void saveAnnotations()}
                      />
                    ) : null}
                    {canOpenExternal ? (
                      <IconButton
                        label={t("workspaceFilePreview.openExternal")}
                        tooltip={t("workspaceFilePreview.openExternal")}
                        icon={<Icon icon={ExternalLink} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        onClick={() => void openExternal()}
                      />
                    ) : null}
                    <IconButton
                      label={t("workspaceFilePreview.reload")}
                      tooltip={t("workspaceFilePreview.reload")}
                      icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                      variant="ghost"
                      size="sm"
                      isLoading={loading}
                      isDisabled={!activePreviewRequest || loading}
                      onClick={() =>
                        activePreviewRequest && void loadPreview(activePreviewRequest, 0)
                      }
                    />
                    {!overlay && !embedded ? (
                      <IconButton
                        label={
                          presentation === "fullscreen"
                            ? t("workspaceFilePreview.restoreSidePanel")
                            : t("workspaceFilePreview.maximize")
                        }
                        tooltip={
                          presentation === "fullscreen"
                            ? t("workspaceFilePreview.restoreSidePanel")
                            : t("workspaceFilePreview.maximize")
                        }
                        icon={
                          <Icon
                            icon={presentation === "fullscreen" ? Minimize2 : Maximize2}
                            size="sm"
                            color="inherit"
                          />
                        }
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onPresentationChange(
                            presentation === "fullscreen" ? "side" : "fullscreen",
                          )
                        }
                      />
                    ) : null}
                    {!embedded ? (
                      <IconButton
                        label={t("workspaceFilePreview.close")}
                        tooltip={t("workspaceFilePreview.close")}
                        icon={<Icon icon={X} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        onClick={onRequestClose}
                      />
                    ) : null}
                  </HStack>
                }
              />
              {canShowSource || canAnnotate ? (
                <HStack width="100%" paddingInline={3}>
                  <TabList
                    value={activeTab}
                    onChange={(value) =>
                      setActiveTab(
                        value === "source"
                          ? "source"
                          : value === "annotations"
                            ? "annotations"
                            : "preview",
                      )
                    }
                    size="sm"
                    overflow="auto"
                  >
                    <Tab value="preview" label={t("workspaceFilePreview.preview")} />
                    {canShowSource ? (
                      <Tab value="source" label={t("workspaceFilePreview.source")} />
                    ) : null}
                    {canAnnotate ? <Tab value="annotations" label="Annotations" /> : null}
                  </TabList>
                </HStack>
              ) : null}
            </VStack>
          </LayoutHeader>
        }
        content={
          <VStack height="100%" gap={0}>
            {error || renderError || spreadsheet?.error ? (
              <Banner
                status="error"
                title={t("workspaceFilePreview.renderFailed")}
                description={error ?? renderError ?? spreadsheet?.error ?? undefined}
                collapsible={false}
              />
            ) : null}
            <StackItem size="fill">
              <LayoutContent padding={0} className="xgent-workspace-file-preview-stage">
                {preview && activeTab === "annotations" && canAnnotate ? (
                  <VStack height="100%" minHeight={0} padding={3} gap={2}>
                    <Text type="supporting" color="secondary">
                      Notes are saved beside the original as {basename(activePath)}
                      .xgent-annotations.md
                    </Text>
                    <TextArea
                      label="Annotations"
                      isLabelHidden
                      value={annotationDraft}
                      onChange={setAnnotationDraft}
                      rows={30}
                      width="100%"
                      className="h-full min-h-0 text-sm"
                    />
                  </VStack>
                ) : preview && activeTab === "source" && preview.text !== null ? (
                  <VStack height="100%" minHeight={0} padding={3}>
                    <TextArea
                      label={`${basename(activePath)} · ${previewLanguage(activePath, preview.kind)}`}
                      isLabelHidden
                      value={sourceDraft}
                      onChange={setSourceDraft}
                      rows={30}
                      width="100%"
                      className="h-full min-h-0 font-mono text-xs"
                    />
                  </VStack>
                ) : preview ? (
                  <PreviewBody
                    preview={preview}
                    workdir={activePreviewRequest?.workdir ?? ""}
                    activePath={activePath}
                    imagePaths={imagePaths}
                    imageTransitionDirection={imageTransitionDirection}
                    isSwitchingImage={loading && preview.kind === "image"}
                    spreadsheet={spreadsheet}
                    activeSheetName={activeSheetName}
                    onOpenImagePath={openImagePath}
                    onActiveSheetNameChange={setActiveSheetName}
                    spreadsheetEdits={spreadsheetEdits}
                    spreadsheetEditable={canEditSpreadsheet}
                    onSpreadsheetCellChange={(sheetName, row, column, value) =>
                      setSpreadsheetEdits((current) => ({
                        ...current,
                        [sheetName]: {
                          ...current[sheetName],
                          [`${row}:${column}`]: value,
                        },
                      }))
                    }
                    onSaveImageRotation={saveImageRotation}
                    onRenderError={setRenderError}
                  />
                ) : loading ? (
                  <Spinner size="lg" label={t("workspaceFilePreview.loading")} />
                ) : (
                  <EmptyState
                    title={t("workspaceFilePreview.empty")}
                    icon={<Icon icon={FileText} size="lg" color="secondary" />}
                    isCompact
                  />
                )}
              </LayoutContent>
            </StackItem>
          </VStack>
        }
        footer={
          <LayoutFooter hasDivider padding={2}>
            <HStack gap={3} vAlign="center" hAlign="between">
              <StackItem size="fill">
                <Text type="supporting" color="secondary" maxLines={1}>
                  {activePath}
                </Text>
              </StackItem>
              {preview ? (
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {preview.mimeType} · {formatBytes(preview.sizeBytes)}
                </Text>
              ) : null}
            </HStack>
          </LayoutFooter>
        }
      />
    </VStack>
  );
}

function PreviewBody(props: {
  preview: LoadedPreview;
  workdir: string;
  activePath: string;
  imagePaths: string[];
  imageTransitionDirection: ImagePreviewTransitionDirection;
  isSwitchingImage: boolean;
  spreadsheet: SpreadsheetTable | null;
  activeSheetName: string;
  spreadsheetEdits: Record<string, Record<string, string>>;
  spreadsheetEditable: boolean;
  onOpenImagePath: (path: string, direction?: ImagePreviewTransitionDirection) => void;
  onActiveSheetNameChange: (sheetName: string) => void;
  onSpreadsheetCellChange: (sheetName: string, row: number, column: number, value: string) => void;
  onSaveImageRotation: (degrees: number) => Promise<void>;
  onRenderError: (message: string | null) => void;
}) {
  const {
    preview,
    workdir,
    activePath,
    imagePaths,
    imageTransitionDirection,
    isSwitchingImage,
    spreadsheet,
    activeSheetName,
    spreadsheetEdits,
    spreadsheetEditable,
    onOpenImagePath,
    onActiveSheetNameChange,
    onSpreadsheetCellChange,
    onSaveImageRotation,
    onRenderError,
  } = props;
  const { t } = useLocale();
  const docxContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (preview.kind !== "document") return;
    const container = docxContainerRef.current;
    if (!container) return;
    let cancelled = false;
    container.innerHTML = "";
    onRenderError(null);
    void renderAsync(bytesToArrayBuffer(preview.bytes), container, undefined, {
      className: "workspace-docx-preview",
      inWrapper: true,
      ignoreFonts: false,
      breakPages: true,
      useBase64URL: true,
    }).catch((docxError) => {
      if (!cancelled) {
        onRenderError(toMessage(docxError, t("workspaceFilePreview.renderFailed")));
      }
    });
    return () => {
      cancelled = true;
      container.innerHTML = "";
    };
  }, [onRenderError, preview, t]);

  if (preview.kind === "image") {
    return (
      <WorkspaceImagePreviewBody
        key={`${preview.path}:${preview.contentHash}`}
        activePath={activePath}
        imagePaths={imagePaths}
        transitionDirection={imageTransitionDirection}
        isSwitchingImage={isSwitchingImage}
        preview={preview}
        onOpenImagePath={onOpenImagePath}
        onSaveRotation={onSaveImageRotation}
      />
    );
  }

  if (preview.kind === "pdf") {
    return (
      <iframe
        className="h-full w-full border-0 bg-background"
        src={preview.blobUrl}
        title={basename(preview.path)}
      />
    );
  }

  if (preview.kind === "presentation") {
    return (
      <AstryxStack direction="vertical" className="h-full overflow-auto bg-muted/25 p-5">
        <pre className="mx-auto w-full max-w-4xl whitespace-pre-wrap rounded-lg border border-border bg-background p-5 text-sm leading-6 text-foreground shadow-sm">
          {preview.text || t("workspaceFilePreview.empty")}
        </pre>
      </AstryxStack>
    );
  }

  if (preview.kind === "html") {
    return (
      <iframe
        className="h-full w-full border-0 bg-background"
        sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups"
        src={preview.blobUrl}
        title={basename(preview.path)}
      />
    );
  }

  if (preview.kind === "markdown") {
    return (
      <AstryxStack direction="vertical" className="h-full overflow-auto bg-background px-6 py-5">
        <WorkspaceMarkdownPreview
          workdir={workdir}
          markdownPath={preview.path || activePath}
          content={preview.text ?? ""}
          className="text-sm leading-6"
          onOpenWorkspacePath={(path) => onOpenImagePath(path, 0)}
        />
      </AstryxStack>
    );
  }

  if (preview.kind === "document") {
    return (
      <AstryxStack
        direction="vertical"
        className="h-full overflow-auto bg-neutral-200 p-4 dark:bg-neutral-950"
      >
        <AstryxStack
          direction="vertical"
          ref={docxContainerRef}
          className="workspace-file-preview-docx min-h-full"
        />
      </AstryxStack>
    );
  }

  if (preview.kind === "spreadsheet") {
    return (
      <AstryxStack direction="vertical" className="flex h-full min-h-0 flex-col bg-background">
        {spreadsheet && spreadsheet.sheetNames.length > 1 ? (
          <AstryxStack
            direction="horizontal"
            className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/35 px-2"
          >
            {spreadsheet.sheetNames.map((sheetName) => (
              <AstryxButton
                variant="ghost"
                label={sheetName}
                key={sheetName}
                type="button"
                className={cn(
                  "h-7 max-w-48 shrink-0 truncate rounded-md px-2.5 text-xs transition-colors",
                  (activeSheetName || spreadsheet.activeSheetName) === sheetName
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                tooltip={sheetName}
                onClick={() => onActiveSheetNameChange(sheetName)}
              >
                {sheetName}
              </AstryxButton>
            ))}
          </AstryxStack>
        ) : null}
        <AstryxStack direction="vertical" className="min-h-0 flex-1 overflow-auto">
          {spreadsheet?.rows.length ? (
            <table className="min-w-full border-separate border-spacing-0 text-xs">
              <tbody>
                {spreadsheet.rows.map((row, rowIndex) => (
                  <tr key={row.id} className={rowIndex === 0 ? "bg-muted/60" : ""}>
                    {row.cells.map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          "max-w-80 whitespace-pre-wrap border-b border-r border-border px-2 py-1.5 align-top",
                          rowIndex === 0 && "font-semibold text-foreground",
                        )}
                      >
                        <input
                          aria-label={`${spreadsheet.activeSheetName} R${row.rowIndex + 1} C${cell.columnIndex + 1}`}
                          className="h-full min-w-24 bg-transparent outline-none focus:ring-1 focus:ring-accent"
                          readOnly={!spreadsheetEditable}
                          value={
                            spreadsheetEdits[spreadsheet.activeSheetName]?.[
                              `${row.rowIndex}:${cell.columnIndex}`
                            ] ?? cell.value
                          }
                          onChange={(event) =>
                            onSpreadsheetCellChange(
                              spreadsheet.activeSheetName,
                              row.rowIndex,
                              cell.columnIndex,
                              event.currentTarget.value,
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <AstryxStack
              direction="horizontal"
              className="flex h-full items-center justify-center text-sm text-muted-foreground"
            >
              {t("workspaceFilePreview.emptySheet")}
            </AstryxStack>
          )}
        </AstryxStack>
        {spreadsheet?.truncatedRows || spreadsheet?.truncatedColumns ? (
          <AstryxStack
            direction="vertical"
            className="shrink-0 border-t border-border bg-muted/35 px-3 py-1.5 text-[11px] text-muted-foreground"
          >
            {t("workspaceFilePreview.truncated")}
          </AstryxStack>
        ) : null}
      </AstryxStack>
    );
  }

  if (preview.kind === "audio") {
    return (
      <AstryxStack direction="horizontal" className="flex h-full items-center justify-center p-6">
        {/* biome-ignore lint/a11y/useMediaCaption: Workspace media previews do not have a separate caption track available. */}
        <audio className="w-full max-w-2xl" controls src={preview.blobUrl}>
          {basename(preview.path)}
        </audio>
      </AstryxStack>
    );
  }

  if (preview.kind === "video") {
    return (
      <AstryxStack
        direction="horizontal"
        className="flex h-full items-center justify-center overflow-auto p-4 sm:p-6"
      >
        {/* biome-ignore lint/a11y/useMediaCaption: Workspace media previews do not have a separate caption track available. */}
        <video className="max-h-full max-w-full bg-black" controls src={preview.blobUrl}>
          {basename(preview.path)}
        </video>
      </AstryxStack>
    );
  }

  return (
    <AstryxStack direction="vertical" className="h-full overflow-auto bg-background p-4">
      <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
        {preview.text ?? ""}
      </pre>
    </AstryxStack>
  );
}

function ImagePreviewToolButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const { label, disabled, onClick, children } = props;
  return (
    <AstryxButton
      variant="ghost"
      label={label}
      type="button"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      tooltip={label}
      aria-label={label}
      isDisabled={disabled}
      onClick={onClick}
    >
      {children}
    </AstryxButton>
  );
}

function WorkspaceImagePreviewBody(props: {
  preview: LoadedPreview;
  activePath: string;
  imagePaths: string[];
  transitionDirection: ImagePreviewTransitionDirection;
  isSwitchingImage: boolean;
  onOpenImagePath: (path: string, direction?: ImagePreviewTransitionDirection) => void;
  onSaveRotation: (degrees: number) => Promise<void>;
}) {
  const {
    preview,
    activePath,
    imagePaths,
    transitionDirection,
    isSwitchingImage,
    onOpenImagePath,
    onSaveRotation,
  } = props;
  const { t } = useLocale();
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [saving, setSaving] = useState(false);
  const [isEntering, setIsEntering] = useState(true);
  const [isClippingEnterOverflow, setIsClippingEnterOverflow] = useState(true);

  const activeImageIndex = imagePaths.indexOf(activePath);
  const imageCount = Math.max(imagePaths.length, 1);
  const imageNumber = activeImageIndex >= 0 ? activeImageIndex + 1 : 1;
  const canOpenPrevious = activeImageIndex > 0;
  const canOpenNext = activeImageIndex >= 0 && activeImageIndex < imagePaths.length - 1;
  const canZoomOut = scale > IMAGE_PREVIEW_MIN_SCALE;
  const canZoomIn = scale < IMAGE_PREVIEW_MAX_SCALE;
  const counter = t("workspaceFilePreview.imageCounter")
    .replace("{index}", String(imageNumber))
    .replace("{total}", String(imageCount));
  const canSaveRotation = ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(
    preview.mimeType,
  );

  const openImageAt = useCallback(
    (index: number) => {
      const path = imagePaths[index];
      if (!path) return;
      onOpenImagePath(path, index > activeImageIndex ? 1 : -1);
    },
    [activeImageIndex, imagePaths, onOpenImagePath],
  );

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => setIsEntering(false));
    const timeout = window.setTimeout(
      () => setIsClippingEnterOverflow(false),
      IMAGE_PREVIEW_ENTER_ANIMATION_MS,
    );
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, []);

  const enterTranslateX = transitionDirection > 0 ? 18 : transitionDirection < 0 ? -18 : 0;
  const enterScale = transitionDirection === 0 ? 0.985 : 0.99;

  return (
    <AstryxStack direction="vertical" className="flex h-full min-h-0 flex-col bg-muted/25">
      <AstryxStack
        direction="horizontal"
        className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/90 px-2"
      >
        <AstryxStack direction="horizontal" className="flex min-w-0 items-center gap-1">
          <ImagePreviewToolButton
            label={t("workspaceFilePreview.previousImage")}
            disabled={!canOpenPrevious || isSwitchingImage}
            onClick={() => openImageAt(activeImageIndex - 1)}
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </ImagePreviewToolButton>
          <ImagePreviewToolButton
            label={t("workspaceFilePreview.nextImage")}
            disabled={!canOpenNext || isSwitchingImage}
            onClick={() => openImageAt(activeImageIndex + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </ImagePreviewToolButton>
          <AstryxText
            as="span"
            type="inherit"
            className="ml-1 shrink-0 text-[11px] text-muted-foreground"
          >
            {counter}
          </AstryxText>
        </AstryxStack>
        <AstryxStack direction="horizontal" className="flex shrink-0 items-center gap-1">
          <ImagePreviewToolButton
            label={t("workspaceFilePreview.zoomOut")}
            disabled={!canZoomOut}
            onClick={() =>
              setScale((current) => clampImageScale(current - IMAGE_PREVIEW_SCALE_STEP))
            }
          >
            <Minus className="h-4 w-4" />
          </ImagePreviewToolButton>
          <AstryxText
            as="span"
            type="inherit"
            className="w-11 text-center text-[11px] tabular-nums text-muted-foreground"
          >
            {Math.round(scale * 100)}%
          </AstryxText>
          <ImagePreviewToolButton
            label={t("workspaceFilePreview.zoomIn")}
            disabled={!canZoomIn}
            onClick={() =>
              setScale((current) => clampImageScale(current + IMAGE_PREVIEW_SCALE_STEP))
            }
          >
            <Plus className="h-4 w-4" />
          </ImagePreviewToolButton>
          <ImagePreviewToolButton
            label={t("workspaceFilePreview.rotateImage")}
            onClick={() => setRotation((current) => normalizeRotation(current + 90))}
          >
            <RotateCwSquare className="h-4 w-4" />
          </ImagePreviewToolButton>
          <ImagePreviewToolButton
            label={t("workspaceEditor.save")}
            disabled={!canSaveRotation || rotation === 0 || saving}
            onClick={() => {
              setSaving(true);
              void onSaveRotation(rotation).finally(() => setSaving(false));
            }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </ImagePreviewToolButton>
        </AstryxStack>
      </AstryxStack>
      <AstryxStack
        direction="vertical"
        className={cn(
          "relative min-h-0 flex-1",
          isClippingEnterOverflow ? "overflow-x-hidden overflow-y-auto" : "overflow-auto",
        )}
        onWheel={(event) => {
          if (event.deltaY === 0) return;
          event.preventDefault();
          const direction = event.deltaY < 0 ? 1 : -1;
          setScale((current) =>
            clampImageScale(current + direction * IMAGE_PREVIEW_WHEEL_SCALE_STEP),
          );
        }}
      >
        {isSwitchingImage ? (
          <AstryxStack
            direction="horizontal"
            className="pointer-events-none absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/85 text-muted-foreground shadow-sm backdrop-blur"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
          </AstryxStack>
        ) : null}
        <AstryxStack
          direction="horizontal"
          className="flex h-full min-h-full w-full min-w-full items-center justify-center p-4 transition-[opacity,transform,filter] duration-200 ease-out motion-reduce:transition-none sm:p-6"
          style={{
            filter: isEntering ? "blur(1px)" : "blur(0px)",
            opacity: isEntering ? 0 : 1,
            transform: isEntering
              ? `translateX(${enterTranslateX}px) scale(${enterScale})`
              : "translateX(0) scale(1)",
          }}
        >
          <AstryxStack
            direction="horizontal"
            className="flex shrink-0 items-center justify-center"
            style={{
              height: `${scale * 100}%`,
              width: `${scale * 100}%`,
            }}
          >
            <img
              className="h-full w-full select-none object-contain"
              src={preview.blobUrl}
              alt={basename(preview.path)}
              draggable={false}
              style={{
                transform: `rotate(${rotation}deg)`,
                transformOrigin: "center",
                transition: "transform 120ms ease-out",
              }}
            />
          </AstryxStack>
        </AstryxStack>
      </AstryxStack>
    </AstryxStack>
  );
}
