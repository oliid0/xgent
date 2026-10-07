import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePresentationText } from "../components/workspace-editor/usePresentationText";
import {
  useWorkspaceEditorExecution,
  type WorkspaceEditorExecution,
} from "../components/workspace-editor/useWorkspaceEditorExecution";
import { useWorkspaceFileApplications } from "../components/workspace-editor/useWorkspaceFileApplications";
import type { WorkspaceCodeEditorOpenRequest } from "../components/workspace-editor/WorkspaceCodeEditorOverlay";
import type { WorkspaceFilePreviewOpenRequest } from "../components/workspace-editor/WorkspaceFilePreviewOverlay";
import { workspaceCodeLanguage } from "../components/workspace-editor/workspaceCodeLanguage";
import { workspaceCodeLocation } from "../components/workspace-editor/workspaceCodeLocation";
import {
  runnableWorkspaceFile,
  workspaceEditorRunStatus,
} from "../components/workspace-editor/workspaceEditorRun";
import { buildSandboxedHtmlPreviewSource } from "../components/workspace-editor/workspaceHtmlPreview";
import {
  hasImageRotationDraft,
  type ImageRotationDraft,
  imageRotationFormat,
  normalizeImageRotation,
  remainingImageRotation,
  rotateWorkspaceImage,
  validImageRotation,
  workspaceImagePaths,
} from "../components/workspace-editor/workspaceImageOperations";
import {
  getWorkspacePreviewKind,
  isWorkspaceEditablePreviewPath,
  workspacePathExtension,
} from "../components/workspace-editor/workspaceImagePreview";
import {
  isEditablePresentation,
  type PresentationTextEdits,
  presentationHasEdits,
  remainingPresentationEdits,
  validPresentationText,
  writePresentationText,
} from "../components/workspace-editor/workspacePresentationText";
import { parseWorkspaceSourceDraft } from "../components/workspace-editor/workspaceSourceDraft";
import {
  buildSpreadsheetTable,
  parseSpreadsheetCellEdit,
  previewBytes,
  previewBytesBase64,
  remainingSpreadsheetEdits,
  type SpreadsheetEdits,
  spreadsheetHasEdits,
  writeSpreadsheetEdits,
} from "../components/workspace-editor/workspaceSpreadsheet";
import { WorkspaceSyntaxController } from "../components/workspace-editor/workspaceSyntax";
import { useLocale } from "../i18n";
import { isNativeMobileRuntime } from "../lib/runtimePlatform";
import type { AppSettings } from "../lib/settings";
import { invokeFs, isFsBackendError } from "../lib/tools/fsBackend";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import {
  type NativeWorkspaceEditorSessions,
  nativeWorkspaceEditorSessions,
} from "./nativeWorkspaceEditorSessions";
import { saveNativeWorkspaceEditorSource } from "./nativeWorkspaceEditorWrites";
import { NativeWorkspaceFind, parseNativeWorkspaceFind } from "./nativeWorkspaceFind";
import { createNativeWorkspacePanel } from "./nativeWorkspacePanel";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";
import {
  type NativeEditorBulk,
  useNativeWorkspaceEditorBulk,
} from "./useNativeWorkspaceEditorBulk";
import {
  type NativeWorkspaceEditorTab,
  useNativeWorkspaceEditorTabs,
} from "./useNativeWorkspaceEditorTabs";

type ReadEditableTextResponse = {
  path: string;
  content: string;
  mtimeMs: number;
  contentHash: string;
  sizeBytes: number;
  totalLines: number;
};

type WriteTextResponse = {
  path: string;
  bytesWritten: number;
  mtimeMs: number;
  contentHash: string;
  totalLines: number;
};

type WriteDocumentResponse = Omit<WriteTextResponse, "totalLines">;

type ReadWorkspacePreviewResponse = {
  path: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
  mtimeMs: number;
  contentHash: string;
  content?: string | null;
};

type LoadedFile = {
  request: WorkspaceCodeEditorOpenRequest | WorkspaceFilePreviewOpenRequest;
  mode: "editor" | "preview";
  path: string;
  mimeType: string;
  data: string | null;
  content: string | null;
  savedContent: string | null;
  mtimeMs: number;
  contentHash: string;
  sizeBytes: number;
  totalLines?: number;
  cells?: SpreadsheetEdits;
  texts?: PresentationTextEdits;
  rotation?: ImageRotationDraft;
};

type PendingConfirmation = "close" | "reload" | null;

type FileDraft = Pick<
  LoadedFile,
  "content" | "savedContent" | "mtimeMs" | "contentHash" | "cells" | "texts" | "rotation"
>;
type FileDraftCache = {
  finds: Map<string, NativeWorkspaceFind>;
  syntax: Map<string, WorkspaceSyntaxController>;
  drafts: Map<string, FileDraft>;
  pendingWrites: Map<string, Promise<void>>;
  editors: Map<string, LoadedFile>;
  writeFailures: Map<string, unknown>;
  publish?: () => void;
};

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized;
}

function message(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  const rendered = String(error ?? "").trim();
  return rendered || fallback;
}

function isConflict(error: unknown) {
  return (
    isFsBackendError(error) && (error.code === "stale_file" || error.code === "requires_full_read")
  );
}

function isFileDirty(file: FileDraft | null | undefined) {
  return (
    !!file &&
    (file.content !== file.savedContent ||
      spreadsheetHasEdits(file.cells) ||
      presentationHasEdits(file.texts) ||
      hasImageRotationDraft(file.rotation))
  );
}

function acknowledgedDraft(
  current: FileDraft,
  snapshot: LoadedFile,
  response: WriteDocumentResponse,
): FileDraft {
  return {
    ...current,
    savedContent: snapshot.content,
    cells: remainingSpreadsheetEdits(current.cells, snapshot.cells),
    texts: remainingPresentationEdits(current.texts, snapshot.texts),
    rotation: remainingImageRotation(current.rotation, snapshot.rotation),
    mtimeMs: response.mtimeMs,
    contentHash: response.contentHash,
  };
}

/**
 * Native file viewer/editor. Reads and writes through the same guarded Rust FS
 * commands as the Astryx editor; only the visible presentation is SwiftUI.
 */
type NativeWorkspaceFilePageProps = {
  onEditorSessionsChanged?: (sessions: NativeWorkspaceEditorSessions) => void;
  settings: AppSettings;
  editorRequest: WorkspaceCodeEditorOpenRequest | null;
  editorOpen: boolean;
  previewRequest: WorkspaceFilePreviewOpenRequest | null;
  previewOpen: boolean;
  onEditorClose: () => void;
  onPreviewClose: () => void;
};

