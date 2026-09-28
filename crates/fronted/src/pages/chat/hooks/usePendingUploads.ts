import { invoke, isTauriRuntime } from "@xgent/runtime";
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";

import type { MentionComposerHandle } from "../../../components/chat/MentionComposer";
import type { NotifyItem } from "../../../components/chat/NotifyToast";
import {
  mergePendingUploadedFiles,
  type PendingUploadedFile,
} from "../../../lib/chat/messages/uploadedFiles";
import { invalidateUploadedImagePreviewCache } from "../transcript/uploadedImagePreview";
import { prepareReadableUploads } from "./readableUploadInput";

type SystemPickReadableFilesResponse = {
  files: PendingUploadedFile[];
  skipped: string[];
};

type UploadTarget = {
  targetConversationId: string;
  targetWorkdir: string;
  remainingFileSlots: number;
  contextRevision: number;
};

type UsePendingUploadsParams = {
  workdir: string;
  conversationId: string;
  currentConversationIdRef: MutableRefObject<string>;
  composerRef: MutableRefObject<MentionComposerHandle | null>;
  setErrorMessage: (message: string | null) => void;
  addNotify: (type: NotifyItem["type"], message: string) => void;
  nativeMobileRuntime?: boolean;
};

export const MAX_UPLOAD_FILES = 9;

type WebViewFilePickerOptions = {
  accept?: string;
  capture?: "environment" | "user";
  multiple?: boolean;
};

function pickFilesFromWebView(options: WebViewFilePickerOptions = {}): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options.multiple ?? true;
    if (options.accept) input.accept = options.accept;
    if (options.capture) input.setAttribute("capture", options.capture);
    input.tabIndex = -1;
    input.style.position = "fixed";
    input.style.inset = "0 auto auto -10000px";

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])), {
      once: true,
    });
    input.addEventListener("cancel", () => finish([]), { once: true });
    try {
      document.body.appendChild(input);
      input.click();
    } catch (error) {
      if (!settled) {
        settled = true;
        input.remove();
        reject(error);
      }
    }
  });
}

