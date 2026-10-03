import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useMediaQuery } from "@astryxdesign/core/hooks";
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
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { invoke } from "@xgent/runtime";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import {
  type CodeMentionReference,
  createCodeMentionReference,
} from "../../lib/chat/messages/mentionReferences";
import { invokeFs, isFsBackendError } from "../../lib/tools/fsBackend";
import { AdaptiveDialog } from "../astryx/AdaptiveDialog";
import {
  Copy,
  FilePenLine,
  MessageSquareText,
  RefreshCw,
  Replace,
  Save,
  Search,
  X,
} from "../icons";
import { MacOsTitleBarSpacer } from "../MacOsTitleBarSpacer";
import { workspaceCodeLanguage } from "./workspaceCodeLanguage";
import { workspaceCodeLocation } from "./workspaceCodeLocation";
import { runnableWorkspaceFile, workspaceEditorRunStatus } from "./workspaceEditorRun";
import { isWorkspacePreviewPath } from "./workspaceImagePreview";

type MonacoEnvironmentGlobal = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker;
  };
};

const monacoGlobal = globalThis as MonacoEnvironmentGlobal;

if (!monacoGlobal.MonacoEnvironment) {
  monacoGlobal.MonacoEnvironment = {
    getWorker(_workerId, label) {
      if (label === "json") return new JsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new CssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new HtmlWorker();
      }
      if (label === "typescript" || label === "javascript") return new TsWorker();
      return new EditorWorker();
    },
  };
}

export type WorkspaceCodeEditorOpenRequest = {
  id: number;
  projectPathKey: string;
  workdir: string;
  path: string;
  line?: number;
  endLine?: number;
  column?: number;
};

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

type ShellRunResponse = {
  exit_code?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
  timed_out?: boolean;
  timedOut?: boolean;
  cancelled: boolean;
};

type EditorRunResult = {
  fileName: string;
  command: string;
  phase: "running" | "complete" | "failed";
  output: string;
  exitCode?: number;
  error?: string;
  timedOut?: boolean;
  cancelled?: boolean;
};

type EditorTabStatus = "ready" | "saving" | "conflict";

type EditorTab = {
  key: string;
  session: number;
  editVersion: number;
  projectPathKey: string;
  workdir: string;
  path: string;
  content: string;
  savedContent: string;
  mtimeMs: number;
  contentHash: string;
  sizeBytes: number;
  totalLines: number;
  language: string;
  status: EditorTabStatus;
  error: string | null;
};

type PendingDialog =
  | { kind: "closeOverlay" }
  | { kind: "closeTab"; tabKey: string; session: number }
  | { kind: "reloadTab"; tabKey: string; session: number };

// A reopened editor waits for an already requested write instead of reading its old bytes.
const editorPendingWrites = new Map<string, Promise<void>>();

const EDITOR_OVERLAY_ANIMATION_MS = 180;

type WorkspaceCodeEditorOverlayProps = {
  openRequest: WorkspaceCodeEditorOpenRequest | null;
  closeRequestId?: number;
  isOpen: boolean;
  finalCloseRequested?: boolean;
  theme: "light" | "dark";
  onPreviewFile: (request: WorkspaceCodeEditorOpenRequest) => void;
  onInsertCodeMention?: (reference: CodeMentionReference) => void;
  onHide: () => void;
  onClose: () => void;
};

function editorTabKey(projectPathKey: string, path: string, workdir: string) {
  return JSON.stringify([projectPathKey, workdir, path]);
}

