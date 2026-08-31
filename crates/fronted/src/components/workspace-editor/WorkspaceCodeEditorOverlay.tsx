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
import { invoke } from "@xagent/runtime";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
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
};

type EditorTabStatus = "ready" | "saving" | "conflict";

type EditorTab = {
  key: string;
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
  | { kind: "closeTab"; tabKey: string }
  | { kind: "reloadTab"; tabKey: string };

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

function editorTabKey(projectPathKey: string, path: string) {
  return `${projectPathKey}\u0000${path}`;
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

function runnableFile(path: string) {
  const fileName = basename(path);
  if (!/^[\p{L}\p{N} ._()-]+$/u.test(fileName)) return null;
  const lowerName = fileName.toLowerCase();
  const executable = lowerName.endsWith(".py")
    ? "python"
    : /\.(?:js|mjs|cjs)$/.test(lowerName)
      ? "node"
      : null;
  if (!executable) return null;
  return {
    fileName,
    command: `${executable} -- "${fileName}"`,
    cwd: dirname(path) || null,
  };
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function languageForPath(path: string) {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  if (name === "cargo.lock") return "toml";
  if (name.endsWith(".d.ts")) return "typescript";

  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "json":
    case "jsonc":
      return "json";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "less":
      return "less";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "mdx":
      return "markdown";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "py":
      return "python";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "c":
    case "h":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
      return "cpp";
    case "cs":
      return "csharp";
    case "php":
      return "php";
    case "rb":
      return "ruby";
    case "swift":
      return "swift";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "xml":
    case "svg":
      return "xml";
    case "sql":
      return "sql";
    case "graphql":
    case "gql":
      return "graphql";
    default:
      return "plaintext";
  }
}

function isVersionConflict(error: unknown) {
  if (isFsBackendError(error) && error.code === "stale_file") return true;
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
    scheme: "xagent-editor",
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
  const initialThemeRef = useRef(theme);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeKey, setActiveKey] = useState("");
  const [openingPaths, setOpeningPaths] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);
  const [isRunningFile, setIsRunningFile] = useState(false);
  const [runResult, setRunResult] = useState<EditorRunResult | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.key === activeKey) ?? tabs[0] ?? null,
    [activeKey, tabs],
  );
  const canPreviewActiveTab = Boolean(activeTab && isWorkspacePreviewPath(activeTab.path));
  const activeRunnableFile = activeTab ? runnableFile(activeTab.path) : null;
  const dirtyTabs = useMemo(() => tabs.filter((tab) => tab.content !== tab.savedContent), [tabs]);
  const hasDirtyTabs = dirtyTabs.length > 0;
  const isOpening = openingPaths.length > 0;

  useEffect(() => {
    openAnimationFrameRef.current = window.requestAnimationFrame(() => {
      openAnimationFrameRef.current = null;
      setIsVisible(true);
    });
    return () => {
      if (openAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(openAnimationFrameRef.current);
      }
      if (closeAnimationTimeoutRef.current !== null) {
        window.clearTimeout(closeAnimationTimeoutRef.current);
      }
    };
  }, []);

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
      onHide();
    }, EDITOR_OVERLAY_ANIMATION_MS);
  }, [onHide]);

  const finishClose = useCallback(() => {
    if (closeAnimationTimeoutRef.current !== null) {
      window.clearTimeout(closeAnimationTimeoutRef.current);
      closeAnimationTimeoutRef.current = null;
    }
    setIsVisible(false);
    closeAnimationTimeoutRef.current = window.setTimeout(() => {
      closeAnimationTimeoutRef.current = null;
      onClose();
    }, EDITOR_OVERLAY_ANIMATION_MS);
  }, [onClose]);

  const updateTab = useCallback((tabKey: string, updater: (tab: EditorTab) => EditorTab) => {
    setTabs((current) => current.map((tab) => (tab.key === tabKey ? updater(tab) : tab)));
  }, []);

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
    async (tabKey: string) => {
      const tab = tabs.find((item) => item.key === tabKey);
      if (!tab || tab.content === tab.savedContent || tab.status === "saving") return true;
      if (tab.status === "conflict") {
        const message = tab.error ?? t("workspaceEditor.conflictMessage");
        setGlobalError(message);
        return false;
      }

      const contentToSave = tab.content;
      updateTab(tabKey, (current) => ({ ...current, status: "saving", error: null }));
      try {
        const response = await invokeFs<WriteTextResponse>("fs_write_text", {
          workdir: tab.workdir,
          path: tab.path,
          content: contentToSave,
          mode: "rewrite",
          expected_mtime_ms: tab.mtimeMs,
          expected_content_hash: tab.contentHash,
        });
        updateTab(tabKey, (current) => ({
          ...current,
          savedContent: contentToSave,
          mtimeMs: response.mtimeMs,
          contentHash: response.contentHash,
          totalLines: current.content === contentToSave ? response.totalLines : current.totalLines,
          sizeBytes: new TextEncoder().encode(current.content).length,
          status: "ready",
          error: null,
        }));
        setGlobalError(null);
        return true;
      } catch (error) {
        const conflict = isVersionConflict(error);
        const message = conflict
          ? t("workspaceEditor.conflictMessage")
          : toMessage(error, t("workspaceEditor.saveFailed"));
        updateTab(tabKey, (current) => ({
          ...current,
          status: conflict ? "conflict" : "ready",
          error: message,
        }));
        setGlobalError(message);
        return false;
      }
    },
    [t, tabs, updateTab],
  );

  const runActiveFile = useCallback(async () => {
    const tab = activeTab;
    const runnable = tab ? runnableFile(tab.path) : null;
    if (!tab || !runnable || isRunningFile) return;
    setIsRunningFile(true);
    if (tab.content !== tab.savedContent) {
      const saved = await saveTab(tab.key);
      if (!saved) {
        setIsRunningFile(false);
        return;
      }
    }

    setRunResult({
      fileName: runnable.fileName,
      command: runnable.command,
      phase: "running",
      output: "",
    });
    try {
      const runId = `workspace-editor-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
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
      });
    } catch (error) {
      setRunResult({
        fileName: runnable.fileName,
        command: runnable.command,
        phase: "failed",
        output: "",
        error: toMessage(error, t("workspaceEditor.runFailed")),
      });
    } finally {
      setIsRunningFile(false);
    }
  }, [activeTab, isRunningFile, saveTab, t]);

  const readTab = useCallback(
    async (request: WorkspaceCodeEditorOpenRequest) => {
      const key = editorTabKey(request.projectPathKey, request.path);
      const existing = tabs.find((tab) => tab.key === key);
      if (existing) {
        setActiveKey(key);
        setGlobalError(null);
        return;
      }

      setOpeningPaths((current) => [
        ...current.filter((item) => item !== request.path),
        request.path,
      ]);
      setGlobalError(null);
      try {
        const response = await invokeFs<ReadEditableTextResponse>("fs_read_editable_text", {
          workdir: request.workdir,
          path: request.path,
        });
        const nextTab: EditorTab = {
          key,
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
        setActiveKey(key);
      } catch (error) {
        setGlobalError(toMessage(error, t("workspaceEditor.openFailed")));
      } finally {
        setOpeningPaths((current) => current.filter((item) => item !== request.path));
      }
    },
    [t, tabs],
  );

  const reloadTab = useCallback(
    async (tabKey: string) => {
      const tab = tabs.find((item) => item.key === tabKey);
      if (!tab) return false;
      setOpeningPaths((current) => [...current.filter((item) => item !== tab.path), tab.path]);
      setGlobalError(null);
      try {
        const response = await invokeFs<ReadEditableTextResponse>("fs_read_editable_text", {
          workdir: tab.workdir,
          path: tab.path,
        });
        const model = modelsRef.current.get(tabKey);
        if (model && model.getValue() !== response.content) {
          model.setValue(response.content);
        }
        updateTab(tabKey, (current) => ({
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
        }));
        return true;
      } catch (error) {
        const message = toMessage(error, t("workspaceEditor.reloadFailed"));
        updateTab(tabKey, (current) => ({ ...current, error: message }));
        setGlobalError(message);
        return false;
      } finally {
        setOpeningPaths((current) => current.filter((item) => item !== tab.path));
      }
    },
    [t, tabs, updateTab],
  );

  const closeTabNow = useCallback(
    (tabKey: string) => {
      disposeModel(tabKey);
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.key === tabKey);
        if (index < 0) return current;
        const next = current.filter((tab) => tab.key !== tabKey);
        setActiveKey((currentActive) => {
          if (currentActive !== tabKey) return currentActive;
          return next[Math.min(index, next.length - 1)]?.key ?? "";
        });
        return next;
      });
    },
    [disposeModel],
  );

  const requestCloseTab = useCallback(
    (tabKey: string) => {
      const tab = tabs.find((item) => item.key === tabKey);
      if (!tab) return;
      if (tab.content !== tab.savedContent) {
        setPendingDialog({ kind: "closeTab", tabKey });
        return;
      }
      closeTabNow(tabKey);
    },
    [closeTabNow, tabs],
  );

  const requestReloadTab = useCallback(
    (tabKey: string) => {
      const tab = tabs.find((item) => item.key === tabKey);
      if (!tab) return;
      if (tab.status !== "conflict" && tab.content !== tab.savedContent) {
        setPendingDialog({ kind: "reloadTab", tabKey });
        return;
      }
      void reloadTab(tabKey);
    },
    [reloadTab, tabs],
  );

  const requestCloseOverlay = useCallback(() => {
    if (hasDirtyTabs) {
      setPendingDialog({ kind: "closeOverlay" });
      return;
    }
    finishClose();
  }, [finishClose, hasDirtyTabs]);

  const hideOverlay = useCallback(() => {
    if (finalCloseRequested) {
      requestCloseOverlay();
      return;
    }
    setPendingDialog(null);
    finishHide();
  }, [finalCloseRequested, finishHide, requestCloseOverlay]);

  const discardDialogTarget = useCallback(() => {
    const dialog = pendingDialog;
    setPendingDialog(null);
    if (!dialog) return;
    if (dialog.kind === "closeOverlay") {
      finishClose();
      return;
    }
    if (dialog.kind === "closeTab") {
      closeTabNow(dialog.tabKey);
      return;
    }
    void reloadTab(dialog.tabKey);
  }, [closeTabNow, finishClose, pendingDialog, reloadTab]);

  const saveDialogTarget = useCallback(() => {
    const dialog = pendingDialog;
    if (!dialog) return;
    void (async () => {
      if (dialog.kind === "closeOverlay") {
        for (const tab of dirtyTabs) {
          const saved = await saveTab(tab.key);
          if (!saved) return;
        }
        setPendingDialog(null);
        finishClose();
        return;
      }
      const saved = await saveTab(dialog.tabKey);
      if (!saved) return;
      setPendingDialog(null);
      if (dialog.kind === "closeTab") {
        closeTabNow(dialog.tabKey);
      } else {
        void reloadTab(dialog.tabKey);
      }
    })();
  }, [closeTabNow, dirtyTabs, finishClose, pendingDialog, reloadTab, saveTab]);

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

  // 选区扩展到整行后作为代码引用（仅路径+行号）交给输入框；空选区退化为光标所在行。
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
  }, [cancelPendingClose, finalCloseRequested, isOpen]);

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
        setTabs((current) =>
          current.map((tab) =>
            tab.key === activeTab.key
              ? { ...tab, content: value, totalLines: lineCount, error: null }
              : tab,
          ),
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
  }, [activeTab]);

  useEffect(() => {
    if (
      !openRequest?.line ||
      revealedLocationRequestIdRef.current === openRequest.id ||
      !activeTab ||
      activeTab.key !== editorTabKey(openRequest.projectPathKey, openRequest.path)
    ) {
      return;
    }
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const startLineNumber = Math.min(Math.max(1, openRequest.line), model.getLineCount());
    const endLineNumber = Math.min(
      Math.max(startLineNumber, openRequest.endLine ?? startLineNumber),
      model.getLineCount(),
    );
    const startColumn = Math.min(
      Math.max(1, openRequest.column ?? 1),
      model.getLineMaxColumn(startLineNumber),
    );
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
      className="xagent-workspace-preview-overlay"
      data-visible={isVisible ? "true" : "false"}
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: "var(--xagent-z-workspace-overlay)",
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
                      onClick={() => activeTab && void saveTab(activeTab.key)}
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
                            onClick: () => activeTab && requestReloadTab(activeTab.key),
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
                          onClick={() => activeTab && requestReloadTab(activeTab.key)}
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
                      if (value !== "preview") return;
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
                  className="xagent-workspace-editor-tabs"
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
                          onClick={() => setActiveKey(tab.key)}
                        />
                        <IconButton
                          label={t("workspaceEditor.closeTab")}
                          tooltip={t("workspaceEditor.closeTab")}
                          icon={<Icon icon={X} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          onClick={() => requestCloseTab(tab.key)}
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
                      onClick={() => requestReloadTab(activeTab.key)}
                    />
                  ) : undefined
                }
              />
            ) : null}
            <StackItem className="xagent-workspace-editor-context-menu" size="fill">
              <LayoutContent
                ref={containerRef}
                className="xagent-workspace-editor-stage"
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
            if (!isOpen) setPendingDialog(null);
          }}
          title={dialogTitle}
          purpose="info"
          width="var(--xagent-dialog-width-sm)"
          touchPresentation="bottom-sheet"
          footer={
            <HStack gap={2} hAlign="end">
              <Button
                label={t("workspaceEditor.cancel")}
                variant="secondary"
                onClick={() => setPendingDialog(null)}
              />
              <Button
                label={t("workspaceEditor.discard")}
                variant="secondary"
                onClick={discardDialogTarget}
              />
              <Button
                label={
                  pendingDialog.kind === "closeOverlay"
                    ? t("workspaceEditor.saveAll")
                    : t("workspaceEditor.save")
                }
                onClick={saveDialogTarget}
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
            if (!nextOpen && !isRunningFile) setRunResult(null);
          }}
          title={`${t("workspaceEditor.runOutput")}: ${runResult.fileName}`}
          purpose="info"
          width="var(--xagent-dialog-width-lg)"
          touchPresentation="bottom-sheet"
          footer={
            <Button
              label={t("workspaceEditor.closeRunOutput")}
              variant="secondary"
              isDisabled={isRunningFile}
              onClick={() => setRunResult(null)}
            />
          }
        >
          <VStack gap={3}>
            {runResult.phase === "running" ? (
              <Spinner size="lg" label={t("workspaceEditor.running")} />
            ) : (
              <Banner
                status={
                  runResult.phase === "failed" || runResult.exitCode !== 0 ? "error" : "success"
                }
                title={
                  runResult.phase === "failed"
                    ? t("workspaceEditor.runFailed")
                    : runResult.exitCode === 0
                      ? t("workspaceEditor.runSucceeded")
                      : t("workspaceEditor.runFailed")
                }
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