export function usePendingUploads(params: UsePendingUploadsParams) {
  const {
    workdir,
    conversationId,
    currentConversationIdRef,
    composerRef,
    setErrorMessage,
    addNotify,
    nativeMobileRuntime = false,
  } = params;
  const [pendingUploadedFiles, setPendingUploadedFiles] = useState<PendingUploadedFile[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const uploadTaskActiveRef = useRef(false);
  const pendingUploadsByConversationRef = useRef(new Map<string, PendingUploadedFile[]>());
  const pendingUploadedFilesRef = useRef(pendingUploadedFiles);
  // Keep invalidation for each conversation even while another one is displayed.
  const uploadContextsRef = useRef(
    new Map<
      string,
      {
        workdir: string;
        revision: number;
      }
    >(),
  );
  const conversationKey = conversationId.trim();
  const previousContext = uploadContextsRef.current.get(conversationKey);
  const workspaceChanged = Boolean(previousContext && previousContext.workdir !== workdir);
  const context =
    !previousContext || workspaceChanged
      ? { workdir, revision: (previousContext?.revision ?? -1) + 1 }
      : previousContext;
  uploadContextsRef.current.set(conversationKey, context);

  const getPendingUploadsForConversation = useCallback(
    (conversationId: string) => {
      const targetConversationId = conversationId.trim();
      if (
        !targetConversationId ||
        currentConversationIdRef.current.trim() === targetConversationId
      ) {
        return pendingUploadedFilesRef.current;
      }
      return pendingUploadsByConversationRef.current.get(targetConversationId) ?? [];
    },
    [currentConversationIdRef],
  );

  // The single write path: keeps the per-conversation map, the synchronous
  // read ref, and the rendered state in step within the same tick. Every
  // pending-uploads mutation (including the consumers') must go through it.
  const setPendingUploadsForConversation = useCallback(
    (conversationId: string, nextFiles: PendingUploadedFile[]) => {
      const targetConversationId = conversationId.trim();
      const normalizedFiles = nextFiles.slice();
      if (targetConversationId) {
        if (normalizedFiles.length > 0) {
          pendingUploadsByConversationRef.current.set(targetConversationId, normalizedFiles);
        } else {
          pendingUploadsByConversationRef.current.delete(targetConversationId);
        }
      }
      if (
        !targetConversationId ||
        currentConversationIdRef.current.trim() === targetConversationId
      ) {
        pendingUploadedFilesRef.current = normalizedFiles;
        setPendingUploadedFiles(normalizedFiles);
      }
    },
    [currentConversationIdRef],
  );

  useEffect(() => {
    const targetConversationId = conversationId.trim();
    if (workspaceChanged) pendingUploadsByConversationRef.current.delete(targetConversationId);
    const nextFiles = targetConversationId
      ? (pendingUploadsByConversationRef.current.get(targetConversationId) ?? [])
      : [];
    pendingUploadedFilesRef.current = nextFiles;
    setPendingUploadedFiles(nextFiles);
  }, [conversationId, workdir, workspaceChanged]);

  const isUploadTargetCurrent = useCallback((target: UploadTarget) => {
    const current = uploadContextsRef.current.get(target.targetConversationId);
    return current?.workdir === target.targetWorkdir && current.revision === target.contextRevision;
  }, []);

  const captureUploadTarget = useCallback((): UploadTarget | null => {
    const targetConversationId = currentConversationIdRef.current.trim();
    if (!targetConversationId) {
      setErrorMessage("请先选择或创建会话后再上传文件。");
      return null;
    }

    const currentTargetUploads = getPendingUploadsForConversation(targetConversationId);
    const remainingFileSlots = Math.max(0, MAX_UPLOAD_FILES - currentTargetUploads.length);
    if (remainingFileSlots === 0) {
      addNotify("warning", `最多上传 ${MAX_UPLOAD_FILES} 个文件，已忽略多余文件`);
      return null;
    }

    return {
      targetConversationId,
      targetWorkdir: workdir,
      remainingFileSlots,
      contextRevision: uploadContextsRef.current.get(targetConversationId)?.revision ?? 0,
    };
  }, [
    addNotify,
    currentConversationIdRef,
    getPendingUploadsForConversation,
    setErrorMessage,
    workdir,
  ]);

  const appendImportedFiles = useCallback(
    (
      target: UploadTarget,
      result: SystemPickReadableFilesResponse,
      emptySelectionMessage: string,
    ) => {
      const { targetConversationId, targetWorkdir } = target;
      const isTargetDisplayed = currentConversationIdRef.current.trim() === targetConversationId;
      // An import that settles after its upload context was invalidated must
      // not resurrect cleared attachments: the files landed under the old
      // workdir, so their relative paths are stale there.
      if (result.files.length === 0 && result.skipped.length === 0) return;
      if (!isUploadTargetCurrent(target)) {
        addNotify("warning", "上传目标已失效，已忽略本次导入的文件");
        return;
      }
      if (result.files.length > 0) {
        for (const file of result.files) {
          invalidateUploadedImagePreviewCache(targetWorkdir, file);
        }
        const previous = getPendingUploadsForConversation(targetConversationId);
        const merged = mergePendingUploadedFiles(previous, result.files);
        if (merged.length > MAX_UPLOAD_FILES) {
          addNotify("warning", `最多上传 ${MAX_UPLOAD_FILES} 个文件，已忽略多余文件`);
        }
        setPendingUploadsForConversation(targetConversationId, merged.slice(0, MAX_UPLOAD_FILES));
        if (isTargetDisplayed) {
          composerRef.current?.focus();
        }
      }
      if (result.files.length === 0 && result.skipped.length > 0) {
        if (isTargetDisplayed) {
          setErrorMessage(`${emptySelectionMessage}：\n${result.skipped.join("\n")}`);
        } else {
          addNotify("warning", `${emptySelectionMessage}：\n${result.skipped.join("\n")}`);
        }
        return;
      }
      if (result.skipped.length > 0) {
        addNotify("warning", `以下文件已跳过：\n${result.skipped.join("\n")}`);
      }
    },
    [
      addNotify,
      composerRef,
      currentConversationIdRef,
      getPendingUploadsForConversation,
      isUploadTargetCurrent,
      setErrorMessage,
      setPendingUploadsForConversation,
    ],
  );

  // Shared import skeleton: single-flight guard, workspace precondition,
  // busy state, result merge, and error routing to the owning conversation.
  const runUploadTask = useCallback(
    async (task: {
      emptySelectionMessage: string;
      errorFallback: string;
      importer: (target: UploadTarget) => Promise<SystemPickReadableFilesResponse>;
    }) => {
      if (uploadTaskActiveRef.current) {
        addNotify("warning", "当前正在上传文件，请稍候");
        return;
      }
      if (!workdir.trim()) {
        setErrorMessage("请先在项目栏选择或创建项目后再上传文件。");
        return;
      }

      const uploadTarget = captureUploadTarget();
      if (!uploadTarget) {
        return;
      }

      uploadTaskActiveRef.current = true;
      setIsUploadingFiles(true);
      try {
        const result = await task.importer(uploadTarget);
        appendImportedFiles(uploadTarget, result, task.emptySelectionMessage);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (currentConversationIdRef.current.trim() === uploadTarget.targetConversationId) {
          setErrorMessage(message || task.errorFallback);
        } else {
          addNotify("warning", message || task.errorFallback);
        }
      } finally {
        uploadTaskActiveRef.current = false;
        setIsUploadingFiles(false);
      }
    },
    [
      addNotify,
      appendImportedFiles,
      captureUploadTarget,
      currentConversationIdRef,
      setErrorMessage,
      workdir,
    ],
  );

  const importReadableFilePaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      await runUploadTask({
        emptySelectionMessage: "拖入文件均不受当前 Read 支持",
        errorFallback: "导入文件失败",
        importer: ({ targetWorkdir, remainingFileSlots }) =>
          invoke<SystemPickReadableFilesResponse>("system_import_readable_file_paths", {
            workdir: targetWorkdir,
            paths,
            maxFiles: remainingFileSlots,
          }),
      });
    },
    [runUploadTask],
  );

  const importFilesForTarget = useCallback(
    async (files: File[], target: UploadTarget): Promise<SystemPickReadableFilesResponse> => {
      if (files.length === 0) return { files: [], skipped: [] };
      if (!isUploadTargetCurrent(target)) {
        addNotify("warning", "上传目标已失效，已忽略本次导入的文件");
        return { files: [], skipped: [] };
      }
      const { targetWorkdir, remainingFileSlots } = target;
      const importBatch = files.slice(0, remainingFileSlots);
      const ignoredForLimit = files.length - importBatch.length;
      if (ignoredForLimit > 0) {
        addNotify(
          "warning",
          `最多上传 ${MAX_UPLOAD_FILES} 个文件，已忽略 ${ignoredForLimit} 个额外文件`,
        );
      }
      const prepared = await prepareReadableUploads(importBatch);
      if (!prepared.files.length) return { files: [], skipped: prepared.skipped };
      if (!isUploadTargetCurrent(target)) {
        addNotify("warning", "上传目标已失效，已忽略本次导入的文件");
        return { files: [], skipped: [] };
      }
      const result = await invoke<SystemPickReadableFilesResponse>(
        "system_import_uploaded_readable_files",
        { workdir: targetWorkdir, files: prepared.files, maxFiles: remainingFileSlots },
      );
      return { ...result, skipped: [...prepared.skipped, ...result.skipped] };
    },
    [addNotify, isUploadTargetCurrent],
  );

  const importReadableFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      await runUploadTask({
        emptySelectionMessage: "剪贴板文件均不受当前 Read 支持",
        errorFallback: "导入剪贴板文件失败",
        importer: (target) => importFilesForTarget(files, target),
      });
    },
    [importFilesForTarget, runUploadTask],
  );

  const pickReadableFilesFromWebView = useCallback(
    (options: WebViewFilePickerOptions = {}) =>
      runUploadTask({
        emptySelectionMessage: "所选文件均不受当前 Read 支持",
        errorFallback: "导入文件失败",
        // Pin ownership and reserve the single-flight slot before opening the picker.
        importer: async (target) =>
          importFilesForTarget(await pickFilesFromWebView(options), target),
      }),
    [importFilesForTarget, runUploadTask],
  );

  const pickReadableFiles = useCallback(async () => {
    if (nativeMobileRuntime || !isTauriRuntime()) {
      await pickReadableFilesFromWebView();
      return;
    }
    await runUploadTask({
      emptySelectionMessage: "所选文件均不受当前 Read 支持",
      errorFallback: "导入文件失败",
      importer: ({ targetWorkdir, remainingFileSlots }) =>
        invoke<SystemPickReadableFilesResponse>("system_pick_readable_files", {
          workdir: targetWorkdir,
          maxFiles: remainingFileSlots,
        }),
    });
  }, [pickReadableFilesFromWebView, nativeMobileRuntime, runUploadTask]);

  const pickReadablePhotos = useCallback(async () => {
    await pickReadableFilesFromWebView({ accept: "image/*", multiple: true });
  }, [pickReadableFilesFromWebView]);

  const captureReadablePhoto = useCallback(async () => {
    await pickReadableFilesFromWebView({
      accept: "image/*",
      capture: "environment",
      multiple: false,
    });
  }, [pickReadableFilesFromWebView]);

  const removePendingUpload = useCallback(
    (relativePath: string) => {
      const targetConversationId = currentConversationIdRef.current.trim();
      const next = getPendingUploadsForConversation(targetConversationId).filter(
        (file) => file.relativePath !== relativePath,
      );
      setPendingUploadsForConversation(targetConversationId, next);
    },
    [currentConversationIdRef, getPendingUploadsForConversation, setPendingUploadsForConversation],
  );

  return {
    isUploadingFiles,
    pendingUploadedFiles,
    getPendingUploadsForConversation,
    setPendingUploadsForConversation,
    pickReadableFiles,
    pickReadablePhotos,
    captureReadablePhoto,
    importReadableFilePaths,
    importReadableFiles,
    removePendingUpload,
  };
}
