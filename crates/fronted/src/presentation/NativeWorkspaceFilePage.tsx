import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceCodeEditorOpenRequest } from "../components/workspace-editor/WorkspaceCodeEditorOverlay";
import type { WorkspaceFilePreviewOpenRequest } from "../components/workspace-editor/WorkspaceFilePreviewOverlay";
import {
  getWorkspacePreviewKind,
  isWorkspaceEditablePreviewPath,
  workspacePathExtension,
} from "../components/workspace-editor/workspaceImagePreview";
import { useLocale } from "../i18n";
import { isNativeMobileRuntime } from "../lib/runtimePlatform";
import type { AppSettings } from "../lib/settings";
import { invokeFs, isFsBackendError } from "../lib/tools/fsBackend";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

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
};

type PendingConfirmation = "close" | "reload" | null;

type FileDraft = Pick<LoadedFile, "content" | "savedContent" | "mtimeMs" | "contentHash">;
type FileDraftCache = {
  drafts: Map<string, FileDraft>;
  pendingWrites: Map<string, Promise<void>>;
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

/**
 * Native file viewer/editor. Reads and writes through the same guarded Rust FS
 * commands as the Astryx editor; only the visible presentation is SwiftUI.
 */
type NativeWorkspaceFilePageProps = {
  settings: AppSettings;
  editorRequest: WorkspaceCodeEditorOpenRequest | null;
  editorOpen: boolean;
  previewRequest: WorkspaceFilePreviewOpenRequest | null;
  previewOpen: boolean;
  onEditorClose: () => void;
  onPreviewClose: () => void;
};

export function NativeWorkspaceFilePage(props: NativeWorkspaceFilePageProps) {
  // File views have separate lifetimes; unsaved text belongs to the workspace.
  // Keep no media bytes here and do not evict another file's unsaved edits.
  const cache = useRef<FileDraftCache>({ drafts: new Map(), pendingWrites: new Map() });
  const activeRequest = props.previewOpen
    ? props.previewRequest
    : props.editorOpen
      ? props.editorRequest
      : null;
  const activeMode: LoadedFile["mode"] = props.previewOpen ? "preview" : "editor";
  if (!activeRequest) return null;
  return (
    <NativeWorkspaceFileSession
      key={JSON.stringify([
        activeMode,
        activeRequest.id,
        activeRequest.projectPathKey,
        activeRequest.workdir,
        activeRequest.path,
      ])}
      {...props}
      activeRequest={activeRequest}
      activeMode={activeMode}
      draftKey={JSON.stringify([
        activeRequest.projectPathKey,
        activeRequest.workdir,
        activeRequest.path,
      ])}
      draftCache={cache.current}
    />
  );
}

function NativeWorkspaceFileSession(
  props: NativeWorkspaceFilePageProps & {
    activeRequest: WorkspaceCodeEditorOpenRequest | WorkspaceFilePreviewOpenRequest;
    activeMode: LoadedFile["mode"];
    draftKey: string;
    draftCache: FileDraftCache;
  },
) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const initialRequest = useRef({ ...props.activeRequest });
  const activeRequest = initialRequest.current;
  const activeMode = props.activeMode;
  const { draftCache, draftKey } = props;
  const locale = useRef(t);
  locale.current = t;
  const [loaded, setLoadedState] = useState<LoadedFile | null>(null);
  const loadedRef = useRef<LoadedFile | null>(null);
  const setLoaded = useCallback(
    (next: LoadedFile | null | ((current: LoadedFile | null) => LoadedFile | null)) => {
      const value = typeof next === "function" ? next(loadedRef.current) : next;
      loadedRef.current = value;
      if (value?.content !== null && value?.content !== undefined) {
        if (value.content !== value.savedContent || draftCache.pendingWrites.has(draftKey)) {
          draftCache.drafts.set(draftKey, {
            content: value.content,
            savedContent: value.savedContent,
            mtimeMs: value.mtimeMs,
            contentHash: value.contentHash,
          });
        } else {
          draftCache.drafts.delete(draftKey);
        }
      }
      setLoadedState(value);
    },
    [draftCache, draftKey],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const readGeneration = useRef(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>(null);

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
  }, [activeMode, props.onEditorClose, props.onPreviewClose]);

  const load = useCallback(
    async (
      request: WorkspaceCodeEditorOpenRequest | WorkspaceFilePreviewOpenRequest,
      mode: LoadedFile["mode"],
    ) => {
      const generation = ++readGeneration.current;
      const current = () => mounted.current && generation === readGeneration.current;
      setLoading(true);
      setFailure(null);
      setLoaded(null);
      try {
        // Reopening the same file waits for its previous session's write and
        // reads the final version. Other files remain independently usable.
        await draftCache.pendingWrites.get(draftKey);
        if (!current()) return;
        const restoreDraft = (file: LoadedFile): LoadedFile => {
          const draft = draftCache.drafts.get(draftKey);
          if (!draft || file.content === null || draft.content === file.content) return file;
          if (draft.contentHash !== file.contentHash) {
            setFailure(locale.current("workspaceEditor.conflictMessage"));
          }
          // An external edit must still fail the original optimistic write guard.
          return { ...file, ...draft };
        };
        if (mode === "editor" || isWorkspaceEditablePreviewPath(request.path)) {
          const response = await invokeFs<ReadEditableTextResponse>("fs_read_editable_text", {
            workdir: request.workdir,
            path: request.path,
          });
          if (!current()) return;
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
          if (!current()) return;
          setLoaded(
            restoreDraft({
              request,
              mode,
              path: response.path || request.path,
              mimeType: response.mimeType,
              data: response.data,
              content: response.content ?? null,
              savedContent: response.content ?? null,
              mtimeMs: response.mtimeMs,
              contentHash: response.contentHash,
              sizeBytes: response.sizeBytes,
            }),
          );
        }
        setConfirmation(null);
      } catch (error) {
        if (!current()) return;
        setLoaded(null);
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
    [draftCache, draftKey, setLoaded],
  );

  useEffect(() => {
    void load(activeRequest, activeMode);
  }, [activeMode, activeRequest, load]);

  const dirty = loaded?.content !== loaded?.savedContent;
  const editablePreview = Boolean(
    loaded?.mode === "preview" &&
      (isWorkspaceEditablePreviewPath(loaded.path) ||
        (getWorkspacePreviewKind(loaded.path) === "document" &&
          workspacePathExtension(loaded.path) === "docx")),
  );
  const canEdit = loaded?.mode === "editor" || editablePreview;

  const save = useCallback(async () => {
    if (savingRef.current || !mounted.current) return false;
    const snapshot = loadedRef.current;
    if (!snapshot || snapshot.content === null || snapshot.content === snapshot.savedContent)
      return true;
    savingRef.current = true;
    let finishWrite = () => {};
    const completion = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    draftCache.pendingWrites.set(draftKey, completion);
    setSaving(true);
    setFailure(null);
    try {
      let response: WriteTextResponse | WriteDocumentResponse;
      if (
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
      if (draft) {
        if (draft.content === snapshot.content) draftCache.drafts.delete(draftKey);
        else {
          draftCache.drafts.set(draftKey, {
            ...draft,
            savedContent: snapshot.content,
            mtimeMs: response.mtimeMs,
            contentHash: response.contentHash,
          });
        }
      }
      if (!mounted.current) return false;
      setLoaded((current) =>
        current
          ? {
              ...current,
              savedContent: snapshot.content,
              mtimeMs: response.mtimeMs,
              contentHash: response.contentHash,
              totalLines: "totalLines" in response ? response.totalLines : current.totalLines,
              sizeBytes: response.bytesWritten,
            }
          : current,
      );
      return loadedRef.current?.content === loadedRef.current?.savedContent;
    } catch (error) {
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
      if (draft && draft.content === draft.savedContent) draftCache.drafts.delete(draftKey);
      finishWrite();
      if (mounted.current) setSaving(false);
    }
  }, [draftCache, draftKey, setLoaded, t]);

  const requestClose = () => {
    if (savingRef.current) return;
    if (dirty) setConfirmation("close");
    else closeNow();
  };
  const requestReload = () => {
    if (!loaded || savingRef.current || loading) return;
    if (dirty) setConfirmation("reload");
    else void load(loaded.request, loaded.mode);
  };
  const confirmSave = async () => {
    const pending = confirmation;
    if (!(await save())) return;
    if (!mounted.current) return;
    setConfirmation(null);
    if (pending === "close") closeNow();
    else if (pending === "reload" && loadedRef.current) {
      await load(loadedRef.current.request, loadedRef.current.mode);
    }
  };
  const confirmDiscard = () => {
    if (savingRef.current) return;
    const pending = confirmation;
    draftCache.drafts.delete(draftKey);
    setConfirmation(null);
    if (pending === "close") closeNow();
    else if (pending === "reload" && loaded) void load(loaded.request, loaded.mode);
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
  const button = (
    id: string,
    label: string,
    icon: string,
    run: () => unknown,
    enabled = true,
    destructive = false,
  ): PresentationNode => ({
    id,
    kind: "Button",
    label,
    icon,
    disabled: !enabled,
    destructive,
    action: bind(id, run, (value) => value === null, enabled),
  });
  const previewKind = loaded ? getWorkspacePreviewKind(loaded.path) : null;
  const mediaPreview = Boolean(
    loaded &&
      (["image", "pdf", "audio", "video"].includes(previewKind ?? "") ||
        (compact &&
          (previewKind === "spreadsheet" ||
            previewKind === "presentation" ||
            (previewKind === "document" && workspacePathExtension(loaded.path) !== "docx")))),
  );
  const contentNode: PresentationNode = loading
    ? {
        id: "workspace-file-loading",
        kind: "EmptyState",
        icon: "hourglass",
        label:
          activeMode === "preview"
            ? t("workspaceFilePreview.loading")
            : t("workspaceEditor.opening"),
      }
    : mediaPreview && loaded?.data
      ? {
          id: "workspace-file-media",
          kind: "MediaPreview",
          label: basename(loaded.path),
          value: loaded.data,
          language: loaded.mimeType,
          fill: true,
        }
      : canEdit && loaded?.content !== null && loaded?.content !== undefined
        ? {
            id: "workspace-file-editor",
            kind: "TextArea",
            label: basename(loaded.path),
            value: loaded.content,
            language: workspacePathExtension(loaded.path) || "text",
            fill: true,
            action: bind(
              "workspace-file-editor",
              (value) =>
                setLoaded((current) =>
                  current ? { ...current, content: value as string } : current,
                ),
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
            };

  const nodes: PresentationNode[] = [
    {
      id: "workspace-file-layout",
      kind: "BrowserLayout",
      fill: true,
      children: [
        {
          id: "workspace-file-toolbar",
          kind: "HStack",
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
            { id: "workspace-file-spacer", kind: "Spacer" },
            ...(canEdit
              ? [
                  button(
                    "workspace-file-save",
                    t("workspaceEditor.save"),
                    "square.and.arrow.down",
                    save,
                    Boolean(dirty) && !saving,
                  ),
                ]
              : []),
            button(
              "workspace-file-reload",
              activeMode === "preview"
                ? t("workspaceFilePreview.reload")
                : t("workspaceEditor.reload"),
              "arrow.clockwise",
              requestReload,
              !loading && !saving,
            ),
            button(
              "workspace-file-close",
              activeMode === "preview"
                ? t("workspaceFilePreview.close")
                : t("workspaceEditor.close"),
              "xmark",
              requestClose,
              !saving,
            ),
          ],
        },
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
        ...(confirmation
          ? [
              {
                id: "workspace-file-confirmation",
                kind: "Banner" as const,
                label:
                  confirmation === "close"
                    ? t("workspaceEditor.closeDirtyTitle")
                    : t("workspaceEditor.reloadDirtyTitle"),
                text:
                  confirmation === "close"
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
        contentNode,
        ...(loaded
          ? [
              {
                id: "workspace-file-metadata",
                kind: "HStack" as const,
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
        mode: "root",
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
