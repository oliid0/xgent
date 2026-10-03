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
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text as AstryxText, Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { renderAsync } from "docx-preview";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocale } from "../../i18n";
import { cn } from "../../lib/shared/utils";
import { writeClipboardText } from "../../lib/system/clipboardText";
import { invokeFs } from "../../lib/tools/fsBackend";
import { type FileTypeIconComponent, getFileTypeIcon } from "../chat/fileTypeIcons";
import {
  Check,
  ChevronRight,
  Copy,
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
import {
  boundedAnnotationText,
  DOCUMENT_ANNOTATION_MAX_LENGTH,
  DOCUMENT_ANNOTATION_MAX_PAGE,
  documentAnnotationFormat,
  remainingAnnotationDraft,
} from "./documentAnnotationDraft";
import { annotateDocument } from "./documentAnnotations";
import { OpenWithMenu } from "./OpenWithMenu";
import { previewDraftKey, previewDrafts, previewPendingWrites } from "./previewDrafts";
import { WorkspaceMarkdownPreview } from "./WorkspaceMarkdownPreview";
import { WorkspacePdfPreview } from "./WorkspacePdfPreview";
import { WorkspacePresentationPreview } from "./WorkspacePresentationPreview";
import { buildSandboxedHtmlPreviewSource } from "./workspaceHtmlPreview";
import {
  hasImageRotationDraft,
  type ImageRotationDraft,
  imageRotationFormat,
  normalizeImageRotation,
  remainingImageRotation,
  rotateWorkspaceImage,
  workspaceImagePaths,
} from "./workspaceImageOperations";
import {
  getWorkspacePreviewKind,
  isWorkspaceEditablePreviewPath,
  type WorkspacePreviewKind,
} from "./workspaceImagePreview";
import {
  boundedSpreadsheetText,
  buildSpreadsheetTable,
  spreadsheetHasEdits as hasSpreadsheetChanges,
  remainingSpreadsheetEdits,
  SPREADSHEET_MAX_CELL_LENGTH,
  type SpreadsheetTable,
  writeSpreadsheetEdits,
} from "./workspaceSpreadsheet";
export type WorkspaceFilePreviewOpenRequest = {
  id: number;
  ownerId?: string;
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

const FILE_PREVIEW_OVERLAY_ANIMATION_MS = 180;

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
  if (mimeKind) return mimeKind;
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
  const requestRef = useRef<WorkspaceFilePreviewOpenRequest | null>(null);
  const mountedRef = useRef(false);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const annotationSaveToken = useRef<object | null>(null);
  const spreadsheetSaveToken = useRef<object | null>(null);
  const imageSaveToken = useRef<object | null>(null);
  const sourceSaveToken = useRef<object | null>(null);
  const sourceCopyToken = useRef<object | null>(null);
  const sourceCopyTimeout = useRef<number | null>(null);
  const [pendingImageNavigation, setPendingImageNavigationState] = useState<{
    path: string;
    direction: ImagePreviewTransitionDirection;
  } | null>(null);
  const pendingImageNavigationRef = useRef(pendingImageNavigation);
  const setPendingImageNavigation = useCallback(
    (next: { path: string; direction: ImagePreviewTransitionDirection } | null) => {
      pendingImageNavigationRef.current = next;
      setPendingImageNavigationState(next);
    },
    [],
  );
  const [imageRotation, setImageRotationState] = useState<ImageRotationDraft>({
    angle: 0,
    saved: 0,
    editable: false,
  });
  const imageRotationRef = useRef(imageRotation);
  const setImageRotation = useCallback((next: ImageRotationDraft) => {
    imageRotationRef.current = next;
    setImageRotationState(next);
  }, []);
  const [preview, setPreview] = useState<LoadedPreview | null>(null);
  const [activeRequest, setActiveRequest] = useState<WorkspaceFilePreviewOpenRequest | null>(null);
  const [imageTransitionDirection, setImageTransitionDirection] =
    useState<ImagePreviewTransitionDirection>(0);
  const [activeSheetName, setActiveSheetNameState] = useState("");
  const activeSheetNameRef = useRef("");
  const setActiveSheetName = useCallback((next: string) => {
    activeSheetNameRef.current = next;
    setActiveSheetNameState(next);
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [sourceCopied, setSourceCopied] = useState(false);
  const [sourceDraft, setSourceDraftState] = useState("");
  const sourceDraftRef = useRef("");
  const setSourceDraft = useCallback((next: string) => {
    sourceDraftRef.current = next;
    setSourceDraftState(next);
  }, []);
  const [sourceSaved, setSourceSavedState] = useState("");
  const sourceSavedRef = useRef("");
  const setSourceSaved = useCallback((next: string) => {
    sourceSavedRef.current = next;
    setSourceSavedState(next);
  }, []);
  const [sourceSaving, setSourceSavingState] = useState(false);
  const sourceSavingRef = useRef(false);
  const setSourceSaving = useCallback((next: boolean) => {
    sourceSavingRef.current = next;
    setSourceSavingState(next);
  }, []);
  const [annotationDraft, setAnnotationDraftState] = useState("");
  const annotationDraftRef = useRef("");
  const setAnnotationDraft = useCallback((next: string) => {
    annotationDraftRef.current = next;
    setAnnotationDraftState(next);
  }, []);
  const [annotationPage, setAnnotationPageState] = useState(1);
  const annotationPageRef = useRef(1);
  const setAnnotationPage = useCallback((next: number) => {
    annotationPageRef.current = next;
    setAnnotationPageState(next);
  }, []);
  const [annotationSaved, setAnnotationSaved] = useState("");
  const [spreadsheetEdits, setSpreadsheetEditsState] = useState<
    Record<string, Record<string, string>>
  >({});
  const spreadsheetEditsRef = useRef<Record<string, Record<string, string>>>({});
  const setSpreadsheetEdits = useCallback((next: Record<string, Record<string, string>>) => {
    spreadsheetEditsRef.current = next;
    setSpreadsheetEditsState(next);
  }, []);
  const [activeTab, setActiveTab] = useState<"preview" | "source" | "annotations">("preview");
  const [isVisible, setIsVisible] = useState(false);
  const dirty =
    sourceDraft !== sourceSaved ||
    annotationDraft !== annotationSaved ||
    Object.values(spreadsheetEdits).some((edits) => Object.keys(edits).length > 0) ||
    hasImageRotationDraft(imageRotation);
  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props.onDirtyChange]);

  const replacePreview = useCallback((next: LoadedPreview | null) => {
    sourceCopyToken.current = null;
    if (sourceCopyTimeout.current !== null) window.clearTimeout(sourceCopyTimeout.current);
    sourceCopyTimeout.current = null;
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
    setImageRotation({
      angle: 0,
      saved: 0,
      editable: !!next && !!imageRotationFormat(next.path, next.mimeType),
    });
    setAnnotationDraft("");
    setAnnotationSaved("");
    setAnnotationPage(1);
    setPreview(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadSequenceRef.current++;
      sourceCopyToken.current = null;
      if (sourceCopyTimeout.current !== null) window.clearTimeout(sourceCopyTimeout.current);
      if (previewBlobUrlRef.current) {
        URL.revokeObjectURL(previewBlobUrlRef.current);
        previewBlobUrlRef.current = null;
      }
      previewRef.current = null;
    };
  }, []);

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
      requestRef.current = request;
      annotationSaveToken.current = null;
      spreadsheetSaveToken.current = null;
      imageSaveToken.current = null;
      sourceSaveToken.current = null;
      setPendingImageNavigation(null);
      setSourceSaving(false);
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
        await previewPendingWrites.get(previewDraftKey(request));
        if (!mountedRef.current || loadSequenceRef.current !== sequence) return;
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
        const draft = previewDrafts.get(previewDraftKey(request));
        replacePreview(loaded);
        if (draft) {
          setSourceDraft(draft.source);
          setSourceSaved(draft.savedSource);
          setAnnotationDraft(draft.annotation);
          setAnnotationPage(draft.annotationPage);
          setSpreadsheetEdits(draft.cells);
          if (draft.rotation) setImageRotation(draft.rotation);
          if (draft.contentHash !== loaded.contentHash) {
            // Retain the original version guard; saves must reject external modifications.
            loaded.contentHash = draft.contentHash;
            loaded.mtimeMs = draft.mtimeMs;
            setError(
              "The file changed outside this editor. Your draft is retained; copy it before reloading to discard it.",
            );
          }
        }
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
    if (!activeSheetNameRef.current) setActiveSheetName(spreadsheet.activeSheetName);
  }, [spreadsheet?.activeSheetName]);

  const activePreviewRequest = activeRequest ?? openRequest;
  const activePath = preview?.path ?? activePreviewRequest?.path ?? "";
  const kind = preview?.kind ?? (activePath ? getWorkspacePreviewKind(activePath) : null) ?? "text";
  const PreviewIcon = getPreviewIcon(kind);
  const imagePaths = useMemo(
    () =>
      kind === "image" ? workspaceImagePaths(activePreviewRequest?.imagePaths, activePath) : [],
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
  const annotationFormat = preview ? documentAnnotationFormat(activePath, preview.mimeType) : null;
  const canAnnotate = annotationFormat !== null;
  const canEditSpreadsheet =
    preview?.kind === "spreadsheet" && activePath.toLowerCase().endsWith(".xlsx");
  const spreadsheetHasEdits = Object.values(spreadsheetEdits).some(
    (sheet) => Object.keys(sheet).length > 0,
  );

  const editSpreadsheetCell = useCallback(
    (sheetName: string, row: number, column: number, value: string) => {
      if (
        !mountedRef.current ||
        !openRef.current ||
        !preview ||
        previewRef.current !== preview ||
        !activePreviewRequest ||
        requestRef.current !== activePreviewRequest ||
        !canEditSpreadsheet ||
        !spreadsheet ||
        sheetName !== spreadsheet.activeSheetName ||
        sheetName !== (activeSheetNameRef.current || spreadsheet.activeSheetName) ||
        !Number.isInteger(row) ||
        !Number.isInteger(column) ||
        row < 0 ||
        column < 0 ||
        !spreadsheet.rows[row]?.cells[column] ||
        typeof value !== "string"
      )
        return;
      value = boundedSpreadsheetText(value);
      const next = { ...spreadsheetEditsRef.current };
      const cells = { ...next[sheetName] };
      const key = previewDraftKey(activePreviewRequest);
      // Returning to the old disk value while a save is pending is a new edit.
      if (value === spreadsheet.rows[row].cells[column].value && !previewPendingWrites.has(key))
        delete cells[`${row}:${column}`];
      else cells[`${row}:${column}`] = value;
      if (Object.keys(cells).length) next[sheetName] = cells;
      else delete next[sheetName];
      setSpreadsheetEdits(next);
      const cached = previewDrafts.get(key);
      if (!hasSpreadsheetChanges(next)) previewDrafts.delete(key);
      else
        previewDrafts.set(key, {
          ...cached,
          contentHash: preview.contentHash,
          mtimeMs: preview.mtimeMs,
          source: cached?.source ?? "",
          savedSource: cached?.savedSource ?? "",
          annotation: cached?.annotation ?? "",
          annotationPage: cached?.annotationPage ?? 1,
          cells: next,
        });
    },
    [preview, activePreviewRequest, canEditSpreadsheet, spreadsheet, setSpreadsheetEdits],
  );

  const selectSpreadsheetSheet = useCallback(
    (next: string) => {
      if (
        !mountedRef.current ||
        !openRef.current ||
        previewRef.current !== preview ||
        requestRef.current !== activePreviewRequest ||
        !spreadsheet?.sheetNames.includes(next)
      )
        return;
      setActiveSheetName(next);
    },
    [preview, activePreviewRequest, spreadsheet, setActiveSheetName],
  );

  const editAnnotation = useCallback(
    (text: string, page: number) => {
      if (
        !mountedRef.current ||
        !openRef.current ||
        !preview ||
        previewRef.current !== preview ||
        !activePreviewRequest ||
        requestRef.current !== activePreviewRequest
      )
        return;
      setAnnotationDraft(text);
      setAnnotationPage(page);
      const key = previewDraftKey(activePreviewRequest);
      const cached = previewDrafts.get(key);
      if (!text) previewDrafts.delete(key);
      else
        previewDrafts.set(key, {
          ...cached,
          contentHash: preview.contentHash,
          mtimeMs: preview.mtimeMs,
          source: cached?.source ?? preview.text ?? "",
          savedSource: cached?.savedSource ?? preview.text ?? "",
          cells: cached?.cells ?? {},
          annotation: text,
          annotationPage: page,
        });
    },
    [preview, activePreviewRequest, setAnnotationDraft, setAnnotationPage],
  );

  useEffect(() => {
    if (!preview || !activePreviewRequest || loading) return;
    const key = previewDraftKey(activePreviewRequest);
    if (!dirty && !previewPendingWrites.has(key)) {
      previewDrafts.delete(key);
      return;
    }
    previewDrafts.set(key, {
      contentHash: preview.contentHash,
      mtimeMs: preview.mtimeMs,
      source: sourceDraft,
      savedSource: sourceSaved,
      annotation: annotationDraft,
      annotationPage,
      cells: spreadsheetEdits,
      rotation: imageRotation,
    });
  }, [
    preview,
    activePreviewRequest,
    loading,
    dirty,
    sourceDraft,
    sourceSaved,
    annotationDraft,
    annotationPage,
    spreadsheetEdits,
    imageRotation,
  ]);

  const copyPreviewSource = useCallback(async () => {
    if (
      !mountedRef.current ||
      !openRef.current ||
      loading ||
      !preview ||
      preview.text === null ||
      previewRef.current !== preview ||
      requestRef.current !== activePreviewRequest
    )
      return;
    const sequence = loadSequenceRef.current;
    const token = {};
    sourceCopyToken.current = token;
    const current = () =>
      mountedRef.current &&
      openRef.current &&
      loadSequenceRef.current === sequence &&
      sourceCopyToken.current === token;
    const copied = await writeClipboardText(sourceDraftRef.current);
    if (!current()) return;
    if (copied) {
      setSourceCopied(true);
      if (sourceCopyTimeout.current !== null) window.clearTimeout(sourceCopyTimeout.current);
      sourceCopyTimeout.current = window.setTimeout(() => {
        sourceCopyTimeout.current = null;
        if (current()) setSourceCopied(false);
      }, 1600);
    } else {
      setError(t("workspaceFilePreview.copyFailed"));
    }
  }, [preview, activePreviewRequest, loading, t]);

  const editSource = useCallback(
    (value: string) => {
      if (
        !mountedRef.current ||
        !openRef.current ||
        loading ||
        !preview ||
        previewRef.current !== preview ||
        !activePreviewRequest ||
        requestRef.current !== activePreviewRequest ||
        !canShowSource ||
        typeof value !== "string"
      )
        return;
      setSourceDraft(value);
      const key = previewDraftKey(activePreviewRequest);
      const cached = previewDrafts.get(key);
      if (value === sourceSavedRef.current && !previewPendingWrites.has(key))
        previewDrafts.delete(key);
      else
        previewDrafts.set(key, {
          ...cached,
          contentHash: preview.contentHash,
          mtimeMs: preview.mtimeMs,
          source: value,
          savedSource: sourceSavedRef.current,
          annotation: cached?.annotation ?? "",
          annotationPage: cached?.annotationPage ?? 1,
          cells: cached?.cells ?? {},
        });
    },
    [preview, activePreviewRequest, canShowSource, loading, setSourceDraft],
  );

  const saveSource = useCallback(async (): Promise<boolean> => {
    const snapshot = previewRef.current;
    const request = requestRef.current;
    const written = sourceDraftRef.current;
    if (
      !mountedRef.current ||
      !openRef.current ||
      snapshot !== preview ||
      request !== activePreviewRequest ||
      !request ||
      !snapshot ||
      !canShowSource ||
      loading ||
      written === sourceSavedRef.current ||
      sourceSavingRef.current
    )
      return false;
    const key = previewDraftKey(request);
    if (previewPendingWrites.has(key)) return false;
    const sequence = loadSequenceRef.current;
    const current = () =>
      mountedRef.current &&
      openRef.current &&
      loadSequenceRef.current === sequence &&
      previewRef.current === snapshot;
    const token = {};
    sourceSaveToken.current = token;
    let finish = () => {};
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    previewPendingWrites.set(key, completion);
    setSourceSaving(true);
    setError(null);
    let acknowledgement: { mtimeMs: number; contentHash: string } | null = null;
    try {
      const document =
        snapshot.kind === "document" && snapshot.path.toLowerCase().endsWith(".docx");
      const response = await invokeFs<{
        mtimeMs: number;
        contentHash: string;
        bytesWritten: number;
      }>(document ? "fs_write_docx_text" : "fs_write_text", {
        workdir: request.workdir,
        path: snapshot.path,
        content: written,
        ...(document ? {} : { mode: "rewrite" }),
        expected_mtime_ms: snapshot.mtimeMs,
        expected_content_hash: snapshot.contentHash,
      });
      acknowledgement = response;
      const cached = previewDrafts.get(key);
      if (cached) {
        if (cached.source === written) previewDrafts.delete(key);
        else
          previewDrafts.set(key, {
            ...cached,
            savedSource: written,
            mtimeMs: response.mtimeMs,
            contentHash: response.contentHash,
          });
      }
      if (!current()) return false;
      let bytes = document ? snapshot.bytes : new TextEncoder().encode(written);
      let mimeType = snapshot.mimeType;
      if (document) {
        try {
          const refreshed = await invokeFs<ReadWorkspacePreviewResponse>(
            "fs_read_workspace_image",
            {
              workdir: request.workdir,
              path: snapshot.path,
            },
          );
          if (!current()) return false;
          if (refreshed.contentHash !== response.contentHash)
            throw new Error(t("workspaceEditor.conflictMessage"));
          setRenderError(null);
          bytes = base64ToBytes(refreshed.data);
          mimeType = refreshed.mimeType;
        } catch (refreshError) {
          if (current())
            setRenderError(toMessage(refreshError, t("workspaceFilePreview.openFailed")));
        }
      }
      if (!current()) return false;
      const blobBytes =
        snapshot.kind === "html"
          ? new TextEncoder().encode(buildSandboxedHtmlPreviewSource(written))
          : bytes;
      const next = {
        ...snapshot,
        text: written,
        bytes,
        data: bytesToBase64(bytes),
        mimeType,
        mtimeMs: response.mtimeMs,
        contentHash: response.contentHash,
        sizeBytes: response.bytesWritten,
        blobUrl: URL.createObjectURL(new Blob([bytesToArrayBuffer(blobBytes)], { type: mimeType })),
      };
      if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = next.blobUrl;
      previewRef.current = next;
      setPreview(next);
      setSourceSaved(written);
      return sourceDraftRef.current === written;
    } catch (saveError) {
      if (current()) setError(toMessage(saveError, t("workspaceEditor.saveFailed")));
      return false;
    } finally {
      const cached = previewDrafts.get(key);
      if (acknowledgement && cached) {
        // Inputs can arrive during DOCX preview refresh after the write acknowledgement.
        if (cached.source === written) previewDrafts.delete(key);
        else previewDrafts.set(key, { ...cached, ...acknowledgement, savedSource: written });
      }
      previewPendingWrites.delete(key);
      finish();
      if (sourceSaveToken.current === token) {
        sourceSaveToken.current = null;
        if (mountedRef.current) setSourceSaving(false);
      }
    }
  }, [activePreviewRequest, canShowSource, loading, preview, setSourceSaved, setSourceSaving, t]);

  const saveSpreadsheet = useCallback(async () => {
    const snapshot = previewRef.current;
    const request = requestRef.current;
    const written = spreadsheetEditsRef.current;
    if (
      !mountedRef.current ||
      !openRef.current ||
      snapshot !== preview ||
      request !== activePreviewRequest ||
      !request ||
      !snapshot ||
      !canEditSpreadsheet ||
      !hasSpreadsheetChanges(written) ||
      sourceSavingRef.current
    )
      return;
    const key = previewDraftKey(request);
    if (previewPendingWrites.has(key)) return;
    const sequence = loadSequenceRef.current;
    const current = () =>
      mountedRef.current &&
      openRef.current &&
      loadSequenceRef.current === sequence &&
      previewRef.current === snapshot;
    const token = {};
    spreadsheetSaveToken.current = token;
    let finish = () => {};
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    previewPendingWrites.set(key, completion);
    setSourceSaving(true);
    setError(null);
    try {
      const output = await writeSpreadsheetEdits(snapshot.bytes, written);
      const response = await invokeFs<{
        mtimeMs: number;
        contentHash: string;
        bytesWritten: number;
      }>("fs_write_binary", {
        workdir: request.workdir,
        path: snapshot.path,
        content_base64: bytesToBase64(output),
        expected_mtime_ms: snapshot.mtimeMs,
        expected_content_hash: snapshot.contentHash,
      });
      const cached = previewDrafts.get(key);
      if (cached) {
        const remaining = remainingSpreadsheetEdits(cached.cells, written);
        if (!hasSpreadsheetChanges(remaining)) previewDrafts.delete(key);
        else
          previewDrafts.set(key, {
            ...cached,
            cells: remaining,
            mtimeMs: response.mtimeMs,
            contentHash: response.contentHash,
          });
      }
      if (!current()) return;
      const remaining = remainingSpreadsheetEdits(spreadsheetEditsRef.current, written);
      const next = {
        ...snapshot,
        bytes: output,
        data: bytesToBase64(output),
        mtimeMs: response.mtimeMs,
        contentHash: response.contentHash,
        sizeBytes: response.bytesWritten,
        blobUrl: URL.createObjectURL(
          new Blob([bytesToArrayBuffer(output)], { type: snapshot.mimeType }),
        ),
      };
      if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = next.blobUrl;
      previewRef.current = next;
      setPreview(next);
      setSpreadsheetEdits(remaining);
    } catch (saveError) {
      if (current()) setError(toMessage(saveError, t("workspaceEditor.saveFailed")));
    } finally {
      previewPendingWrites.delete(key);
      finish();
      if (spreadsheetSaveToken.current === token) {
        spreadsheetSaveToken.current = null;
        if (mountedRef.current) setSourceSaving(false);
      }
    }
  }, [preview, activePreviewRequest, canEditSpreadsheet, setSpreadsheetEdits, setSourceSaving, t]);

  const saveAnnotations = useCallback(async () => {
    const snapshot = previewRef.current;
    const request = requestRef.current;
    const format = snapshot ? documentAnnotationFormat(snapshot.path, snapshot.mimeType) : null;
    const written = { text: annotationDraftRef.current, page: annotationPageRef.current };
    if (
      !mountedRef.current ||
      !openRef.current ||
      snapshot !== preview ||
      request !== activePreviewRequest ||
      !snapshot ||
      !request ||
      !format ||
      !written.text.trim() ||
      sourceSavingRef.current
    )
      return;
    const key = previewDraftKey(request);
    if (previewPendingWrites.has(key)) return;
    const sequence = loadSequenceRef.current;
    const current = () =>
      mountedRef.current &&
      openRef.current &&
      loadSequenceRef.current === sequence &&
      previewRef.current === snapshot;
    const token = {};
    annotationSaveToken.current = token;
    let finish = () => {};
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    previewPendingWrites.set(key, completion);
    setSourceSaving(true);
    setError(null);
    try {
      const output = await annotateDocument(snapshot.bytes, format, written.page, written.text);
      const response = await invokeFs<{
        mtimeMs: number;
        contentHash: string;
        bytesWritten: number;
      }>("fs_write_binary", {
        workdir: request.workdir,
        path: snapshot.path,
        content_base64: bytesToBase64(output),
        expected_mtime_ms: snapshot.mtimeMs,
        expected_content_hash: snapshot.contentHash,
      });
      const cached = previewDrafts.get(key);
      if (cached) {
        const remaining = remainingAnnotationDraft(
          { text: cached.annotation, page: cached.annotationPage },
          written,
        )!;
        if (!remaining.text) previewDrafts.delete(key);
        else
          previewDrafts.set(key, {
            ...cached,
            annotation: remaining.text,
            annotationPage: remaining.page,
            mtimeMs: response.mtimeMs,
            contentHash: response.contentHash,
          });
      }
      if (!current()) return;
      const remaining = remainingAnnotationDraft(
        { text: annotationDraftRef.current, page: annotationPageRef.current },
        written,
      )!;
      const next = {
        ...snapshot,
        bytes: output,
        data: bytesToBase64(output),
        mtimeMs: response.mtimeMs,
        contentHash: response.contentHash,
        sizeBytes: response.bytesWritten,
        blobUrl: URL.createObjectURL(
          new Blob([bytesToArrayBuffer(output)], { type: snapshot.mimeType }),
        ),
      };
      if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = next.blobUrl;
      previewRef.current = next;
      setPreview(next);
      setAnnotationDraft(remaining.text);
      setAnnotationPage(remaining.page);
      setAnnotationSaved("");
    } catch (saveError) {
      if (current()) setError(toMessage(saveError, t("workspaceEditor.saveFailed")));
    } finally {
      previewPendingWrites.delete(key);
      finish();
      if (annotationSaveToken.current === token) {
        annotationSaveToken.current = null;
        if (mountedRef.current) setSourceSaving(false);
      }
    }
  }, [preview, activePreviewRequest, setAnnotationDraft, setAnnotationPage, setSourceSaving, t]);

  const editImageRotation = useCallback(() => {
    if (
      !mountedRef.current ||
      !openRef.current ||
      loading ||
      !preview ||
      preview.kind !== "image" ||
      previewRef.current !== preview ||
      !activePreviewRequest ||
      requestRef.current !== activePreviewRequest
    )
      return;
    const next = {
      ...imageRotationRef.current,
      angle: normalizeImageRotation(imageRotationRef.current.angle + 90),
    };
    setImageRotation(next);
    if (!next.editable) return;
    const key = previewDraftKey(activePreviewRequest);
    if (!hasImageRotationDraft(next) && !previewPendingWrites.has(key)) previewDrafts.delete(key);
    else
      previewDrafts.set(key, {
        contentHash: preview.contentHash,
        mtimeMs: preview.mtimeMs,
        source: "",
        savedSource: "",
        annotation: "",
        annotationPage: 1,
        cells: {},
        rotation: next,
      });
  }, [preview, activePreviewRequest, loading, setImageRotation]);

  const saveImageRotation = useCallback(async (): Promise<boolean> => {
    const snapshot = previewRef.current;
    const request = requestRef.current;
    const written = imageRotationRef.current;
    const format = snapshot ? imageRotationFormat(snapshot.path, snapshot.mimeType) : null;
    if (
      !mountedRef.current ||
      !openRef.current ||
      previewRef.current !== preview ||
      requestRef.current !== activePreviewRequest ||
      !activePreviewRequest ||
      !preview ||
      preview.kind !== "image" ||
      sourceSavingRef.current ||
      loading ||
      !snapshot ||
      !request ||
      !format ||
      !hasImageRotationDraft(written)
    )
      return false;
    const key = previewDraftKey(request);
    if (previewPendingWrites.has(key)) return false;
    const sequence = loadSequenceRef.current;
    const current = () =>
      mountedRef.current &&
      openRef.current &&
      loadSequenceRef.current === sequence &&
      previewRef.current === snapshot;
    const token = {};
    imageSaveToken.current = token;
    let finish = () => {};
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    previewPendingWrites.set(key, completion);
    setSourceSaving(true);
    setError(null);
    try {
      const output = await rotateWorkspaceImage(
        snapshot.bytes,
        format,
        normalizeImageRotation(written.angle - written.saved),
      );
      const response = await invokeFs<{
        mtimeMs: number;
        contentHash: string;
        bytesWritten: number;
      }>("fs_write_binary", {
        workdir: request.workdir,
        path: snapshot.path,
        content_base64: bytesToBase64(output),
        expected_mtime_ms: snapshot.mtimeMs,
        expected_content_hash: snapshot.contentHash,
      });
      const cached = previewDrafts.get(key);
      if (cached) {
        const remaining = remainingImageRotation(cached.rotation, written);
        if (!hasImageRotationDraft(remaining)) previewDrafts.delete(key);
        else
          previewDrafts.set(key, {
            ...cached,
            rotation: remaining,
            mtimeMs: response.mtimeMs,
            contentHash: response.contentHash,
          });
      }
      if (!current()) return false;
      const next = {
        ...snapshot,
        bytes: output,
        data: bytesToBase64(output),
        mtimeMs: response.mtimeMs,
        contentHash: response.contentHash,
        sizeBytes: response.bytesWritten,
        blobUrl: URL.createObjectURL(
          new Blob([bytesToArrayBuffer(output)], { type: snapshot.mimeType }),
        ),
      };
      if (previewBlobUrlRef.current) URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = next.blobUrl;
      previewRef.current = next;
      setPreview(next);
      const remaining = remainingImageRotation(imageRotationRef.current, written)!;
      setImageRotation(remaining);
      return !hasImageRotationDraft(remaining);
    } catch (saveError) {
      if (current()) setError(toMessage(saveError, t("workspaceEditor.saveFailed")));
      return false;
    } finally {
      previewPendingWrites.delete(key);
      finish();
      if (imageSaveToken.current === token) {
        imageSaveToken.current = null;
        if (mountedRef.current) setSourceSaving(false);
      }
    }
  }, [activePreviewRequest, preview, loading, setImageRotation, setSourceSaving, t]);

  const openImagePath = useCallback(
    (path: string, transitionDirection: ImagePreviewTransitionDirection = 0) => {
      if (
        !mountedRef.current ||
        !openRef.current ||
        requestRef.current !== activePreviewRequest ||
        previewRef.current !== preview ||
        !activePreviewRequest ||
        sourceSavingRef.current ||
        loading ||
        !imagePaths.includes(path) ||
        path === activePath
      )
        return;
      if (hasImageRotationDraft(imageRotationRef.current)) {
        setPendingImageNavigation({ path, direction: transitionDirection });
        return;
      }
      void loadPreview({ ...activePreviewRequest, path, imagePaths }, transitionDirection);
    },
    [activePath, activePreviewRequest, preview, imagePaths, loading, loadPreview, t],
  );

  const confirmImageNavigation = async (mode: "save" | "discard" | "cancel") => {
    const pending = pendingImageNavigation;
    const request = activePreviewRequest;
    if (pending !== pendingImageNavigationRef.current || request !== requestRef.current) return;
    if (!pending || !request || sourceSavingRef.current || !mountedRef.current || !openRef.current)
      return;
    if (mode === "cancel") {
      setPendingImageNavigation(null);
      return;
    }
    if (
      mode === "save" &&
      hasImageRotationDraft(imageRotationRef.current) &&
      !(await saveImageRotation())
    )
      return;
    if (
      !mountedRef.current ||
      !openRef.current ||
      requestRef.current !== request ||
      pendingImageNavigationRef.current !== pending
    )
      return;
    if (mode === "discard") previewDrafts.delete(previewDraftKey(request));
    setPendingImageNavigation(null);
    await loadPreview({ ...request, path: pending.path, imagePaths }, pending.direction);
  };

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
        backgroundColor: "var(--color-background-surface)",
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
                    {canOpenExternal && activePreviewRequest ? (
                      <OpenWithMenu
                        workdir={activePreviewRequest.workdir}
                        path={activePath || activePreviewRequest.path}
                        onError={setError}
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
                      onClick={() => {
                        if (
                          !activePreviewRequest ||
                          (dirty && !window.confirm("Discard unsaved edits and reload the file?"))
                        )
                          return;
                        previewDrafts.delete(previewDraftKey(activePreviewRequest));
                        void loadPreview(activePreviewRequest, 0);
                      }}
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
                    {canAnnotate ? (
                      <Tab value="annotations" label={t("workspaceFilePreview.annotations")} />
                    ) : null}
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
                      {t(
                        annotationFormat === "pdf"
                          ? "workspaceFilePreview.pdfAnnotationHelp"
                          : "workspaceFilePreview.slideAnnotationHelp",
                      )}
                    </Text>
                    <NumberInput
                      label={t("workspaceFilePreview.annotationPage")}
                      min={1}
                      max={DOCUMENT_ANNOTATION_MAX_PAGE}
                      step={1}
                      isIntegerOnly
                      isWheelEnabled={false}
                      value={annotationPage}
                      onChange={(page) => editAnnotation(annotationDraftRef.current, page)}
                    />
                    <TextArea
                      label={t("workspaceFilePreview.annotations")}
                      isLabelHidden
                      value={annotationDraft}
                      onChange={(value) =>
                        editAnnotation(boundedAnnotationText(value), annotationPageRef.current)
                      }
                      rows={30}
                      width="100%"
                      className="h-full min-h-0 text-sm"
                    />
                    <Text type="supporting" color="secondary">
                      {annotationDraft.length} / {DOCUMENT_ANNOTATION_MAX_LENGTH}
                    </Text>
                  </VStack>
                ) : preview && activeTab === "source" && preview.text !== null ? (
                  <VStack height="100%" minHeight={0} padding={3}>
                    <TextArea
                      label={`${basename(activePath)} · ${previewLanguage(activePath, preview.kind)}`}
                      isLabelHidden
                      value={sourceDraft}
                      onChange={editSource}
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
                    onActiveSheetNameChange={selectSpreadsheetSheet}
                    spreadsheetEdits={spreadsheetEdits}
                    spreadsheetEditable={canEditSpreadsheet}
                    onSpreadsheetCellChange={editSpreadsheetCell}
                    onSaveImageRotation={saveImageRotation}
                    imageRotation={imageRotation}
                    onRotateImage={editImageRotation}
                    imageSaving={sourceSaving}
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
            {pendingImageNavigation ? (
              <VStack
                gap={2}
                width="100%"
                role="group"
                aria-label={t("workspaceFilePreview.switchImageTitle")}
              >
                <Heading level={3}>{t("workspaceFilePreview.switchImageTitle")}</Heading>
                <Text>{t("workspaceFilePreview.switchImageDescription")}</Text>
                <HStack gap={2} className="flex-wrap">
                  <AstryxButton
                    label={t("workspaceEditor.save")}
                    isDisabled={sourceSaving}
                    onClick={() => void confirmImageNavigation("save")}
                  />
                  <AstryxButton
                    label={t("workspaceEditor.discard")}
                    variant="destructive"
                    isDisabled={sourceSaving}
                    onClick={() => void confirmImageNavigation("discard")}
                  />
                  <AstryxButton
                    label={t("workspaceEditor.cancel")}
                    variant="ghost"
                    isDisabled={sourceSaving}
                    onClick={() => void confirmImageNavigation("cancel")}
                  />
                </HStack>
              </VStack>
            ) : null}
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
  onSaveImageRotation: () => Promise<boolean>;
  imageRotation: ImageRotationDraft;
  onRotateImage: () => void;
  imageSaving: boolean;
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
    imageRotation,
    onRotateImage,
    imageSaving,
    onRenderError,
  } = props;
  const { t } = useLocale();
  const docxContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (preview.kind !== "document") return;
    const container = docxContainerRef.current;
    if (!container) return;
    let cancelled = false;
    const surface = document.createElement("div");
    container.replaceChildren(surface);
    onRenderError(null);
    void renderAsync(bytesToArrayBuffer(preview.bytes), surface, undefined, {
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
      surface.remove();
    };
  }, [onRenderError, preview, t]);

  if (preview.kind === "image") {
    return (
      <WorkspaceImagePreviewBody
        key={preview.path}
        activePath={activePath}
        imagePaths={imagePaths}
        transitionDirection={imageTransitionDirection}
        isSwitchingImage={isSwitchingImage}
        preview={preview}
        onOpenImagePath={onOpenImagePath}
        onSaveRotation={onSaveImageRotation}
        imageRotation={imageRotation}
        onRotateImage={onRotateImage}
        saving={imageSaving}
      />
    );
  }

  if (preview.kind === "pdf") {
    return <WorkspacePdfPreview bytes={preview.bytes} title={basename(preview.path)} />;
  }
  if (preview.kind === "presentation") {
    return <WorkspacePresentationPreview bytes={preview.bytes} />;
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
                          maxLength={SPREADSHEET_MAX_CELL_LENGTH}
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
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11"
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
  onSaveRotation: () => Promise<boolean>;
  imageRotation: ImageRotationDraft;
  onRotateImage: () => void;
  saving: boolean;
}) {
  const {
    preview,
    activePath,
    imagePaths,
    transitionDirection,
    isSwitchingImage,
    onOpenImagePath,
    onSaveRotation,
    imageRotation,
    onRotateImage,
    saving,
  } = props;
  const { t } = useLocale();
  const [scale, setScale] = useState(1);
  const rotation = normalizeImageRotation(imageRotation.angle - imageRotation.saved);
  const imageViewportRef = useRef<HTMLDivElement>(null);
  const [imageViewport, setImageViewport] = useState({ width: 1, height: 1 });
  const quarterTurn = rotation === 90 || rotation === 270;
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
  const canSaveRotation = imageRotation.editable;

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

  useEffect(() => {
    const viewport = imageViewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setImageViewport({
        width: Math.max(1, entry.contentRect.width - 32),
        height: Math.max(1, entry.contentRect.height - 32),
      });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const enterTranslateX = transitionDirection > 0 ? 18 : transitionDirection < 0 ? -18 : 0;
  const enterScale = transitionDirection === 0 ? 0.985 : 0.99;

  return (
    <AstryxStack
      direction="vertical"
      className="flex h-full min-h-0 w-full flex-1 flex-col bg-muted/25"
    >
      <AstryxStack
        direction="horizontal"
        className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border bg-background/90 px-2 py-1"
      >
        <AstryxStack direction="horizontal" className="flex min-w-0 items-center gap-1">
          <ImagePreviewToolButton
            label={t("workspaceFilePreview.previousImage")}
            disabled={!canOpenPrevious || isSwitchingImage || saving}
            onClick={() => openImageAt(activeImageIndex - 1)}
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </ImagePreviewToolButton>
          <ImagePreviewToolButton
            label={t("workspaceFilePreview.nextImage")}
            disabled={!canOpenNext || isSwitchingImage || saving}
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
        <AstryxStack direction="horizontal" className="flex flex-wrap items-center gap-1">
          <ImagePreviewToolButton
            label={t("workspaceFilePreview.zoomOut")}
            disabled={!canZoomOut}
            onClick={() =>
              setScale((current) => clampImageScale(current - IMAGE_PREVIEW_SCALE_STEP))
            }
          >
            <Minus className="h-4 w-4" />
          </ImagePreviewToolButton>
          <AstryxButton
            variant="ghost"
            label={t("workspaceFilePreview.fitImage")}
            className="h-8 min-w-13 text-center text-[11px] tabular-nums text-muted-foreground pointer-coarse:h-11"
            onClick={() => setScale(1)}
          >
            {Math.round(scale * 100)}%
          </AstryxButton>
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
            disabled={isSwitchingImage}
            onClick={onRotateImage}
          >
            <RotateCwSquare className="h-4 w-4" />
          </ImagePreviewToolButton>
          <ImagePreviewToolButton
            label={t("workspaceEditor.save")}
            disabled={!canSaveRotation || rotation === 0 || saving}
            onClick={() => {
              void onSaveRotation();
            }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </ImagePreviewToolButton>
        </AstryxStack>
      </AstryxStack>
      <AstryxStack
        direction="vertical"
        ref={imageViewportRef}
        className={cn(
          "relative min-h-0 w-full flex-1",
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
          className="flex min-h-full min-w-full shrink-0 items-center justify-center p-4 transition-[opacity,transform,filter] duration-200 ease-out motion-reduce:transition-none"
          style={{
            width: Math.max(imageViewport.width, imageViewport.width * scale) + 32,
            height: Math.max(imageViewport.height, imageViewport.height * scale) + 32,
            filter: isEntering ? "blur(1px)" : "blur(0px)",
            opacity: isEntering ? 0 : 1,
            transform: isEntering
              ? `translateX(${enterTranslateX}px) scale(${enterScale})`
              : "translateX(0) scale(1)",
          }}
        >
          <AstryxStack
            direction="horizontal"
            className="relative flex shrink-0 items-center justify-center"
            style={{
              height: imageViewport.height * scale,
              width: imageViewport.width * scale,
            }}
          >
            <img
              className="absolute left-1/2 top-1/2 select-none object-contain"
              src={preview.blobUrl}
              alt={basename(preview.path)}
              draggable={false}
              style={{
                width: (quarterTurn ? imageViewport.height : imageViewport.width) * scale,
                height: (quarterTurn ? imageViewport.width : imageViewport.height) * scale,
                maxWidth: "none",
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
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