export function NativeWorkspaceFilePage(props: NativeWorkspaceFilePageProps) {
  const { t } = useLocale();
  const editorScope = useRef(
    `workspace-editor-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
  );
  // File views have separate lifetimes; unsaved text belongs to the workspace.
  // Keep no media bytes here and do not evict another file's unsaved edits.
  const cache = useRef<FileDraftCache>({
    finds: new Map(),
    syntax: new Map(),
    drafts: new Map(),
    pendingWrites: new Map(),
    editors: new Map(),
    writeFailures: new Map(),
  });
  const pageMounted = useRef(false);
  const [cacheVersion, refreshTabs] = useState(0);
  const publishTabs = useCallback(() => {
    if (pageMounted.current) refreshTabs((value) => value + 1);
  }, []);
  cache.current.publish = publishTabs;
  useEffect(() => {
    pageMounted.current = true;
    return () => {
      pageMounted.current = false;
    };
  }, []);
  const tabs = useNativeWorkspaceEditorTabs(props.editorOpen ? props.editorRequest : null);
  const sessionRevision = useRef(0);
  useEffect(() => {
    props.onEditorSessionsChanged?.(
      nativeWorkspaceEditorSessions(editorScope.current, tabs.tabs, ++sessionRevision.current),
    );
  }, [tabs.tabs, props.onEditorSessionsChanged]);
  useEffect(() => {
    const open = new Set(tabs.tabs.map((tab) => JSON.stringify([tab.key, tab.session])));
    for (const identity of cache.current.finds.keys())
      if (!open.has(identity)) cache.current.finds.delete(identity);
    for (const identity of cache.current.syntax.keys())
      if (!open.has(identity)) cache.current.syntax.delete(identity);
  }, [tabs.tabs]);
  const bulk = useNativeWorkspaceEditorBulk({
    cache: cache.current,
    readTabs: tabs.readTabs,
    removeAll: tabs.removeAll,
    dirty: isFileDirty,
    onClose: props.onEditorClose,
    visible: props.editorOpen && !props.previewOpen,
  });
  const execution = useWorkspaceEditorExecution({
    canRun: (target, saved) =>
      tabs.readTabs().some((tab) => tab.key === target.key && tab.session === target.session) &&
      cache.current.editors.get(target.key)?.mode === "editor" &&
      (!saved ||
        !isFileDirty(
          cache.current.drafts.get(target.key) ?? cache.current.editors.get(target.key),
        )),
    beforeRun: async (target) => {
      try {
        return await saveNativeWorkspaceEditorSource(cache.current, target.key, isFileDirty);
      } catch {
        return false;
      }
    },
    failure: t("workspaceEditor.runFailed"),
    stopFailure: t("workspaceEditor.stopRunFailed"),
  });
  const lifetime = useRef<{ file: string; request: number; key: string } | null>(null);
  const [imageNavigation, setImageNavigation] = useState<{ source: string; path: string } | null>(
    null,
  );
  const activeRequest = props.previewOpen
    ? props.previewRequest
    : props.editorOpen
      ? (tabs.active?.request ?? null)
      : null;
  const activeMode: LoadedFile["mode"] = props.previewOpen ? "preview" : "editor";
  if (!activeRequest) {
    lifetime.current = null;
    return null;
  }
  const source = JSON.stringify([
    activeMode,
    activeRequest.id,
    activeRequest.projectPathKey,
    activeRequest.workdir,
    activeRequest.path,
  ]);
  const imagePaths = workspaceImagePaths(props.previewRequest?.imagePaths, activeRequest.path);
  const effectiveRequest =
    imageNavigation?.source === source && activeMode === "preview"
      ? { ...activeRequest, path: imageNavigation.path, imagePaths }
      : activeRequest;
  const file = JSON.stringify([
    activeMode,
    effectiveRequest.projectPathKey,
    effectiveRequest.workdir,
    effectiveRequest.path,
  ]);
  if (
    !lifetime.current ||
    lifetime.current.file !== file ||
    (lifetime.current.request !== effectiveRequest.id && activeMode !== "editor")
  ) {
    lifetime.current = {
      file,
      request: effectiveRequest.id,
      key: JSON.stringify([file, effectiveRequest.id]),
    };
  } else {
    lifetime.current.request = effectiveRequest.id;
  }
  return (
    <NativeWorkspaceFileSession
      key={lifetime.current.key}
      {...props}
      activeRequest={effectiveRequest}
      onImageNavigate={(path) => {
        if (activeMode === "preview" && imagePaths.includes(path))
          setImageNavigation({ source, path });
      }}
      activeMode={activeMode}
      draftKey={JSON.stringify([
        effectiveRequest.projectPathKey,
        effectiveRequest.workdir,
        effectiveRequest.path,
      ])}
      draftCache={cache.current}
      cacheVersion={cacheVersion}
      bulk={bulk}
      execution={execution}
      editorScope={editorScope.current}
      tabs={activeMode === "editor" ? tabs.tabs : []}
      onSelectTab={tabs.select}
      onCloseTab={tabs.requestClose}
      tabCloseRequest={
        activeMode === "editor" && tabs.closeRequest && tabs.closeRequest.key === tabs.active?.key
          ? tabs.closeRequest.token
          : null
      }
      onEditorClose={() => {
        if (!tabs.active) return;
        cache.current.editors.delete(tabs.active.key);
        cache.current.drafts.delete(tabs.active.key);
        cache.current.writeFailures.delete(tabs.active.key);
        if (tabs.remove(tabs.active.key, tabs.active.session)) props.onEditorClose();
      }}
      onHideEditor={props.onEditorClose}
    />
  );
}

function NativeWorkspaceFileSession(
  props: NativeWorkspaceFilePageProps & {
    activeRequest: WorkspaceCodeEditorOpenRequest | WorkspaceFilePreviewOpenRequest;
    activeMode: LoadedFile["mode"];
    draftKey: string;
    draftCache: FileDraftCache;
    onImageNavigate: (path: string) => void;
    tabs: NativeWorkspaceEditorTab[];
    onSelectTab: (key: string) => boolean;
    onCloseTab: (key: string) => boolean;
    tabCloseRequest: number | null;
    onHideEditor: () => void;
    cacheVersion: number;
    bulk: NativeEditorBulk;
    execution: WorkspaceEditorExecution;
    editorScope: string;
  },
) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const initialRequest = useRef({ ...props.activeRequest });
  const activeRequest = initialRequest.current;
  const activeMode = props.activeMode;
  const codeLocation =
    activeMode === "editor"
      ? workspaceCodeLocation(props.activeRequest as WorkspaceCodeEditorOpenRequest)
      : null;
  const { draftCache, draftKey } = props;
  const findIdentity = JSON.stringify([
    draftKey,
    props.tabs.find((tab) => tab.key === draftKey)?.session,
  ]);
  const find = useRef(draftCache.finds.get(findIdentity) ?? new NativeWorkspaceFind());
  if (activeMode === "editor") draftCache.finds.set(findIdentity, find.current);
  const [, setFindRevision] = useState(0);
  const locale = useRef(t);
  locale.current = t;
  const [loaded, setLoadedState] = useState<LoadedFile | null>(null);
  const syntax = useMemo(() => {
    if (loaded?.mode !== "editor" || loaded.content === null) return null;
    let controller = draftCache.syntax.get(findIdentity);
    if (!controller) {
      controller = new WorkspaceSyntaxController();
      draftCache.syntax.set(findIdentity, controller);
    }
    return controller.refresh(loaded.content, workspaceCodeLanguage(loaded.path));
  }, [loaded?.mode, loaded?.content, loaded?.path, draftCache, findIdentity]);
  const loadedRef = useRef<LoadedFile | null>(null);
  const sourceVersion = useRef(0);
  const setLoaded = useCallback(
    (next: LoadedFile | null | ((current: LoadedFile | null) => LoadedFile | null)) => {
      const value = typeof next === "function" ? next(loadedRef.current) : next;
      if (value?.content !== loadedRef.current?.content) sourceVersion.current++;
      loadedRef.current = value;
      if (value?.mode === "editor" && value.content !== null) find.current.refresh(value.content);
      if (value) {
        if (value.mode === "editor") draftCache.editors.set(draftKey, value);
        if (isFileDirty(value) || draftCache.pendingWrites.has(draftKey)) {
          draftCache.drafts.set(draftKey, {
            content: value.content,
            savedContent: value.savedContent,
            mtimeMs: value.mtimeMs,
            contentHash: value.contentHash,
            cells: value.cells,
            texts: value.texts,
            rotation: value.rotation,
          });
        } else {
          draftCache.drafts.delete(draftKey);
        }
        draftCache.publish?.();
      }
      setLoadedState(value);
    },
    [draftCache, draftKey],
  );
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(true);
  loadingRef.current = loading;
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const readGeneration = useRef(0);
  const [failure, setFailure] = useState<string | null>(null);
  const fileApplications = useWorkspaceFileApplications({
    workdir: activeRequest.workdir,
    path: loaded?.path ?? activeRequest.path,
    enabled: !compact && !!loaded,
    onError: setFailure,
  });
  const [confirmation, setConfirmationState] = useState<PendingConfirmation>(null);
  const confirmationRef = useRef<PendingConfirmation>(null);
  const pendingImagePathRef = useRef<string | null>(null);
  const setConfirmation = useCallback((next: PendingConfirmation) => {
    if (next === null) pendingImagePathRef.current = null;
    confirmationRef.current = next;
    setConfirmationState(next);
  }, []);
  const [previewMode, setPreviewMode] = useState<"preview" | "source" | "presentation">("preview");
  const presentationBytes = useMemo(
    () =>
      loaded?.data && isEditablePresentation(loaded.path, loaded.mimeType)
        ? previewBytes(loaded.data)
        : null,
    [loaded?.data, loaded?.path, loaded?.mimeType],
  );
  const presentationText = usePresentationText(presentationBytes);
  const [activeSheet, setActiveSheet] = useState("");
  const activeSheetRef = useRef("");
  const spreadsheet = useMemo(() => {
    if (!loaded?.data || getWorkspacePreviewKind(loaded.path) !== "spreadsheet") return null;
    try {
      return buildSpreadsheetTable(
        { kind: "spreadsheet", bytes: previewBytes(loaded.data) },
        activeSheet,
        t("workspaceFilePreview.renderFailed"),
      );
    } catch (error) {
      return {
        sheetNames: [],
        rows: [],
        activeSheetName: "",
        truncatedRows: false,
        truncatedColumns: false,
        error: message(error, t("workspaceFilePreview.renderFailed")),
      };
    }
  }, [loaded?.data, loaded?.path, activeSheet, t]);
  activeSheetRef.current = spreadsheet?.activeSheetName ?? "";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readGeneration.current++;
    };
  }, []);

  const closeNow = useCallback(() => {
    if (!mounted.current || savingRef.current) return;
    setConfirmation(null);
    if (activeMode === "preview") props.onPreviewClose();
    else props.onEditorClose();
  }, [activeMode, props.onEditorClose, props.onPreviewClose, setConfirmation]);

  const syncEditorBaseline = useCallback(() => {
    const current = loadedRef.current,
      cached = draftCache.editors.get(draftKey);
    if (
      current?.mode !== "editor" ||
      !cached ||
      (current.contentHash === cached.contentHash &&
        current.mtimeMs === cached.mtimeMs &&
        current.savedContent === cached.savedContent)
    )
      return;
    setLoaded({
      ...current,
      savedContent: cached.savedContent,
      contentHash: cached.contentHash,
      mtimeMs: cached.mtimeMs,
      sizeBytes: cached.sizeBytes,
      totalLines: cached.totalLines,
    });
  }, [draftCache, draftKey, setLoaded]);
  const displayedWriteFailure = useRef(false);
  useEffect(() => {
    if (props.cacheVersion >= 0) syncEditorBaseline();
    if (draftCache.writeFailures.has(draftKey)) {
      const error = draftCache.writeFailures.get(draftKey);
      displayedWriteFailure.current = true;
      setFailure(
        isConflict(error)
          ? t("workspaceEditor.conflictMessage")
          : message(error, t("workspaceEditor.saveFailed")),
      );
    } else if (displayedWriteFailure.current) {
      displayedWriteFailure.current = false;
      setFailure(null);
    }
  }, [props.cacheVersion, syncEditorBaseline, draftCache, draftKey, t]);

  const load = useCallback(
    async (
      request: WorkspaceCodeEditorOpenRequest | WorkspaceFilePreviewOpenRequest,
      mode: LoadedFile["mode"],
      forceRead = false,
    ) => {
      const generation = ++readGeneration.current;
      const previous = forceRead ? loadedRef.current : null;
      const version = sourceVersion.current;
      const sourceChanged = () => forceRead && sourceVersion.current !== version;
      const current = () => mounted.current && generation === readGeneration.current;
      setLoading(true);
      setFailure(null);
      if (!previous) setLoaded(null);
      try {
        // Reopening the same file waits for its previous session's write and
        // reads the final version. Other files remain independently usable.
        await draftCache.pendingWrites.get(draftKey);
        if (!current()) return;
        const restoreDraft = (file: LoadedFile): LoadedFile => {
          const draft = draftCache.drafts.get(draftKey);
          if (
            !draft ||
            (!spreadsheetHasEdits(draft.cells) &&
              !presentationHasEdits(draft.texts) &&
              !hasImageRotationDraft(draft.rotation) &&
              draft.content === file.content)
          )
            return file;
          if (draft.contentHash !== file.contentHash) {
            setFailure(locale.current("workspaceEditor.conflictMessage"));
          }
          // An external edit must still fail the original optimistic write guard.
          return { ...file, ...draft };
        };
        const cached =
          mode === "editor" && !forceRead ? draftCache.editors.get(draftKey) : undefined;
        if (cached) {
          setLoaded(restoreDraft({ ...cached, request, mode }));
          if (draftCache.writeFailures.has(draftKey)) {
            const error = draftCache.writeFailures.get(draftKey);
            setFailure(
              isConflict(error)
                ? locale.current("workspaceEditor.conflictMessage")
                : message(error, locale.current("workspaceEditor.saveFailed")),
            );
          }
        } else if (mode === "editor" || isWorkspaceEditablePreviewPath(request.path)) {
          const response = await invokeFs<ReadEditableTextResponse>("fs_read_editable_text", {
            workdir: request.workdir,
            path: request.path,
          });
          if (!current() || sourceChanged()) return;
          setLoaded(
            restoreDraft({
              request,
              mode,
              path: response.path || request.path,
              mimeType: "text/plain",
              data: null,
              content: response.content,
              savedContent: response.content,
              mtimeMs: response.mtimeMs,
              contentHash: response.contentHash,
              sizeBytes: response.sizeBytes,
              totalLines: response.totalLines,
            }),
          );
        } else {
          const response = await invokeFs<ReadWorkspacePreviewResponse>("fs_read_workspace_image", {
            workdir: request.workdir,
            path: request.path,
          });
          if (!current() || sourceChanged()) return;
          setLoaded(
            restoreDraft({
              request,
              mode,
              path: response.path || request.path,
              mimeType: response.mimeType,
              data: response.data,
              content: response.content ?? null,
              savedContent: response.content ?? null,
              ...(response.mimeType.startsWith("image/")
                ? {
                    rotation: {
                      angle: 0,
                      saved: 0,
                      editable: !!imageRotationFormat(
                        response.path || request.path,
                        response.mimeType,
                      ),
                    },
                  }
                : {}),
              mtimeMs: response.mtimeMs,
              contentHash: response.contentHash,
              sizeBytes: response.sizeBytes,
            }),
          );
        }
        setConfirmation(null);
      } catch (error) {
        if (!current() || sourceChanged()) return;
        setLoaded(loadedRef.current ?? previous);
        setFailure(
          message(
            error,
            mode === "preview"
              ? locale.current("workspaceFilePreview.openFailed")
              : locale.current("workspaceEditor.openFailed"),
          ),
        );
      } finally {
        if (current()) setLoading(false);
      }
    },
    [draftCache, draftKey, setLoaded, setConfirmation],
  );

  useEffect(() => {
    void load(activeRequest, activeMode);
  }, [activeMode, activeRequest, load]);

  const dirty = isFileDirty(loaded);
  const editablePreview = Boolean(
    loaded?.mode === "preview" &&
      (isWorkspaceEditablePreviewPath(loaded.path) ||
        (getWorkspacePreviewKind(loaded.path) === "document" &&
          workspacePathExtension(loaded.path) === "docx")),
  );
  const canEditSpreadsheet =
    loaded?.mode === "preview" &&
    workspacePathExtension(loaded.path) === "xlsx" &&
    !!spreadsheet &&
    !spreadsheet.error;
  const canEdit = loaded?.mode === "editor" || editablePreview;
  const save = useCallback(
    async (value: PresentationValue = null) => {
      if (savingRef.current || !mounted.current || loadingRef.current) return false;
      syncEditorBaseline();
      if (typeof value === "number") {
        const current = loadedRef.current;
        if (!validImageRotation(value) || !current?.rotation?.editable) return false;
        setLoaded({ ...current, rotation: { ...current.rotation, angle: value } });
      }
      if (typeof value === "string") {
        const current = loadedRef.current;
        const source = parseWorkspaceSourceDraft(value);
        if (source) {
          if (
            !current ||
            current.content === null ||
            !(
              current.mode === "editor" ||
              isWorkspaceEditablePreviewPath(current.path) ||
              workspacePathExtension(current.path) === "docx"
            )
          )
            return false;
          setLoaded({ ...current, content: source.content });
        } else return false;
      }
      const pendingWrite = draftCache.pendingWrites.get(draftKey);
      if (pendingWrite) {
        await pendingWrite;
        if (!mounted.current) return false;
        syncEditorBaseline();
        return !draftCache.writeFailures.has(draftKey) && !isFileDirty(loadedRef.current);
      }
      syncEditorBaseline();
      const snapshot = loadedRef.current;
      if (!snapshot || !isFileDirty(snapshot)) return true;
      savingRef.current = true;
      let finishWrite = () => {};
      const completion = new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      draftCache.pendingWrites.set(draftKey, completion);
      draftCache.writeFailures.delete(draftKey);
      setSaving(true);
      setFailure(null);
      try {
        let response: WriteTextResponse | WriteDocumentResponse;
        let binaryData: string | undefined;
        if (hasImageRotationDraft(snapshot.rotation)) {
          const format = imageRotationFormat(snapshot.path, snapshot.mimeType);
          if (!format || !snapshot.data || !snapshot.rotation)
            throw new Error(t("workspaceEditor.saveFailed"));
          binaryData = previewBytesBase64(
            await rotateWorkspaceImage(
              previewBytes(snapshot.data),
              format,
              normalizeImageRotation(snapshot.rotation.angle - snapshot.rotation.saved),
            ),
          );
          response = await invokeFs<WriteDocumentResponse>("fs_write_binary", {
            workdir: snapshot.request.workdir,
            path: snapshot.path,
            content_base64: binaryData,
            expected_mtime_ms: snapshot.mtimeMs,
            expected_content_hash: snapshot.contentHash,
          });
        } else if (presentationHasEdits(snapshot.texts)) {
          if (!snapshot.data || workspacePathExtension(snapshot.path) !== "pptx")
            throw new Error(t("workspaceEditor.saveFailed"));
          binaryData = previewBytesBase64(
            await writePresentationText(previewBytes(snapshot.data), snapshot.texts ?? {}),
          );
          response = await invokeFs<WriteDocumentResponse>("fs_write_binary", {
            workdir: snapshot.request.workdir,
            path: snapshot.path,
            content_base64: binaryData,
            expected_mtime_ms: snapshot.mtimeMs,
            expected_content_hash: snapshot.contentHash,
          });
        } else if (spreadsheetHasEdits(snapshot.cells)) {
          if (!snapshot.data || workspacePathExtension(snapshot.path) !== "xlsx")
            throw new Error(t("workspaceEditor.saveFailed"));
          binaryData = previewBytesBase64(
            await writeSpreadsheetEdits(previewBytes(snapshot.data), snapshot.cells ?? {}),
          );
          response = await invokeFs<WriteDocumentResponse>("fs_write_binary", {
            workdir: snapshot.request.workdir,
            path: snapshot.path,
            content_base64: binaryData,
            expected_mtime_ms: snapshot.mtimeMs,
            expected_content_hash: snapshot.contentHash,
          });
        } else if (
          snapshot.mode === "preview" &&
          getWorkspacePreviewKind(snapshot.path) === "document" &&
          workspacePathExtension(snapshot.path) === "docx"
        ) {
          response = await invokeFs<WriteDocumentResponse>("fs_write_docx_text", {
            workdir: snapshot.request.workdir,
            path: snapshot.path,
            content: snapshot.content,
            expected_mtime_ms: snapshot.mtimeMs,
            expected_content_hash: snapshot.contentHash,
          });
        } else {
          response = await invokeFs<WriteTextResponse>("fs_write_text", {
            workdir: snapshot.request.workdir,
            path: snapshot.path,
            content: snapshot.content,
            mode: "rewrite",
            expected_mtime_ms: snapshot.mtimeMs,
            expected_content_hash: snapshot.contentHash,
          });
        }
        // A background acknowledgement advances this file's cached baseline,
        // including edits made after the write started or after switching away.
        const draft = draftCache.drafts.get(draftKey);
        const editor = draftCache.editors.get(draftKey);
        if (editor)
          draftCache.editors.set(draftKey, {
            ...editor,
            ...acknowledgedDraft(editor, snapshot, response),
            sizeBytes: response.bytesWritten,
            totalLines: "totalLines" in response ? response.totalLines : editor.totalLines,
          });
        if (draft) {
          const rebased = acknowledgedDraft(draft, snapshot, response);
          if (!isFileDirty(rebased)) draftCache.drafts.delete(draftKey);
          else draftCache.drafts.set(draftKey, rebased);
        }
        draftCache.publish?.();
        if (!mounted.current) return false;
        setLoaded((current) =>
          current
            ? {
                ...current,
                ...acknowledgedDraft(current, snapshot, response),
                data: binaryData ?? current.data,
                totalLines: "totalLines" in response ? response.totalLines : current.totalLines,
                sizeBytes: response.bytesWritten,
              }
            : current,
        );
        if (snapshot.mode === "preview" && workspacePathExtension(snapshot.path) === "docx") {
          setLoaded((current) => (current ? { ...current, data: null } : current));
          try {
            const preview = await invokeFs<ReadWorkspacePreviewResponse>(
              "fs_read_workspace_image",
              {
                workdir: snapshot.request.workdir,
                path: snapshot.path,
              },
            );
            if (mounted.current)
              setLoaded((current) =>
                current
                  ? {
                      ...current,
                      data: preview.data,
                      mimeType: preview.mimeType,
                    }
                  : current,
              );
          } catch (error) {
            if (mounted.current) setFailure(message(error, t("workspaceFilePreview.openFailed")));
          }
        }
        return !isFileDirty(loadedRef.current);
      } catch (error) {
        draftCache.writeFailures.set(draftKey, error);
        if (!mounted.current) return false;
        setFailure(
          isConflict(error)
            ? t("workspaceEditor.conflictMessage")
            : message(error, t("workspaceEditor.saveFailed")),
        );
        return false;
      } finally {
        savingRef.current = false;
        draftCache.pendingWrites.delete(draftKey);
        const draft = draftCache.drafts.get(draftKey);
        if (draft && !isFileDirty(draft)) draftCache.drafts.delete(draftKey);
        finishWrite();
        if (mounted.current) setSaving(false);
      }
    },
    [draftCache, draftKey, setLoaded, syncEditorBaseline, t],
  );

  const applySourceInput = (value: PresentationValue = null) => {
    if (!mounted.current) return false;
    syncEditorBaseline();
    if (value === null) return true;
    const source = parseWorkspaceSourceDraft(value),
      current = loadedRef.current;
    if (!source || !current || !canEdit || current.content === null) return false;
    setLoaded({ ...current, content: source.content });
    return true;
  };
  const requestClose = (value: PresentationValue = null) => {
    if (savingRef.current || draftCache.pendingWrites.has(draftKey)) return;
    if (!applySourceInput(value)) return;
    pendingImagePathRef.current = null;
    if (isFileDirty(loadedRef.current)) setConfirmation("close");
    else closeNow();
  };
  const execution = {
    ...props.execution,
    run: (value: PresentationValue = null) => {
      if (!mounted.current || loadingRef.current || loadedRef.current?.mode !== "editor")
        return false;
      const tab = props.tabs.find((item) => item.key === draftKey);
      return tab
        ? props.execution.run(
            {
              key: tab.key,
              session: tab.session,
              workdir: tab.request.workdir,
              path: loadedRef.current.path,
            },
            () => applySourceInput(value),
          )
        : false;
    },
  };
  const requestReload = (value: PresentationValue = null) => {
    if (!loaded || savingRef.current || loading || draftCache.pendingWrites.has(draftKey)) return;
    if (!applySourceInput(value)) return;
    pendingImagePathRef.current = null;
    if (isFileDirty(loadedRef.current)) setConfirmation("reload");
    else void load(loaded.request, loaded.mode, true);
  };
  const consumedTabClose = useRef<number | null>(null);
  const pendingEditorWrite = draftCache.pendingWrites.has(draftKey);
  useEffect(() => {
    const token = props.tabCloseRequest;
    if (token === null || consumedTabClose.current === token || loading || !mounted.current) return;
    if (saving || savingRef.current || pendingEditorWrite) return;
    consumedTabClose.current = token;
    if (isFileDirty(loadedRef.current)) setConfirmation("close");
    else closeNow();
  }, [props.tabCloseRequest, loading, saving, pendingEditorWrite, closeNow, setConfirmation]);
  const imageNavigation = useRef(false);
  const navigateImage = async (path: string) => {
    const current = loadedRef.current;
    if (
      !mounted.current ||
      !current ||
      savingRef.current ||
      imageNavigation.current ||
      loading ||
      path === current.path
    )
      return;
    const paths = workspaceImagePaths(
      "imagePaths" in current.request ? current.request.imagePaths : undefined,
      activeRequest.path,
    );
    if (!paths.includes(path)) return;
    if (isFileDirty(current)) {
      pendingImagePathRef.current = path;
      setConfirmation("reload");
      return;
    }
    imageNavigation.current = true;
    props.onImageNavigate(path);
  };
  const confirmSave = async (value: PresentationValue = null) => {
    const pending = confirmationRef.current;
    const pendingImagePath = pendingImagePathRef.current;
    if (!pending || !(await save(value))) return;
    if (!mounted.current) return;
    setConfirmation(null);
    if (pendingImagePath && pending === "reload" && loadedRef.current) {
      props.onImageNavigate(pendingImagePath);
      return;
    }
    if (pending === "close") closeNow();
    else if (pending === "reload" && loadedRef.current) {
      await load(loadedRef.current.request, loadedRef.current.mode, true);
    }
  };
  const confirmDiscard = () => {
    if (savingRef.current) return;
    const pending = confirmationRef.current;
    const pendingImagePath = pendingImagePathRef.current;
    if (!pending) return;
    draftCache.drafts.delete(draftKey);
    draftCache.editors.delete(draftKey);
    draftCache.writeFailures.delete(draftKey);
    if (pending === "reload" && loadedRef.current && !pendingImagePath) {
      const current = loadedRef.current;
      setLoaded({
        ...current,
        content: current.savedContent,
        cells: undefined,
        texts: undefined,
        rotation: current.rotation
          ? { ...current.rotation, angle: current.rotation.saved }
          : undefined,
      });
    }
    setConfirmation(null);
    if (pendingImagePath && pending === "reload" && loadedRef.current) {
      props.onImageNavigate(pendingImagePath);
      return;
    }
    if (pending === "close") closeNow();
    else if (pending === "reload" && loaded) void load(loaded.request, loaded.mode, true);
  };

  const handlers = new Map<string, PresentationHandler>();
  const bind = (
    id: string,
    run: (value: PresentationValue) => unknown,
    accepts: (value: PresentationValue) => boolean,
    enabled = true,
  ) => {
    handlers.set(id, { run, accepts, enabled });
    return id;
  };
  const findAction: PresentationNode | null =
    loaded?.mode === "editor"
      ? {
          id: "workspace-file-find-action",
          kind: "Button",
          variant: "workspace-code-find-action",
          disabled: loading || !canEdit,
          action: bind(
            `workspace-file-find-action:${findIdentity}`,
            (value) => {
              const input = parseNativeWorkspaceFind(value);
              if (
                !mounted.current ||
                loadingRef.current ||
                !input ||
                loadedRef.current?.mode !== "editor"
              )
                return false;
              // An acknowledgement follows the real native text-view mutation. It must
              // never reinstall an older source over input already received meanwhile.
              if (input.command === "ack") {
                if (
                  !find.current.dispatch({
                    ...input,
                    content: loadedRef.current.content ?? input.content,
                  })
                )
                  return false;
              } else {
                if (!applySourceInput(JSON.stringify({ kind: "source", content: input.content })))
                  return false;
                find.current.dispatch(input);
              }
              setFindRevision(find.current.revision);
              return true;
            },
            (value) => !!parseNativeWorkspaceFind(value),
            !loading && canEdit,
          ),
        }
      : null;
  const button = (
    id: string,
    label: string,
    icon: string,
    run: (value: PresentationValue) => unknown,
    enabled = true,
    destructive = false,
    actionID = id,
  ): PresentationNode => ({
    id,
    kind: "Button",
    label,
    icon,
    disabled: !enabled,
    destructive,
    ...(loaded?.rotation?.editable &&
    ["workspace-file-save", "workspace-file-confirm-save", "workspace-file-image-save"].includes(id)
      ? { variant: "workspace-image-save" }
      : canEdit &&
          (loaded?.mode === "editor" || previewMode === "source") &&
          [
            "workspace-file-save",
            "workspace-file-confirm-save",
            "workspace-file-run",
            "workspace-file-close",
            "workspace-file-reload",
            "workspace-file-hide",
          ].includes(id)
        ? { variant: "workspace-source-action", current: dirty ? 1 : 0 }
        : {}),
    action: bind(
      actionID,
      run,
      (value) =>
        value === null ||
        (canEdit &&
          [
            "workspace-file-save",
            "workspace-file-confirm-save",
            "workspace-file-run",
            "workspace-file-close",
            "workspace-file-reload",
            "workspace-file-hide",
          ].includes(id) &&
          !!parseWorkspaceSourceDraft(value)) ||
        (!!loaded?.rotation?.editable &&
          [
            "workspace-file-save",
            "workspace-file-confirm-save",
            "workspace-file-image-save",
          ].includes(id) &&
          validImageRotation(value)),
      enabled,
    ),
  });
  const previewKind = loaded ? getWorkspacePreviewKind(loaded.path) : null;
  const tabsNode: PresentationNode | null =
    activeMode === "editor" && props.tabs.length
      ? {
          id: "workspace-editor-tabs",
          kind: "VStack",
          variant: "workspace-editor-tabs",
          label: t("workspaceEditor.title"),
          children: props.tabs.map((tab) => {
            const selected = tab.key === draftKey;
            const tabDirty = isFileDirty(
              draftCache.drafts.get(tab.key) ?? draftCache.editors.get(tab.key),
            );
            const tabAction = (close: boolean): PresentationNode => {
              const id = `workspace-editor-tab-${close ? "close" : "select"}:${tab.session}`;
              const enabled = !close || !selected || (!saving && !pendingEditorWrite);
              return {
                id,
                kind: "Button",
                label: close ? t("workspaceEditor.closeTab") : basename(tab.request.path),
                icon: close ? "xmark" : undefined,
                disabled: !enabled,
                current: tabDirty ? 1 : 0,
                action: bind(
                  id,
                  (value) => {
                    if (!mounted.current || !applySourceInput(value)) return false;
                    return close ? props.onCloseTab(tab.key) : props.onSelectTab(tab.key);
                  },
                  (value) => value === null || (canEdit && !!parseWorkspaceSourceDraft(value)),
                  enabled,
                ),
              };
            };
            return {
              id: `workspace-editor-tab:${tab.session}`,
              kind: "HStack",
              variant: "workspace-editor-tab",
              label: basename(tab.request.path),
              text: `${tab.request.workdir}/${tab.request.path}`,
              selected,
              current: tabDirty ? 1 : 0,
              children: [tabAction(false), tabAction(true)],
            };
          }),
        }
      : null;
  const formattedPreview =
    loaded?.mode === "preview" &&
    (previewKind === "html" ||
      previewKind === "markdown" ||
      (previewKind === "document" &&
        workspacePathExtension(loaded.path) === "docx" &&
        loaded.content !== null));
  const renderedPreview =
    formattedPreview && previewKind !== "document" && previewMode === "preview";
  const mediaPreview = Boolean(
    loaded &&
      (["image", "pdf", "audio", "video"].includes(previewKind ?? "") ||
        previewKind === "spreadsheet" ||
        previewKind === "presentation" ||
        (previewKind === "document" &&
          (workspacePathExtension(loaded.path) !== "docx" || previewMode === "preview"))),
  );
  const spreadsheetNode: PresentationNode | null =
    spreadsheet && !spreadsheet.error
      ? {
          id: "workspace-file-spreadsheet",
          kind: "SpreadsheetGrid",
          label: basename(loaded?.path ?? activeRequest.path),
          fill: true,
          value: JSON.stringify({
            sheet: spreadsheet.activeSheetName,
            editable: canEditSpreadsheet,
            rows: spreadsheet.rows.map((row) => ({
              rowIndex: row.rowIndex,
              cells: row.cells.map((cell) => ({
                columnIndex: cell.columnIndex,
                value:
                  loaded?.cells?.[spreadsheet.activeSheetName]?.[
                    `${row.rowIndex}:${cell.columnIndex}`
                  ] ?? cell.value,
              })),
            })),
          }),
          ...(canEditSpreadsheet
            ? {
                action: bind(
                  "workspace-file-spreadsheet",
                  (value) => {
                    const cell = parseSpreadsheetCellEdit(value);
                    const original = cell && spreadsheet.rows[cell.row]?.cells[cell.column];
                    if (
                      !mounted.current ||
                      !cell ||
                      !original ||
                      cell.sheet !== activeSheetRef.current
                    )
                      return;
                    setLoaded((current) => {
                      if (!current || workspacePathExtension(current.path) !== "xlsx")
                        return current;
                      const changes = { ...current.cells?.[cell.sheet] };
                      const coordinate = `${cell.row}:${cell.column}`;
                      // A value equal to the old file still differs from an in-flight save.
                      if (!savingRef.current && cell.value === original.value)
                        delete changes[coordinate];
                      else changes[coordinate] = cell.value;
                      return { ...current, cells: { ...current.cells, [cell.sheet]: changes } };
                    });
                  },
                  (value) => {
                    const cell = parseSpreadsheetCellEdit(value);
                    return (
                      !!cell &&
                      cell.sheet === spreadsheet.activeSheetName &&
                      cell.sheet === activeSheetRef.current &&
                      !!spreadsheet.rows[cell.row]?.cells[cell.column]
                    );
                  },
                ),
              }
            : {}),
        }
      : null;
  const imagePaths =
    loaded && "imagePaths" in loaded.request
      ? workspaceImagePaths(loaded.request.imagePaths, activeRequest.path)
      : workspaceImagePaths(undefined, activeRequest.path);
  const imageIndex = imagePaths.indexOf(loaded?.path ?? activeRequest.path);
  const imageNode: PresentationNode | null =
    loaded?.rotation && loaded.data
      ? {
          id: "workspace-file-media",
          kind: "MediaPreview",
          variant: "workspace-image-preview",
          value: loaded.data,
          language: loaded.mimeType,
          label: basename(loaded.path),
          fill: true,
          current: loaded.rotation.saved,
          text: t("workspaceFilePreview.imageCounter")
            .replace("{index}", String(Math.max(1, imageIndex + 1)))
            .replace("{total}", String(Math.max(1, imagePaths.length))),
          children: [
            button(
              "workspace-file-image-previous",
              t("workspaceFilePreview.previousImage"),
              "chevron.left",
              () => navigateImage(imagePaths[imageIndex - 1]),
              imageIndex > 0 && !saving,
            ),
            button(
              "workspace-file-image-next",
              t("workspaceFilePreview.nextImage"),
              "chevron.right",
              () => navigateImage(imagePaths[imageIndex + 1]),
              imageIndex >= 0 && imageIndex < imagePaths.length - 1 && !saving,
            ),
            {
              id: "workspace-file-image-zoom-out",
              kind: "IconButton",
              label: t("workspaceFilePreview.zoomOut"),
              icon: "minus",
            },
            {
              id: "workspace-file-image-zoom-in",
              kind: "IconButton",
              label: t("workspaceFilePreview.zoomIn"),
              icon: "plus",
            },
            {
              id: "workspace-file-image-fit",
              kind: "Button",
              label: t("workspaceFilePreview.fitImage"),
            },
            {
              id: "workspace-file-image-rotation",
              kind: "NumberInput",
              variant: "workspace-image-rotation",
              label: t("workspaceFilePreview.rotateImage"),
              icon: "rotate.right",
              minimum: 0,
              maximum: 270,
              step: 90,
              value: loaded.rotation.angle,
              action: bind(
                "workspace-file-image-rotation",
                (value) => {
                  if (!mounted.current || !validImageRotation(value)) return;
                  setLoaded((current) =>
                    current?.rotation
                      ? { ...current, rotation: { ...current.rotation, angle: value } }
                      : current,
                  );
                },
                validImageRotation,
              ),
            },
            ...(loaded.rotation.editable
              ? [
                  button(
                    "workspace-file-image-save",
                    t("workspaceEditor.save"),
                    "square.and.arrow.down",
                    save,
                    !saving,
                  ),
                ]
              : []),
          ],
        }
      : null;
  const presentationEditorNode: PresentationNode | null =
    presentationBytes && previewMode === "presentation"
      ? presentationText.loading
        ? {
            id: "workspace-file-pptx-loading",
            kind: "EmptyState",
            icon: "hourglass",
            label: t("workspaceFilePreview.loading"),
          }
        : presentationText.error
          ? {
              id: "workspace-file-pptx-error",
              kind: "Banner",
              status: "error",
              label: presentationText.error,
            }
          : {
              id: "workspace-file-pptx-texts",
              kind: "VStack",
              spacing: 12,
              padding: 12,
              children: presentationText.entries.length
                ? presentationText.entries.map((field) => ({
                    id: `workspace-file-pptx:${field.id}`,
                    kind: "TextInput" as const,
                    label: `${t("workspaceFilePreview.slide")} ${field.slide} · ${field.label}`,
                    value: loaded?.texts?.[field.id] ?? field.text,
                    disabled: !field.editable || loading,
                    action: bind(
                      `workspace-file-pptx:${field.id}`,
                      (value) => {
                        const current = loadedRef.current;
                        if (
                          !current ||
                          current.data !== loaded?.data ||
                          !validPresentationText(value)
                        )
                          return false;
                        const texts = { ...current.texts };
                        if (value === field.text) delete texts[field.id];
                        else texts[field.id] = value;
                        setLoaded({ ...current, texts });
                        return true;
                      },
                      validPresentationText,
                      field.editable && !loading,
                    ),
                  }))
                : [
                    {
                      id: "workspace-file-pptx-empty",
                      kind: "EmptyState",
                      label: t("workspaceFilePreview.empty"),
                    },
                  ],
            }
      : null;
  const contentNode: PresentationNode =
    loading && !loaded
      ? {
          id: "workspace-file-loading",
          kind: "EmptyState",
          icon: "hourglass",
          label:
            activeMode === "preview"
              ? t("workspaceFilePreview.loading")
              : t("workspaceEditor.opening"),
        }
      : presentationEditorNode && previewMode === "presentation"
        ? presentationEditorNode
        : spreadsheet?.error
          ? {
              id: "workspace-file-spreadsheet-error",
              kind: "Banner",
              status: "error",
              label: spreadsheet.error,
            }
          : (spreadsheetNode ??
            (renderedPreview && loaded?.content !== null && loaded?.content !== undefined
              ? {
                  id: "workspace-file-rendered",
                  kind: previewKind === "html" ? "HTMLPreview" : "Markdown",
                  label: basename(loaded.path),
                  text:
                    previewKind === "html"
                      ? buildSandboxedHtmlPreviewSource(loaded.content)
                      : loaded.content,
                  fill: true,
                }
              : mediaPreview && loaded?.data
                ? (imageNode ?? {
                    id: "workspace-file-media",
                    kind: loaded.mimeType === "text/html" ? "HTMLPreview" : "MediaPreview",
                    label: basename(loaded.path),
                    value: loaded.data,
                    language: loaded.mimeType,
                    fill: true,
                  })
                : canEdit && loaded?.content !== null && loaded?.content !== undefined
                  ? {
                      id: "workspace-file-editor",
                      kind: "TextArea",
                      variant: loaded.mode === "editor" ? "workspace-code-editor" : undefined,
                      text:
                        loaded.mode === "editor"
                          ? JSON.stringify({
                              syntax,
                              session: {
                                scope: props.editorScope,
                                key: JSON.stringify([
                                  draftKey,
                                  props.tabs.find((tab) => tab.key === draftKey)?.session,
                                ]),
                                open: props.tabs.map((tab) =>
                                  JSON.stringify([tab.key, tab.session]),
                                ),
                              },
                              ...(codeLocation ?? {}),
                              find: {
                                ...find.current.metadata(findIdentity),
                                labels: {
                                  query: t("workspaceEditor.find"),
                                  replacement: t("workspaceEditor.replace"),
                                  matchCase: t("workspaceEditor.findMatchCase"),
                                  wholeWord: t("workspaceEditor.findWholeWord"),
                                  regex: t("workspaceEditor.findRegex"),
                                  selection: t("workspaceEditor.findSelection"),
                                  preserveCase: t("workspaceEditor.findPreserveCase"),
                                  next: t("workspaceEditor.findNext"),
                                  previous: t("workspaceEditor.findPrevious"),
                                  replace: t("workspaceEditor.replace"),
                                  replaceAll: t("workspaceEditor.replaceAll"),
                                  close: t("common.close"),
                                  invalid: t("workspaceEditor.findInvalidRegex"),
                                  rejected: t("workspaceEditor.findChangedSource"),
                                  noSelection: t("workspaceEditor.findNoSelection"),
                                },
                              },
                              labels: {
                                find: t("workspaceEditor.find"),
                                replace: t("workspaceEditor.replace"),
                                copy: t("workspaceEditor.context.copy"),
                                undo: t("workspaceEditor.context.undo"),
                                redo: t("workspaceEditor.context.redo"),
                              },
                            })
                          : undefined,
                      label: basename(loaded.path),
                      value: loaded.content,
                      language: workspaceCodeLanguage(loaded.path),
                      fill: true,
                      action: bind(
                        "workspace-file-editor",
                        (value) => {
                          if (!mounted.current) return false;
                          syncEditorBaseline();
                          setLoaded((current) =>
                            current ? { ...current, content: value as string } : current,
                          );
                        },
                        (value) => typeof value === "string",
                      ),
                    }
                  : loaded?.content
                    ? {
                        id: "workspace-file-preview-text",
                        kind: previewKind === "markdown" ? "Markdown" : "CodeBlock",
                        label: basename(loaded.path),
                        text: loaded.content,
                        language: workspacePathExtension(loaded.path) || "text",
                        fill: true,
                      }
                    : {
                        id: "workspace-file-empty",
                        kind: "EmptyState",
                        icon: "doc.questionmark",
                        label: t("workspaceFilePreview.renderFailed"),
                      }));

  const runStatus = execution.result ? workspaceEditorRunStatus(execution.result) : null;
  const bulkButton = (
    id: string,
    label: string,
    run: (value: PresentationValue) => unknown,
    enabled = !props.bulk.busy && !loading,
    dialogID?: number,
  ): PresentationNode => ({
    id,
    kind: "Button",
    label,
    variant: "workspace-editor-bulk-action",
    disabled: !enabled,
    current: props.tabs.some((tab) =>
      isFileDirty(draftCache.drafts.get(tab.key) ?? draftCache.editors.get(tab.key)),
    )
      ? 1
      : 0,
    action: bind(
      id,
      (value) =>
        mounted.current &&
        (dialogID === undefined || props.bulk.ownsDialog(dialogID)) &&
        applySourceInput(value)
          ? run(value)
          : false,
      (value) => value === null || !!parseWorkspaceSourceDraft(value),
      enabled,
    ),
  });
  const bulkDialog = props.bulk.dialog;
  const bulkErrorNodes = (scope: string): PresentationNode[] =>
    props.bulk.errors.map((item) => ({
      id: `${scope}:${item.tab.session}`,
      kind: "Banner",
      label: item.tab.request.path,
      text: item.laterEdits
        ? t("workspaceEditor.editedDuringSave")
        : isConflict(item.error)
          ? t("workspaceEditor.conflictMessage")
          : message(item.error, t("workspaceEditor.saveFailed")),
      status: item.laterEdits ? "paused" : "error",
    }));
  const nodes: PresentationNode[] = [
    {
      id: "workspace-file-layout",
      kind: "VStack",
      variant: "workspace-file-layout",
      fill: true,
      children: [
        {
          id: "workspace-file-toolbar",
          kind: "TerminalToolbar",
          variant: "workspace-file-toolbar",
          padding: 10,
          children: [
            {
              id: "workspace-file-title",
              kind: "Heading",
              text: basename(loaded?.path ?? activeRequest.path),
            },
            ...(dirty
              ? [
                  {
                    id: "workspace-file-unsaved",
                    kind: "Badge" as const,
                    label: t("workspaceEditor.unsaved"),
                    status: "running" as const,
                  },
                ]
              : []),
            ...(canEdit || canEditSpreadsheet || presentationBytes || loaded?.rotation?.editable
              ? [
                  button(
                    "workspace-file-save",
                    t("workspaceEditor.save"),
                    "square.and.arrow.down",
                    save,
                    ((canEdit && (loaded?.mode === "editor" || previewMode === "source")) ||
                      Boolean(dirty) ||
                      !!loaded?.rotation?.editable) &&
                      !loading &&
                      !saving &&
                      !pendingEditorWrite,
                  ),
                ]
              : []),
            ...(loaded?.mode === "editor" && runnableWorkspaceFile(loaded.path)
              ? [
                  button(
                    "workspace-file-run",
                    t("workspaceEditor.run"),
                    "play.fill",
                    execution.run,
                    !loading && !execution.busy,
                  ),
                  ...(execution.busy
                    ? [
                        button(
                          "workspace-file-stop",
                          t("workspaceEditor.stopRun"),
                          "stop.fill",
                          execution.stop,
                          !execution.isStopping,
                          false,
                          `workspace-file-stop:${execution.runId}`,
                        ),
                      ]
                    : []),
                ]
              : []),
            button(
              "workspace-file-reload",
              activeMode === "preview"
                ? t("workspaceFilePreview.reload")
                : t("workspaceEditor.reload"),
              "arrow.clockwise",
              requestReload,
              !loading && !saving && !pendingEditorWrite,
            ),
            button(
              "workspace-file-close",
              activeMode === "preview"
                ? t("workspaceFilePreview.close")
                : t("workspaceEditor.closeTab"),
              "xmark",
              requestClose,
              !saving && !pendingEditorWrite,
            ),
            ...(activeMode === "editor"
              ? [
                  bulkButton("workspace-file-save-all", t("workspaceEditor.saveAll"), () =>
                    props.bulk.saveAll(),
                  ),
                  bulkButton("workspace-file-close-all", t("workspaceEditor.closeAll"), () =>
                    props.bulk.requestClose(),
                  ),
                  button(
                    "workspace-file-hide",
                    t("workspaceEditor.close"),
                    "chevron.down",
                    (value) => {
                      if (mounted.current && applySourceInput(value)) props.onHideEditor();
                    },
                  ),
                ]
              : []),
            ...(!compact && loaded
              ? [
                  {
                    id: "workspace-file-open",
                    kind: "Menu" as const,
                    variant: "workspace-file-open",
                    label: t("workspaceFiles.openWith"),
                    text: loaded.path,
                    icon: "arrow.up.forward.app",
                    disabled: fileApplications.opening,
                    options: [
                      ...(fileApplications.loading
                        ? [{ value: "$loading", label: t("common.loading"), disabled: true }]
                        : fileApplications.applications.map((application) => ({
                            value: `app:${application.id}`,
                            label: application.label,
                          }))),
                      { value: "open", label: t("workspaceFiles.defaultApp") },
                      { value: "choose", label: t("workspaceFiles.chooseApp") },
                      {
                        value: "$refresh",
                        label: t("workspaceFiles.refreshApplications"),
                        disabled: fileApplications.loading,
                      },
                      { value: "reveal", label: t("workspaceFiles.revealInFinder") },
                    ],
                    action: bind(
                      "workspace-file-open",
                      (value) =>
                        value === "$refresh"
                          ? fileApplications.load()
                          : fileApplications.open(value),
                      (value) => value === "$refresh" || fileApplications.acceptsMode(value),
                      !fileApplications.opening,
                    ),
                  },
                ]
              : []),
          ],
        },
        ...(tabsNode ? [tabsNode] : []),
        ...(spreadsheet && !spreadsheet.error
          ? [
              {
                id: "workspace-file-sheets",
                kind: "Selector" as const,
                variant: "workspace-file-sheets",
                label: t("workspaceFilePreview.title"),
                value: spreadsheet.activeSheetName,
                options: spreadsheet.sheetNames.map((sheet) => ({ value: sheet, label: sheet })),
                action: bind(
                  "workspace-file-sheets",
                  (value) => {
                    activeSheetRef.current = value as string;
                    setActiveSheet(value as string);
                  },
                  (value) => typeof value === "string" && spreadsheet.sheetNames.includes(value),
                ),
              },
            ]
          : []),
        ...(spreadsheet?.truncatedRows || spreadsheet?.truncatedColumns
          ? [
              {
                id: "workspace-file-spreadsheet-limit",
                kind: "Text" as const,
                text: t("workspaceFilePreview.truncated"),
                secondary: true,
                padding: 10,
              },
            ]
          : []),
        ...(formattedPreview || presentationBytes
          ? [
              {
                id: "workspace-file-view-mode",
                kind: "SegmentedControl" as const,
                label: t("workspaceFilePreview.title"),
                value: previewMode,
                options: [
                  { value: "preview", label: t("workspaceFilePreview.preview") },
                  ...(presentationBytes
                    ? [{ value: "presentation", label: t("workspaceFilePreview.edit") }]
                    : []),
                  ...(formattedPreview
                    ? [
                        {
                          value: "source",
                          label: t(
                            previewKind === "document"
                              ? "workspaceFilePreview.edit"
                              : "workspaceFilePreview.source",
                          ),
                        },
                      ]
                    : []),
                ],
                padding: 10,
                action: bind(
                  "workspace-file-view-mode",
                  (value) => setPreviewMode(value as "preview" | "source" | "presentation"),
                  (value) =>
                    value === "preview" ||
                    (value === "presentation" && !!presentationBytes) ||
                    (value === "source" && !!formattedPreview),
                ),
              },
            ]
          : []),
        {
          id: "workspace-file-path",
          kind: "Text",
          text: loaded?.path ?? activeRequest.path,
          secondary: true,
          padding: 10,
        },
        ...(failure
          ? [
              {
                id: "workspace-file-error",
                kind: "Banner" as const,
                label: failure,
                status: "error" as const,
              },
            ]
          : []),
        ...bulkErrorNodes("workspace-editor-bulk-error"),
        ...(bulkDialog
          ? [
              {
                id: `workspace-editor-close-all:${bulkDialog.id}`,
                kind: "VStack" as const,
                variant: "workspace-editor-close-all",
                label: t("workspaceEditor.closeDirtyTitle"),
                text: t("workspaceEditor.closeDirtyDescription"),
                children: [
                  ...bulkErrorNodes(`workspace-editor-close-error:${bulkDialog.id}`),
                  ...bulkDialog.tabs.map(
                    (tab): PresentationNode => ({
                      id: `workspace-editor-close-file:${tab.session}`,
                      kind: "Text",
                      variant: "workspace-editor-close-file",
                      label: basename(tab.request.path),
                      text: `${tab.request.workdir}/${tab.request.path}`,
                      current: isFileDirty(
                        draftCache.drafts.get(tab.key) ?? draftCache.editors.get(tab.key),
                      )
                        ? 1
                        : 0,
                      accessibilityLabel: `${tab.request.workdir}/${tab.request.path}${isFileDirty(draftCache.drafts.get(tab.key) ?? draftCache.editors.get(tab.key)) ? ` · ${t("workspaceEditor.unsaved")}` : ""}`,
                    }),
                  ),
                  bulkButton(
                    `workspace-editor-bulk-save:${bulkDialog.id}`,
                    t("workspaceEditor.saveAll"),
                    () => props.bulk.saveAll(bulkDialog.id),
                    !props.bulk.busy && !loading,
                    bulkDialog.id,
                  ),
                  bulkButton(
                    `workspace-editor-bulk-discard:${bulkDialog.id}`,
                    t("workspaceEditor.discard"),
                    () => props.bulk.discard(bulkDialog.id),
                    !props.bulk.busy &&
                      !bulkDialog.tabs.some((tab) => draftCache.pendingWrites.has(tab.key)),
                    bulkDialog.id,
                  ),
                  {
                    id: `workspace-editor-bulk-cancel:${bulkDialog.id}`,
                    kind: "Button" as const,
                    variant: "workspace-editor-bulk-action",
                    label: t("common.cancel"),
                    action: bind(
                      `workspace-editor-bulk-cancel:${bulkDialog.id}`,
                      () => mounted.current && props.bulk.cancel(bulkDialog.id),
                      (value) => value === null,
                    ),
                  },
                ],
              },
            ]
          : []),
        ...(confirmation
          ? [
              {
                id: "workspace-file-confirmation",
                kind: "Banner" as const,
                label: pendingImagePathRef.current
                  ? t("workspaceFilePreview.switchImageTitle")
                  : confirmation === "close"
                    ? t("workspaceEditor.closeDirtyTitle")
                    : t("workspaceEditor.reloadDirtyTitle"),
                text: pendingImagePathRef.current
                  ? t("workspaceFilePreview.switchImageDescription")
                  : confirmation === "close"
                    ? t("workspaceEditor.closeDirtyDescription")
                    : t("workspaceEditor.reloadDirtyDescription"),
                status: "paused" as const,
                children: [
                  button(
                    "workspace-file-confirm-save",
                    t("workspaceEditor.save"),
                    "square.and.arrow.down",
                    confirmSave,
                    !saving,
                  ),
                  button(
                    "workspace-file-confirm-discard",
                    t("workspaceEditor.discard"),
                    "trash",
                    confirmDiscard,
                    !saving,
                    true,
                  ),
                  button(
                    "workspace-file-confirm-cancel",
                    t("workspaceEditor.cancel"),
                    "xmark",
                    () => setConfirmation(null),
                    !saving,
                  ),
                ],
              },
            ]
          : []),
        ...(execution.result
          ? [
              {
                id: "workspace-file-run-output",
                kind: "VStack" as const,
                variant: "workspace-editor-run-output",
                label: `${t("workspaceEditor.runOutput")}: ${execution.result.fileName}`,
                current: execution.busy ? 1 : 0,
                value: execution.result.runId,
                children: [
                  {
                    id: "workspace-file-run-status",
                    kind: "Badge" as const,
                    label: execution.busy
                      ? t("workspaceEditor.running")
                      : t(runStatus?.label ?? "workspaceEditor.runFailed"),
                    status: execution.busy
                      ? ("running" as const)
                      : runStatus?.status === "warning"
                        ? ("paused" as const)
                        : runStatus?.status === "success"
                          ? ("completed" as const)
                          : ("error" as const),
                  },
                  {
                    id: "workspace-file-run-source",
                    kind: "Text" as const,
                    text: `${execution.result.target.workdir}/${execution.result.target.path}`,
                    secondary: true,
                  },
                  {
                    id: "workspace-file-run-command",
                    kind: "CodeBlock" as const,
                    language: "shell",
                    text: execution.result.command,
                  },
                  ...(execution.result.error
                    ? [
                        {
                          id: "workspace-file-run-error",
                          kind: "Banner" as const,
                          status: "error" as const,
                          label: execution.result.error,
                        },
                      ]
                    : []),
                  ...(execution.stopError
                    ? [
                        {
                          id: "workspace-file-run-stop-error",
                          kind: "Banner" as const,
                          status: "error" as const,
                          label: execution.stopError,
                        },
                      ]
                    : []),
                  {
                    id: "workspace-file-run-text",
                    kind: "CodeBlock" as const,
                    text: execution.result.output || t("workspaceEditor.noRunOutput"),
                    language: "text",
                    wrap: true,
                    fill: true,
                  },
                  ...(execution.result.exitCode !== undefined
                    ? [
                        {
                          id: "workspace-file-run-exit",
                          kind: "Badge" as const,
                          label: `${t("workspaceEditor.exitCode")}: ${execution.result.exitCode}`,
                        },
                      ]
                    : []),
                  button(
                    "workspace-file-run-result-action",
                    execution.busy
                      ? t("workspaceEditor.stopRun")
                      : t("workspaceEditor.closeRunOutput"),
                    execution.busy ? "stop.fill" : "xmark",
                    execution.busy ? execution.stop : execution.dismiss,
                    !execution.isStopping,
                    false,
                    `workspace-file-run-result-action:${execution.result.runId}:${execution.result.phase}`,
                  ),
                  button(
                    "workspace-file-run-dismiss",
                    t("workspaceEditor.closeRunOutput"),
                    "xmark",
                    execution.dismiss,
                    !execution.busy,
                    false,
                    `workspace-file-run-dismiss:${execution.result.runId}:${execution.result.phase}`,
                  ),
                ],
              },
            ]
          : []),
        ...(findAction ? [findAction] : []),
        contentNode,
        ...(loaded
          ? [
              {
                id: "workspace-file-metadata",
                kind: "HStack" as const,
                variant: "workspace-file-metadata",
                padding: 10,
                children: [
                  {
                    id: "workspace-file-size",
                    kind: "Badge" as const,
                    label: `${loaded.sizeBytes.toLocaleString()} B`,
                  },
                  ...(loaded.totalLines !== undefined
                    ? [
                        {
                          id: "workspace-file-lines",
                          kind: "Badge" as const,
                          label: `${loaded.totalLines} ${t("workspaceEditor.lines")}`,
                        },
                      ]
                    : []),
                ],
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <NativeSurface
      document={{
        ...createNativeWorkspacePanel(t, compact, props.activeRequest.id),
        title:
          activeMode === "preview" ? t("workspaceFilePreview.title") : t("workspaceEditor.title"),
        appearance: props.settings.theme,
        formFactor: compact ? "mobile" : "desktop",
        theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
        nodes,
        dismissAction: "workspace-file-close",
      }}
      handlers={handlers}
      onError={(error) => setFailure(message(error, t("workspaceEditor.openFailed")))}
    />
  );
}