function basename(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function dirname(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function languageForPath(path: string) {
  return workspaceCodeLanguage(path);
}

function isVersionConflict(error: unknown) {
  if (
    isFsBackendError(error) &&
    (error.code === "stale_file" || error.code === "requires_full_read")
  )
    return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("File changed since the last full Read");
}

function toMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  const text = String(error ?? "").trim();
  return text || fallback;
}

function editorModelUri(tabKey: string) {
  const bytes = new TextEncoder().encode(tabKey);
  let hexKey = "";
  for (const byte of bytes) {
    hexKey += byte.toString(16).padStart(2, "0");
  }
  return monaco.Uri.from({
    scheme: "xgent-editor",
    authority: "model",
    path: `/${hexKey}`,
  });
}

export function WorkspaceCodeEditorOverlay(props: WorkspaceCodeEditorOverlayProps) {
  const {
    openRequest,
    closeRequestId,
    isOpen,
    finalCloseRequested = false,
    theme,
    onPreviewFile,
    onInsertCodeMention,
    onHide,
    onClose,
  } = props;
  const { t } = useLocale();
  const isNarrow = useMediaQuery("(max-width: 768px)");
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const editorModelKeyRef = useRef("");
  const activeKeyRef = useRef("");
  const openRequestIdRef = useRef<number | null>(null);
  const revealedLocationRequestIdRef = useRef<number | null>(null);
  const closeRequestIdRef = useRef<number | null>(null);
  const openAnimationFrameRef = useRef<number | null>(null);
  const closeAnimationTimeoutRef = useRef<number | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const stoppingRunRef = useRef<{ id: string; lifetime: number } | null>(null);
  const initialThemeRef = useRef(theme);
  const [tabs, renderTabs] = useState<EditorTab[]>([]);
  const tabsRef = useRef<EditorTab[]>([]);
  const setTabs = useCallback((update: EditorTab[] | ((tabs: EditorTab[]) => EditorTab[])) => {
    const next = typeof update === "function" ? update(tabsRef.current) : update;
    tabsRef.current = next;
    renderTabs(next);
  }, []);
  const mountedRef = useRef(false);
  const lifetimeRef = useRef(0);
  const tabSequenceRef = useRef(0);
  const requestedKeyRef = useRef("");
  const readsRef = useRef(new Map<string, object>());
  const writesRef = useRef(new Map<number, Promise<boolean>>());
  const [activeKey, setActiveKey] = useState("");
  const [openingPaths, setOpeningPaths] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pendingDialog, renderDialog] = useState<PendingDialog | null>(null);
  const dialogRef = useRef<PendingDialog | null>(null);
  const setPendingDialog = useCallback(
    (update: PendingDialog | null | ((dialog: PendingDialog | null) => PendingDialog | null)) => {
      const next = typeof update === "function" ? update(dialogRef.current) : update;
      dialogRef.current = next;
      renderDialog(next);
    },
    [],
  );
  const savingDialogRef = useRef<PendingDialog | null>(null);
  const [savingDialog, setSavingDialog] = useState(false);
  const [isRunningFile, setIsRunningFile] = useState(false);
  const [isStoppingFile, setIsStoppingFile] = useState(false);
  const [runResult, renderRunResult] = useState<EditorRunResult | null>(null);
  const runResultRef = useRef<EditorRunResult | null>(null);
  const setRunResult = useCallback((next: EditorRunResult | null) => {
    runResultRef.current = next;
    renderRunResult(next);
  }, []);
  const [runCancelError, setRunCancelError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.key === activeKey) ?? tabs[0] ?? null,
    [activeKey, tabs],
  );
  const canPreviewActiveTab = Boolean(activeTab && isWorkspacePreviewPath(activeTab.path));
  const activeRunnableFile = activeTab ? runnableWorkspaceFile(activeTab.path) : null;
  const runStatus = runResult ? workspaceEditorRunStatus(runResult) : null;
  const isOpening = openingPaths.length > 0;
  const currentTab = useCallback(
    (tab: EditorTab | null | undefined) =>
      !!tab &&
      mountedRef.current &&
      tabsRef.current.some((item) => item.key === tab.key && item.session === tab.session),
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    activeRunIdRef.current = null;
    stoppingRunRef.current = null;
    setIsRunningFile(false);
    setIsStoppingFile(false);
    setRunResult(null);
    setRunCancelError(null);
    lifetimeRef.current++;
    openAnimationFrameRef.current = window.requestAnimationFrame(() => {
      openAnimationFrameRef.current = null;
      setIsVisible(true);
    });
    return () => {
      mountedRef.current = false;
      lifetimeRef.current++;
      readsRef.current.clear();
      openRequestIdRef.current = null;
      if (openAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(openAnimationFrameRef.current);
      }
      if (closeAnimationTimeoutRef.current !== null) {
        window.clearTimeout(closeAnimationTimeoutRef.current);
      }
    };
  }, [setRunResult]);

  const cancelPendingClose = useCallback(() => {
    if (closeAnimationTimeoutRef.current === null) return;
    window.clearTimeout(closeAnimationTimeoutRef.current);
    closeAnimationTimeoutRef.current = null;
    setIsVisible(true);
  }, []);

  const finishHide = useCallback(() => {
    if (closeAnimationTimeoutRef.current !== null) return;
    setIsVisible(false);
    closeAnimationTimeoutRef.current = window.setTimeout(() => {
      closeAnimationTimeoutRef.current = null;
      if (mountedRef.current) onHide();
    }, EDITOR_OVERLAY_ANIMATION_MS);
  }, [onHide]);

  const finishClose = useCallback(
    (discard = false) => {
      if (discard) {
        // Read-only requests may finish in the background, but cannot reopen a discarded editor.
        readsRef.current.clear();
        requestedKeyRef.current = "";
        setOpeningPaths([]);
      }
      if (closeAnimationTimeoutRef.current !== null) {
        window.clearTimeout(closeAnimationTimeoutRef.current);
        closeAnimationTimeoutRef.current = null;
      }
      setIsVisible(false);
      const discardedVersions = new Map(
        tabsRef.current.map((tab) => [tab.session, tab.editVersion]),
      );
      closeAnimationTimeoutRef.current = window.setTimeout(() => {
        closeAnimationTimeoutRef.current = null;
        if (!mountedRef.current) return;
        // Typing/opening a file during the exit animation must not bypass confirmation.
        const changed = tabsRef.current.some((tab) =>
          discard
            ? discardedVersions.get(tab.session) !== tab.editVersion
            : tab.content !== tab.savedContent || writesRef.current.has(tab.session),
        );
        if (changed || readsRef.current.size) {
          setIsVisible(true);
          setPendingDialog({ kind: "closeOverlay" });
          return;
        }
        onClose();
      }, EDITOR_OVERLAY_ANIMATION_MS);
    },
    [onClose, setPendingDialog],
  );

  const updateTab = useCallback(
    (tabKey: string, updater: (tab: EditorTab) => EditorTab, session?: number) => {
      if (!mountedRef.current) return;
      setTabs((current) =>
        current.map((tab) =>
          tab.key === tabKey && (session === undefined || tab.session === session)
            ? updater(tab)
            : tab,
        ),
      );
    },
    [setTabs],
  );

  const disposeModel = useCallback((tabKey: string) => {
    const model = modelsRef.current.get(tabKey);
    if (model) {
      if (editorRef.current?.getModel() === model) {
        editorRef.current.setModel(null);
      }
      model.dispose();
      modelsRef.current.delete(tabKey);
    }
    if (editorModelKeyRef.current === tabKey) {
      editorModelKeyRef.current = "";
    }
    viewStatesRef.current.delete(tabKey);
  }, []);

  const saveTab = useCallback(
    async (tabKey: string, session?: number) => {
      const tab = tabsRef.current.find(
        (item) => item.key === tabKey && (session === undefined || item.session === session),
      );
      if (!currentTab(tab)) return false;
      if (!tab) return false;
      const pending = writesRef.current.get(tab.session);
      if (pending) return pending;
      if (readsRef.current.has(tab.key)) return false;
      if (tab.content === tab.savedContent) return true;
      if (tab.status === "conflict") {
        const message = tab.error ?? t("workspaceEditor.conflictMessage");
        setGlobalError(message);
        return false;
      }

      const contentToSave = tab.content;
      updateTab(tabKey, (current) => ({ ...current, status: "saving", error: null }), tab.session);
      const write = Promise.resolve().then(async () => {
        try {
          const response = await invokeFs<WriteTextResponse>("fs_write_text", {
            workdir: tab.workdir,
            path: tab.path,
            content: contentToSave,
            mode: "rewrite",
            expected_mtime_ms: tab.mtimeMs,
            expected_content_hash: tab.contentHash,
          });
          if (!currentTab(tab)) return false;
          updateTab(
            tabKey,
            (current) => ({
              ...current,
              savedContent: contentToSave,
              mtimeMs: response.mtimeMs,
              contentHash: response.contentHash,
              totalLines:
                current.content === contentToSave ? response.totalLines : current.totalLines,
              sizeBytes: new TextEncoder().encode(current.content).length,
              status: "ready",
              error: null,
            }),
            tab.session,
          );
          if (activeKeyRef.current === tabKey) setGlobalError(null);
          const acknowledged = tabsRef.current.find((item) => item.session === tab.session);
          return !!acknowledged && acknowledged.content === acknowledged.savedContent;
        } catch (error) {
          if (!currentTab(tab)) return false;
          const conflict = isVersionConflict(error);
          const message = conflict
            ? t("workspaceEditor.conflictMessage")
            : toMessage(error, t("workspaceEditor.saveFailed"));
          updateTab(
            tabKey,
            (current) => ({
              ...current,
              status: conflict ? "conflict" : "ready",
              error: message,
            }),
            tab.session,
          );
          if (activeKeyRef.current === tabKey) setGlobalError(message);
          return false;
        } finally {
          writesRef.current.delete(tab.session);
        }
      });
      writesRef.current.set(tab.session, write);
      const barrier = write.then(() => undefined);
      editorPendingWrites.set(tab.key, barrier);
      void barrier.finally(() => {
        if (editorPendingWrites.get(tab.key) === barrier) editorPendingWrites.delete(tab.key);
      });
      return write;
    },
    [currentTab, t, updateTab],
  );

  const runActiveFile = useCallback(async () => {
    const tab = activeTab && tabsRef.current.find((item) => item.session === activeTab.session);
    const runnable = tab ? runnableWorkspaceFile(tab.path) : null;
    if (
      !tab ||
      !currentTab(tab) ||
      activeKeyRef.current !== tab.key ||
      !runnable ||
      activeRunIdRef.current
    )
      return;
    const runId = `workspace-editor-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    activeRunIdRef.current = runId;
    const lifetime = lifetimeRef.current;
    const valid = () =>
      mountedRef.current && lifetimeRef.current === lifetime && activeRunIdRef.current === runId;
    setIsRunningFile(true);
    setRunResult(null);
    stoppingRunRef.current = null;
    setIsStoppingFile(false);
    try {
      const saved = await saveTab(tab.key, tab.session);
      if (!saved || !valid() || !currentTab(tab)) return;
      setRunResult({
        fileName: runnable.fileName,
        command: runnable.command,
        phase: "running",
        output: "",
      });
      setRunCancelError(null);
      const response = await invoke<ShellRunResponse>("shell_run", {
        workdir: tab.workdir,
        command: runnable.command,
        cwd: runnable.cwd,
        timeout_ms: 120_000,
        max_timeout_ms: 1_800_000,
        provider_id: null,
        run_id: runId,
        sandbox: false,
        sandbox_allow_network: true,
      });
      if (!valid()) return;
      const exitCode = response.exitCode ?? response.exit_code;
      const output = [response.stdout, response.stderr ? `[stderr]\n${response.stderr}` : ""]
        .filter(Boolean)
        .join("\n");
      setRunResult({
        fileName: runnable.fileName,
        command: runnable.command,
        phase: "complete",
        output,
        exitCode,
        timedOut: response.timedOut ?? response.timed_out,
        cancelled: response.cancelled,
      });
    } catch (error) {
      if (!valid()) return;
      setRunResult({
        fileName: runnable.fileName,
        command: runnable.command,
        phase: "failed",
        output: "",
        error: toMessage(error, t("workspaceEditor.runFailed")),
      });
    } finally {
      if (activeRunIdRef.current === runId) {
        activeRunIdRef.current = null;
        stoppingRunRef.current = null;
        if (mountedRef.current && lifetimeRef.current === lifetime) {
          setIsRunningFile(false);
          setIsStoppingFile(false);
        }
      }
    }
  }, [activeTab, currentTab, saveTab, t, setRunResult]);

  const stopActiveFile = useCallback(() => {
    const runId = activeRunIdRef.current;
    if (!mountedRef.current || !runId || stoppingRunRef.current) return;
    const token = { id: runId, lifetime: lifetimeRef.current };
    stoppingRunRef.current = token;
    setIsStoppingFile(true);
    setRunCancelError(null);
    // `cancelled: false` also means the run has not registered yet; the backend
    // remembers this request until registration, so only an IPC error is a failure.
    void invoke("shell_cancel", { run_id: runId })
      .catch((error) => {
        if (
          mountedRef.current &&
          lifetimeRef.current === token.lifetime &&
          activeRunIdRef.current === runId
        ) {
          setRunCancelError(toMessage(error, t("workspaceEditor.stopRunFailed")));
        }
      })
      .finally(() => {
        if (stoppingRunRef.current !== token) return;
        stoppingRunRef.current = null;
        if (mountedRef.current && lifetimeRef.current === token.lifetime) setIsStoppingFile(false);
      });
  }, [t]);

  const readTab = useCallback(
    async (request: WorkspaceCodeEditorOpenRequest) => {
      if (!mountedRef.current) return;
      const key = editorTabKey(request.projectPathKey, request.path, request.workdir);
      requestedKeyRef.current = key;
      const existing = tabsRef.current.find((tab) => tab.key === key);
      if (existing) {
        activeKeyRef.current = key;
        setActiveKey(key);
        setGlobalError(null);
        return;
      }
      if (readsRef.current.has(key)) return;
      const token = {},
        lifetime = lifetimeRef.current;
      readsRef.current.set(key, token);
      const valid = () =>
        mountedRef.current &&
        lifetimeRef.current === lifetime &&
        readsRef.current.get(key) === token;
      setOpeningPaths((current) => [...current.filter((item) => item !== key), key]);
      setGlobalError(null);
      try {
        await editorPendingWrites.get(key);
        if (!valid()) return;
        const response = await invokeFs<ReadEditableTextResponse>("fs_read_editable_text", {
          workdir: request.workdir,
          path: request.path,
        });
        if (!valid()) return;
        const nextTab: EditorTab = {
          key,
          session: ++tabSequenceRef.current,
          editVersion: 0,
          projectPathKey: request.projectPathKey,
          workdir: request.workdir,
          path: response.path,
          content: response.content,
          savedContent: response.content,
          mtimeMs: response.mtimeMs,
          contentHash: response.contentHash,
          sizeBytes: response.sizeBytes,
          totalLines: response.totalLines,
          language: languageForPath(response.path),
          status: "ready",
          error: null,
        };
        setTabs((current) => {
          if (current.some((tab) => tab.key === key)) return current;
          return [...current, nextTab];
        });
        if (requestedKeyRef.current === key) {
          activeKeyRef.current = key;
          setActiveKey(key);
        }
      } catch (error) {
        if (valid() && requestedKeyRef.current === key)
          setGlobalError(toMessage(error, t("workspaceEditor.openFailed")));
      } finally {
        if (readsRef.current.get(key) === token) {
          readsRef.current.delete(key);
          if (mountedRef.current)
            setOpeningPaths((current) => current.filter((item) => item !== key));
        }
      }
    },
    [setTabs, t],
  );

  const reloadTab = useCallback(
    async (tabKey: string, session?: number) => {
      const tab = tabsRef.current.find(
        (item) => item.key === tabKey && (session === undefined || item.session === session),
      );
      if (
        !tab ||
        !currentTab(tab) ||
        readsRef.current.has(tabKey) ||
        writesRef.current.has(tab.session)
      )
        return false;
      const token = {},
        version = tab.editVersion;
      readsRef.current.set(tabKey, token);
      const valid = () =>
        currentTab(tab) &&
        readsRef.current.get(tabKey) === token &&
        tabsRef.current.find((item) => item.session === tab.session)?.editVersion === version;
      setOpeningPaths((current) => [...current.filter((item) => item !== tabKey), tabKey]);
      setGlobalError(null);
      try {
        await editorPendingWrites.get(tabKey);
        if (!valid()) return false;
        const response = await invokeFs<ReadEditableTextResponse>("fs_read_editable_text", {
          workdir: tab.workdir,
          path: tab.path,
        });
        if (!valid()) return false;
        updateTab(
          tabKey,
          (current) => ({
            ...current,
            path: response.path,
            content: response.content,
            savedContent: response.content,
            mtimeMs: response.mtimeMs,
            contentHash: response.contentHash,
            sizeBytes: response.sizeBytes,
            totalLines: response.totalLines,
            language: languageForPath(response.path),
            status: "ready",
            error: null,
          }),
          tab.session,
        );
        const model = modelsRef.current.get(tabKey);
        if (model && model.getValue() !== response.content) model.setValue(response.content);
        return true;
      } catch (error) {
        if (!valid()) return false;
        const message = toMessage(error, t("workspaceEditor.reloadFailed"));
        updateTab(tabKey, (current) => ({ ...current, error: message }), tab.session);
        if (activeKeyRef.current === tabKey) setGlobalError(message);
        return false;
      } finally {
        if (readsRef.current.get(tabKey) === token) {
          readsRef.current.delete(tabKey);
          if (mountedRef.current)
            setOpeningPaths((current) => current.filter((item) => item !== tabKey));
        }
      }
    },
    [currentTab, t, updateTab],
  );

  const closeTabNow = useCallback(
    (tabKey: string, session?: number) => {
      const tab = tabsRef.current.find(
        (item) => item.key === tabKey && (session === undefined || item.session === session),
      );
      if (!currentTab(tab)) return;
      readsRef.current.delete(tabKey);
      setOpeningPaths((current) => current.filter((item) => item !== tabKey));
      disposeModel(tabKey);
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.key === tabKey);
        if (index < 0) return current;
        const next = current.filter((tab) => tab.key !== tabKey);
        if (activeKeyRef.current === tabKey) {
          const key = next[Math.min(index, next.length - 1)]?.key ?? "";
          activeKeyRef.current = key;
          setActiveKey(key);
        }
        return next;
      });
    },
    [currentTab, disposeModel, setTabs],
  );

  const requestCloseTab = useCallback(
    (tabKey: string, session?: number) => {
      const tab = tabsRef.current.find(
        (item) => item.key === tabKey && (session === undefined || item.session === session),
      );
      if (!tab || !currentTab(tab)) return;
      if (tab.content !== tab.savedContent || writesRef.current.has(tab.session)) {
        setPendingDialog({ kind: "closeTab", tabKey, session: tab.session });
        return;
      }
      closeTabNow(tabKey, tab.session);
    },
    [closeTabNow, currentTab, setPendingDialog],
  );

  const requestReloadTab = useCallback(
    (tabKey: string, session?: number) => {
      const tab = tabsRef.current.find(
        (item) => item.key === tabKey && (session === undefined || item.session === session),
      );
      if (!tab || !currentTab(tab)) return;
      if (tab.content !== tab.savedContent || writesRef.current.has(tab.session)) {
        setPendingDialog({ kind: "reloadTab", tabKey, session: tab.session });
        return;
      }
      void reloadTab(tabKey, tab.session);
    },
    [currentTab, reloadTab, setPendingDialog],
  );

  const requestCloseOverlay = useCallback(() => {
    if (!mountedRef.current) return;
    if (
      tabsRef.current.some(
        (tab) => tab.content !== tab.savedContent || writesRef.current.has(tab.session),
      ) ||
      readsRef.current.size
    ) {
      setPendingDialog({ kind: "closeOverlay" });
      return;
    }
    finishClose();
  }, [finishClose, setPendingDialog]);

  const hideOverlay = useCallback(() => {
    if (finalCloseRequested) {
      requestCloseOverlay();
      return;
    }
    setPendingDialog(null);
    finishHide();
  }, [finalCloseRequested, finishHide, requestCloseOverlay, setPendingDialog]);

  const discardDialogTarget = useCallback(() => {
    const dialog = dialogRef.current;
    if (!mountedRef.current || savingDialogRef.current === dialog) return;
    setPendingDialog(null);
    if (!dialog) return;
    if (dialog.kind === "closeOverlay") {
      finishClose(true);
      return;
    }
    if (dialog.kind === "closeTab") {
      closeTabNow(dialog.tabKey, dialog.session);
      return;
    }
    void reloadTab(dialog.tabKey, dialog.session);
  }, [closeTabNow, finishClose, reloadTab, setPendingDialog]);

  const saveDialogTarget = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || !mountedRef.current || savingDialogRef.current) return;
    savingDialogRef.current = dialog;
    setSavingDialog(true);
    void (async () => {
      try {
        if (dialog.kind === "closeOverlay") {
          const targets = tabsRef.current.filter(
            (tab) => tab.content !== tab.savedContent || writesRef.current.has(tab.session),
          );
          for (const tab of targets) {
            const saved = await saveTab(tab.key, tab.session);
            if (!mountedRef.current || dialogRef.current !== dialog) return;
            if (!saved) return;
          }
          if (
            tabsRef.current.some(
              (tab) => tab.content !== tab.savedContent || writesRef.current.has(tab.session),
            ) ||
            readsRef.current.size
          )
            return;
          setPendingDialog(null);
          finishClose();
          return;
        }
        const saved = await saveTab(dialog.tabKey, dialog.session);
        if (!saved || !mountedRef.current || dialogRef.current !== dialog) return;
        setPendingDialog(null);
        if (dialog.kind === "closeTab") {
          closeTabNow(dialog.tabKey, dialog.session);
        } else {
          void reloadTab(dialog.tabKey, dialog.session);
        }
      } finally {
        if (savingDialogRef.current === dialog) {
          savingDialogRef.current = null;
          if (mountedRef.current) setSavingDialog(false);
        }
      }
    })();
  }, [closeTabNow, finishClose, reloadTab, saveTab, setPendingDialog]);

  const showFind = useCallback(() => {
    editorRef.current?.focus();
    editorRef.current?.trigger("toolbar", "actions.find", null);
  }, []);

  const showReplace = useCallback(() => {
    editorRef.current?.focus();
    editorRef.current?.trigger("toolbar", "editor.action.startFindReplaceAction", null);
  }, []);

  const runEditorCommand = useCallback((commandId: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    editor.trigger("contextMenu", commandId, null);
  }, []);

  const insertSelectionAsCodeMention = useCallback(() => {
    const editor = editorRef.current;
    const tab = activeTab;
    if (!editor || !tab || !onInsertCodeMention) return;
    const selection = editor.getSelection();
    if (!selection) return;
    const startLine = selection.startLineNumber;
    const endLine =
      // A selection ending at column 1 stops visually at the previous line.
      selection.endLineNumber > startLine && selection.endColumn === 1
        ? selection.endLineNumber - 1
        : selection.endLineNumber;
    const reference = createCodeMentionReference({
      path: tab.path,
      startLine,
      endLine,
    });
    if (!reference) return;
    onInsertCodeMention(reference);
  }, [activeTab, onInsertCodeMention]);

  useEffect(() => {
    if (!openRequest || openRequestIdRef.current === openRequest.id) return;
    openRequestIdRef.current = openRequest.id;
    cancelPendingClose();
    setIsVisible(true);
    void readTab(openRequest);
  }, [cancelPendingClose, openRequest, readTab]);

  useEffect(() => {
    cancelPendingClose();
    setIsVisible(isOpen);
  }, [cancelPendingClose, isOpen]);

  useEffect(() => {
    if (closeRequestId == null) return;
    if (closeRequestIdRef.current == null) {
      closeRequestIdRef.current = closeRequestId;
      return;
    }
    if (closeRequestIdRef.current === closeRequestId) return;
    closeRequestIdRef.current = closeRequestId;
    requestCloseOverlay();
  }, [closeRequestId, requestCloseOverlay]);

  useEffect(() => {
    if (finalCloseRequested) return;
    cancelPendingClose();
    if (isOpen) {
      setIsVisible(true);
    }
    setPendingDialog((current) => (current?.kind === "closeOverlay" ? null : current));
  }, [cancelPendingClose, finalCloseRequested, isOpen, setPendingDialog]);

  useEffect(() => {
    activeKeyRef.current = activeTab?.key ?? "";
  }, [activeTab?.key]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || editorRef.current) return;
    const editor = monaco.editor.create(container, {
      automaticLayout: true,
      fontSize: 13,
      fontLigatures: true,
      minimap: { enabled: true },
      model: null,
      contextmenu: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      tabSize: 2,
      theme: initialThemeRef.current === "dark" ? "vs-dark" : "vs",
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
      for (const model of modelsRef.current.values()) {
        model.dispose();
      }
      modelsRef.current.clear();
      viewStatesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeTab) {
      editorRef.current?.setModel(null);
      return;
    }

    const previousKey = editorModelKeyRef.current;
    if (previousKey && previousKey !== activeTab.key) {
      viewStatesRef.current.set(previousKey, editor.saveViewState());
    }

    let model = modelsRef.current.get(activeTab.key);
    if (!model) {
      model = monaco.editor.createModel(
        activeTab.content,
        activeTab.language,
        editorModelUri(activeTab.key),
      );
      model.onDidChangeContent(() => {
        const value = model?.getValue() ?? "";
        const lineCount = model?.getLineCount() ?? 0;
        if (!currentTab(activeTab)) return;
        updateTab(
          activeTab.key,
          (tab) =>
            tab.content === value
              ? tab
              : {
                  ...tab,
                  content: value,
                  totalLines: lineCount,
                  sizeBytes: new TextEncoder().encode(value).length,
                  editVersion: tab.editVersion + 1,
                  error: null,
                },
          activeTab.session,
        );
      });
      modelsRef.current.set(activeTab.key, model);
    }
    if (model.getLanguageId() !== activeTab.language) {
      monaco.editor.setModelLanguage(model, activeTab.language);
    }
    if (editor.getModel() !== model) {
      editor.setModel(model);
      const viewState = viewStatesRef.current.get(activeTab.key);
      if (viewState) {
        editor.restoreViewState(viewState);
      }
      editor.focus();
    }
    editorModelKeyRef.current = activeTab.key;
  }, [activeTab, currentTab, updateTab]);

  useEffect(() => {
    const location = openRequest && workspaceCodeLocation(openRequest);
    if (
      !openRequest ||
      !location ||
      revealedLocationRequestIdRef.current === openRequest.id ||
      !activeTab ||
      activeTab.key !==
        editorTabKey(openRequest.projectPathKey, openRequest.path, openRequest.workdir)
    ) {
      return;
    }
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const startLineNumber = Math.min(location.line, model.getLineCount());
    const endLineNumber = Math.min(
      Math.max(startLineNumber, location.endLine ?? startLineNumber),
      model.getLineCount(),
    );
    const startColumn = Math.min(location.column ?? 1, model.getLineMaxColumn(startLineNumber));
    const endColumn = model.getLineMaxColumn(endLineNumber);
    const range = new monaco.Range(startLineNumber, startColumn, endLineNumber, endColumn);
    editor.setSelection(range);
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    editor.focus();
    revealedLocationRequestIdRef.current = openRequest.id;
  }, [activeTab, openRequest]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      const currentKey = activeKeyRef.current;
      if (!currentKey) return;
      event.preventDefault();
      void saveTab(currentKey);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, saveTab]);

  const dialogTitle =
    pendingDialog?.kind === "closeOverlay"
      ? t("workspaceEditor.closeDirtyTitle")
      : pendingDialog?.kind === "reloadTab"
        ? t("workspaceEditor.reloadDirtyTitle")
        : t("workspaceEditor.closeTabDirtyTitle");
  const dialogDescription =
    pendingDialog?.kind === "closeOverlay"
      ? t("workspaceEditor.closeDirtyDescription")
      : pendingDialog?.kind === "reloadTab"
        ? t("workspaceEditor.reloadDirtyDescription")
        : t("workspaceEditor.closeTabDirtyDescription");

  return (
    <VStack
      ref={overlayRef}
      className="xgent-workspace-preview-overlay"
      data-visible={isVisible ? "true" : "false"}
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: "var(--xgent-z-workspace-overlay)",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        backgroundColor: "var(--color-background-body)",
        borderInlineEnd: "var(--border-width) solid var(--color-border)",
      }}
    >
      <MacOsTitleBarSpacer />
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={0}>
            <VStack gap={0}>
              <Toolbar
                label={t("workspaceEditor.title")}
                size="sm"
                startContent={
                  <HStack gap={2} vAlign="center">
                    <Icon icon={FilePenLine} size="sm" color="accent" />
                    <StackItem size="fill">
                      <VStack gap={0.5}>
                        <Heading level={4}>{t("workspaceEditor.title")}</Heading>
                        <Text type="supporting" color="secondary" maxLines={1}>
                          {activeTab ? activeTab.path : t("workspaceEditor.empty")}
                        </Text>
                      </VStack>
                    </StackItem>
                  </HStack>
                }
                endContent={
                  <HStack gap={1} vAlign="center">
                    <IconButton
                      label={t("workspaceEditor.save")}
                      tooltip={t("workspaceEditor.save")}
                      icon={<Icon icon={Save} size="sm" color="inherit" />}
                      variant="ghost"
                      size="sm"
                      isLoading={activeTab?.status === "saving"}
                      isDisabled={
                        !activeTab ||
                        activeTab.content === activeTab.savedContent ||
                        activeTab.status === "saving" ||
                        activeTab.status === "conflict"
                      }
                      onClick={() => activeTab && void saveTab(activeTab.key, activeTab.session)}
                    />
                    <IconButton
                      label={t("workspaceEditor.context.copy")}
                      tooltip={t("workspaceEditor.context.copy")}
                      icon={<Icon icon={Copy} size="sm" color="inherit" />}
                      variant="ghost"
                      size="sm"
                      isDisabled={!activeTab}
                      onClick={() => runEditorCommand("editor.action.clipboardCopyAction")}
                    />
                    {onInsertCodeMention ? (
                      <IconButton
                        label={t("workspaceEditor.context.insertCodeMention")}
                        tooltip={t("workspaceEditor.context.insertCodeMention")}
                        icon={<Icon icon={MessageSquareText} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        isDisabled={!activeTab}
                        onClick={insertSelectionAsCodeMention}
                      />
                    ) : null}
                    {isNarrow ? (
                      <MoreMenu
                        label={t("workspaceEditor.moreActions")}
                        size="sm"
                        alignment="end"
                        items={[
                          {
                            label: t("workspaceEditor.find"),
                            onClick: showFind,
                            isDisabled: !activeTab,
                          },
                          {
                            label: t("workspaceEditor.replace"),
                            onClick: showReplace,
                            isDisabled: !activeTab,
                          },
                          {
                            label: t("workspaceEditor.reload"),
                            onClick: () =>
                              activeTab && requestReloadTab(activeTab.key, activeTab.session),
                            isDisabled: !activeTab || isOpening,
                          },
                          ...(activeRunnableFile
                            ? [
                                {
                                  label: t("workspaceEditor.run"),
                                  onClick: () => void runActiveFile(),
                                  isDisabled: isRunningFile,
                                },
                              ]
                            : []),
                        ]}
                      />
                    ) : (
                      <>
                        {activeRunnableFile ? (
                          <Button
                            label={
                              isRunningFile
                                ? t("workspaceEditor.running")
                                : t("workspaceEditor.run")
                            }
                            variant="secondary"
                            size="sm"
                            isLoading={isRunningFile}
                            isDisabled={isRunningFile}
                            onClick={() => void runActiveFile()}
                          />
                        ) : null}
                        <IconButton
                          label={t("workspaceEditor.find")}
                          tooltip={t("workspaceEditor.find")}
                          icon={<Icon icon={Search} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          isDisabled={!activeTab}
                          onClick={showFind}
                        />
                        <IconButton
                          label={t("workspaceEditor.replace")}
                          tooltip={t("workspaceEditor.replace")}
                          icon={<Icon icon={Replace} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          isDisabled={!activeTab}
                          onClick={showReplace}
                        />
                        <IconButton
                          label={t("workspaceEditor.reload")}
                          tooltip={t("workspaceEditor.reload")}
                          icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          isLoading={isOpening}
                          isDisabled={!activeTab || isOpening}
                          onClick={() =>
                            activeTab && requestReloadTab(activeTab.key, activeTab.session)
                          }
                        />
                      </>
                    )}
                    <IconButton
                      label={t("workspaceEditor.close")}
                      tooltip={t("workspaceEditor.close")}
                      icon={<Icon icon={X} size="sm" color="inherit" />}
                      variant="ghost"
                      size="sm"
                      onClick={hideOverlay}
                    />
                  </HStack>
                }
              />
              {canPreviewActiveTab && activeTab ? (
                <HStack width="100%" paddingInline={3}>
                  <TabList
                    value="source"
                    onChange={(value) => {
                      if (value !== "preview" || !currentTab(activeTab)) return;
                      onPreviewFile({
                        id: Date.now(),
                        projectPathKey: activeTab.projectPathKey,
                        workdir: activeTab.workdir,
                        path: activeTab.path,
                      });
                    }}
                    size="sm"
                    overflow="auto"
                  >
                    <Tab value="preview" label={t("workspaceFilePreview.preview")} />
                    <Tab value="source" label={t("workspaceFilePreview.source")} />
                  </TabList>
                </HStack>
              ) : null}
              {tabs.length > 0 ? (
                <HStack
                  className="xgent-workspace-editor-tabs"
                  gap={1}
                  vAlign="center"
                  role="tablist"
                  aria-label={t("workspaceEditor.title")}
                >
                  {tabs.map((tab) => {
                    const dirty = tab.content !== tab.savedContent;
                    return (
                      <HStack key={tab.key} gap={0.5} vAlign="center">
                        <Button
                          label={basename(tab.path)}
                          tooltip={tab.path}
                          endContent={
                            dirty ? (
                              <Token label={t("workspaceEditor.unsaved")} color="blue" size="sm" />
                            ) : undefined
                          }
                          variant={tab.key === activeKey ? "secondary" : "ghost"}
                          size="sm"
                          aria-selected={tab.key === activeKey}
                          role="tab"
                          onClick={() => {
                            if (!currentTab(tab)) return;
                            activeKeyRef.current = tab.key;
                            setActiveKey(tab.key);
                          }}
                        />
                        <IconButton
                          label={t("workspaceEditor.closeTab")}
                          tooltip={t("workspaceEditor.closeTab")}
                          icon={<Icon icon={X} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          onClick={() => requestCloseTab(tab.key, tab.session)}
                        />
                      </HStack>
                    );
                  })}
                </HStack>
              ) : null}
            </VStack>
          </LayoutHeader>
        }
        content={
          <VStack height="100%" gap={0}>
            {globalError || activeTab?.error ? (
              <Banner
                status={activeTab?.status === "conflict" ? "warning" : "error"}
                title={
                  activeTab?.status === "conflict"
                    ? t("workspaceEditor.conflictMessage")
                    : t("workspaceEditor.openFailed")
                }
                description={activeTab?.error ?? globalError ?? undefined}
                collapsible={false}
                endContent={
                  activeTab?.status === "conflict" ? (
                    <Button
                      label={t("workspaceEditor.reloadFromDisk")}
                      variant="secondary"
                      size="sm"
                      onClick={() => requestReloadTab(activeTab.key, activeTab.session)}
                    />
                  ) : undefined
                }
              />
            ) : null}
            <StackItem className="xgent-workspace-editor-context-menu" size="fill">
              <LayoutContent
                ref={containerRef}
                className="xgent-workspace-editor-stage"
                padding={0}
                isScrollable={false}
              >
                {!activeTab ? (
                  isOpening ? (
                    <Spinner size="lg" label={t("workspaceEditor.opening")} />
                  ) : (
                    <EmptyState
                      title={t("workspaceEditor.emptyHint")}
                      icon={<Icon icon={FilePenLine} size="lg" color="secondary" />}
                      isCompact
                    />
                  )
                ) : null}
              </LayoutContent>
            </StackItem>
          </VStack>
        }
        footer={
          <LayoutFooter hasDivider padding={2}>
            <HStack gap={2} vAlign="center" hAlign="between">
              <StackItem size="fill">
                <Text type="supporting" color="secondary" maxLines={1}>
                  {activeTab ? dirname(activeTab.path) || "/" : t("workspaceEditor.noFile")}
                </Text>
              </StackItem>
              {activeTab ? (
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {`${activeTab.language} · ${activeTab.totalLines} ${t("workspaceEditor.lines")} · ${formatBytes(activeTab.sizeBytes)}`}
                </Text>
              ) : null}
              {activeTab?.content !== activeTab?.savedContent ? (
                <Token label={t("workspaceEditor.unsaved")} color="blue" size="sm" />
              ) : null}
            </HStack>
          </LayoutFooter>
        }
      />

      {pendingDialog ? (
        <AdaptiveDialog
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen && dialogRef.current === pendingDialog) setPendingDialog(null);
          }}
          title={dialogTitle}
          purpose="info"
          width="var(--xgent-dialog-width-sm)"
          touchPresentation="bottom-sheet"
          footer={
            <HStack gap={2} hAlign="end">
              <Button
                label={t("workspaceEditor.cancel")}
                variant="secondary"
                onClick={() => {
                  if (dialogRef.current === pendingDialog) setPendingDialog(null);
                }}
              />
              <Button
                label={t("workspaceEditor.discard")}
                variant="secondary"
                isDisabled={savingDialog}
                onClick={() => {
                  if (dialogRef.current === pendingDialog) discardDialogTarget();
                }}
              />
              <Button
                label={
                  pendingDialog.kind === "closeOverlay"
                    ? t("workspaceEditor.saveAll")
                    : t("workspaceEditor.save")
                }
                isLoading={savingDialog}
                isDisabled={savingDialog}
                onClick={() => {
                  if (dialogRef.current === pendingDialog) saveDialogTarget();
                }}
              />
            </HStack>
          }
        >
          <Text color="secondary">{dialogDescription}</Text>
        </AdaptiveDialog>
      ) : null}

      {runResult ? (
        <AdaptiveDialog
          isOpen
          onOpenChange={(nextOpen) => {
            if (
              !nextOpen &&
              mountedRef.current &&
              runResultRef.current === runResult &&
              !activeRunIdRef.current
            )
              setRunResult(null);
          }}
          title={`${t("workspaceEditor.runOutput")}: ${runResult.fileName}`}
          purpose="info"
          width="var(--xgent-dialog-width-lg)"
          touchPresentation="bottom-sheet"
          footer={
            <Button
              label={
                isRunningFile ? t("workspaceEditor.stopRun") : t("workspaceEditor.closeRunOutput")
              }
              variant="secondary"
              isLoading={isStoppingFile}
              isDisabled={isStoppingFile}
              onClick={() => {
                if (!mountedRef.current || runResultRef.current !== runResult) return;
                if (activeRunIdRef.current) stopActiveFile();
                else setRunResult(null);
              }}
            />
          }
        >
          <VStack gap={3}>
            {runResult.phase === "running" ? (
              <>
                <Spinner size="lg" label={t("workspaceEditor.running")} />
                {runCancelError ? (
                  <Banner
                    status="error"
                    title={t("workspaceEditor.stopRunFailed")}
                    description={runCancelError}
                  />
                ) : null}
              </>
            ) : (
              <Banner
                status={
                  runStatus?.status === "success"
                    ? "success"
                    : runStatus?.status === "warning"
                      ? "warning"
                      : "error"
                }
                title={t(runStatus?.label ?? "workspaceEditor.runFailed")}
                description={
                  runResult.error ??
                  `${runResult.command} · ${t("workspaceEditor.exitCode")} ${runResult.exitCode ?? "-"}`
                }
                collapsible={false}
              />
            )}
            {runResult.phase !== "running" ? (
              <CodeBlock
                code={runResult.output || t("workspaceEditor.noRunOutput")}
                language="plaintext"
                title={t("workspaceEditor.runOutput")}
                size="sm"
                width="100%"
                maxHeight="min(55dvh, 32rem)"
                isWrapped
              />
            ) : null}
          </VStack>
        </AdaptiveDialog>
      ) : null}
    </VStack>
  );
}
