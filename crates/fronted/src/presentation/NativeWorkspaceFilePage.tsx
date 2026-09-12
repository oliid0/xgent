import { useCallback, useEffect, useState } from "react";
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
  mtimeMs: number;
  contentHash: string;
  totalLines: number;
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
export function NativeWorkspaceFilePage(props: {
  settings: AppSettings;
  editorRequest: WorkspaceCodeEditorOpenRequest | null;
  editorOpen: boolean;
  previewRequest: WorkspaceFilePreviewOpenRequest | null;
  previewOpen: boolean;
  onEditorClose: () => void;
  onPreviewClose: () => void;
}) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const activeRequest = props.previewOpen
    ? props.previewRequest
    : props.editorOpen
      ? props.editorRequest
      : null;
  const activeMode: LoadedFile["mode"] = props.previewOpen ? "preview" : "editor";
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>(null);

  const closeNow = useCallback(() => {
    setConfirmation(null);
    if (activeMode === "preview") props.onPreviewClose();
    else props.onEditorClose();
  }, [activeMode, props.onEditorClose, props.onPreviewClose]);

  const load = useCallback(
    async (
      request: WorkspaceCodeEditorOpenRequest | WorkspaceFilePreviewOpenRequest,
      mode: LoadedFile["mode"],
    ) => {
      setLoading(true);
      setFailure(null);
      try {
        if (mode === "editor") {
          const response = await invokeFs<ReadEditableTextResponse>("fs_read_editable_text", {
            workdir: request.workdir,
            path: request.path,
          });
          setLoaded({
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
          });
        } else {
          const response = await invokeFs<ReadWorkspacePreviewResponse>("fs_read_workspace_image", {
            workdir: request.workdir,
            path: request.path,
          });
          setLoaded({
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
          });
        }
        setConfirmation(null);
      } catch (error) {
        setLoaded(null);
        setFailure(
          message(
            error,
            mode === "preview"
              ? t("workspaceFilePreview.openFailed")
              : t("workspaceEditor.openFailed"),
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!activeRequest) {
      setLoaded(null);
      setFailure(null);
      setConfirmation(null);
      return;
    }
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
    if (!loaded || loaded.content === null || !dirty || saving) return true;
    setSaving(true);
    setFailure(null);
    try {
      let response: WriteTextResponse | undefined;
      if (
        loaded.mode === "preview" &&
        getWorkspacePreviewKind(loaded.path) === "document" &&
        workspacePathExtension(loaded.path) === "docx"
      ) {
        await invokeFs("fs_write_docx_text", {
          workdir: loaded.request.workdir,
          path: loaded.path,
          content: loaded.content,
          expected_mtime_ms: loaded.mtimeMs,
          expected_content_hash: loaded.contentHash,
        });
      } else {
        response = await invokeFs<WriteTextResponse>("fs_write_text", {
          workdir: loaded.request.workdir,
          path: loaded.path,
          content: loaded.content,
          mode: "rewrite",
          expected_mtime_ms: loaded.mtimeMs,
          expected_content_hash: loaded.contentHash,
        });
      }
      if (response) {
        setLoaded((current) =>
          current
            ? {
                ...current,
                savedContent: current.content,
                mtimeMs: response.mtimeMs,
                contentHash: response.contentHash,
                totalLines: response.totalLines,
              }
            : current,
        );
      } else {
        await load(loaded.request, loaded.mode);
      }
      return true;
    } catch (error) {
      setFailure(
        isConflict(error)
          ? t("workspaceEditor.conflictMessage")
          : message(error, t("workspaceEditor.saveFailed")),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, load, loaded, saving, t]);

  const requestClose = () => {
    if (dirty) setConfirmation("close");
    else closeNow();
  };
  const requestReload = () => {
    if (!loaded) return;
    if (dirty) setConfirmation("reload");
    else void load(loaded.request, loaded.mode);
  };
  const confirmSave = async () => {
    const pending = confirmation;
    if (!(await save())) return;
    setConfirmation(null);
    if (pending === "close") closeNow();
  };
  const confirmDiscard = () => {
    const pending = confirmation;
    setConfirmation(null);
    if (pending === "close") closeNow();
    else if (pending === "reload" && loaded) void load(loaded.request, loaded.mode);
  };

  if (!activeRequest) return null;

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
    loaded && ["image", "pdf", "audio", "video"].includes(previewKind ?? ""),
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
