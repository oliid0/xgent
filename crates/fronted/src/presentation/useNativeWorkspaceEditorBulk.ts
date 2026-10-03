import { useCallback, useEffect, useRef, useState } from "react";
import {
  type NativeEditorDraft,
  type NativeEditorSource,
  type NativeEditorWriteCache,
  saveNativeWorkspaceEditorSource,
} from "./nativeWorkspaceEditorWrites";
import type { NativeWorkspaceEditorTab } from "./useNativeWorkspaceEditorTabs";

type CloseAll = { id: number; tabs: NativeWorkspaceEditorTab[] };
export type NativeEditorBulkError = {
  tab: NativeWorkspaceEditorTab;
  error?: unknown;
  laterEdits?: boolean;
};
export type NativeEditorBulk = {
  busy: boolean;
  dialog: CloseAll | null;
  errors: NativeEditorBulkError[];
  saveAll: (closeId?: number) => Promise<boolean>;
  requestClose: () => boolean;
  discard: (id: number) => boolean;
  cancel: (id: number) => boolean;
  ownsDialog: (id: number) => boolean;
};

function sameTabs(a: NativeWorkspaceEditorTab[], b: NativeWorkspaceEditorTab[]) {
  return (
    a.length === b.length &&
    a.every((tab) =>
      b.some((current) => current.key === tab.key && current.session === tab.session),
    )
  );
}

export function useNativeWorkspaceEditorBulk<
  File extends NativeEditorSource,
  Draft extends NativeEditorDraft,
>({
  cache,
  readTabs,
  removeAll,
  dirty,
  onClose,
  visible,
}: {
  cache: NativeEditorWriteCache<File, Draft>;
  readTabs: () => NativeWorkspaceEditorTab[];
  removeAll: (snapshot: NativeWorkspaceEditorTab[]) => boolean;
  dirty: (value: File | Draft | undefined) => boolean;
  onClose: () => void;
  visible: boolean;
}): NativeEditorBulk {
  const callbacks = useRef({ readTabs, removeAll, dirty, onClose });
  callbacks.current = { readTabs, removeAll, dirty, onClose };
  const lifetime = useRef<object | null>(null),
    operation = useRef<object | null>(null),
    sequence = useRef(0);
  const dialogRef = useRef<CloseAll | null>(null);
  const [dialog, renderDialog] = useState<CloseAll | null>(null),
    [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<NativeEditorBulkError[]>([]);
  const setDialog = useCallback((next: CloseAll | null) => {
    dialogRef.current = next;
    renderDialog(next);
  }, []);
  useEffect(() => {
    const epoch = {};
    lifetime.current = epoch;
    operation.current = null;
    setBusy(false);
    setDialog(null);
    setErrors([]);
    return () => {
      if (lifetime.current === epoch) lifetime.current = null;
    };
  }, [setDialog]);
  useEffect(() => {
    if (!visible) setDialog(null);
  }, [visible, setDialog]);
  const unsaved = useCallback(
    (tabs: NativeWorkspaceEditorTab[]) =>
      tabs.some(
        (tab) =>
          cache.pendingWrites.has(tab.key) ||
          callbacks.current.dirty(cache.drafts.get(tab.key) ?? cache.editors.get(tab.key)),
      ),
    [cache],
  );
  const show = useCallback(
    (tabs: NativeWorkspaceEditorTab[]) => {
      setDialog({ id: ++sequence.current, tabs: [...tabs] });
    },
    [setDialog],
  );
  const close = useCallback(
    (snapshot: NativeWorkspaceEditorTab[]) => {
      if (!lifetime.current || !callbacks.current.removeAll(snapshot)) return false;
      for (const tab of snapshot) {
        cache.editors.delete(tab.key);
        cache.drafts.delete(tab.key);
        cache.writeFailures?.delete(tab.key);
      }
      setDialog(null);
      setErrors([]);
      callbacks.current.onClose();
      return true;
    },
    [cache, setDialog],
  );
  const requestClose = useCallback(() => {
    if (!lifetime.current || operation.current) return false;
    const tabs = callbacks.current.readTabs();
    if (unsaved(tabs)) {
      show(tabs);
      return false;
    }
    return close(tabs);
  }, [unsaved, show, close]);
  const cancel = useCallback(
    (id: number) => {
      if (!lifetime.current || dialogRef.current?.id !== id) return false;
      setDialog(null);
      return true;
    },
    [setDialog],
  );
  const discard = useCallback(
    (id: number) => {
      const current = dialogRef.current;
      if (
        !lifetime.current ||
        !current ||
        current.id !== id ||
        operation.current ||
        current.tabs.some((tab) => cache.pendingWrites.has(tab.key))
      )
        return false;
      const latest = callbacks.current.readTabs();
      if (!sameTabs(current.tabs, latest)) {
        show(latest);
        return false;
      }
      return close(current.tabs);
    },
    [cache, show, close],
  );
  const saveAll = useCallback(
    async (closeId?: number) => {
      if (
        !lifetime.current ||
        operation.current ||
        (closeId !== undefined && dialogRef.current?.id !== closeId)
      )
        return false;
      const epoch = lifetime.current,
        token = {},
        targets = [
          ...(closeId === undefined
            ? callbacks.current.readTabs()
            : (dialogRef.current?.tabs ?? [])),
        ];
      operation.current = token;
      setBusy(true);
      setErrors([]);
      const valid = () =>
        lifetime.current === epoch &&
        operation.current === token &&
        (closeId === undefined || dialogRef.current?.id === closeId);
      const failures: NativeEditorBulkError[] = [];
      try {
        for (const tab of targets) {
          if (!valid()) return false;
          if (
            !callbacks.current
              .readTabs()
              .some((current) => current.key === tab.key && current.session === tab.session)
          )
            continue;
          if (
            !callbacks.current.dirty(cache.drafts.get(tab.key) ?? cache.editors.get(tab.key)) &&
            !cache.pendingWrites.has(tab.key)
          )
            continue;
          try {
            if (!(await saveNativeWorkspaceEditorSource(cache, tab.key, callbacks.current.dirty)))
              failures.push({ tab, laterEdits: true });
          } catch (error) {
            failures.push({ tab, error });
          }
        }
        if (!valid()) return false;
        // Edits to an earlier file while a later file writes must remain open too.
        for (const tab of targets)
          if (
            callbacks.current.dirty(cache.drafts.get(tab.key) ?? cache.editors.get(tab.key)) &&
            !failures.some((item) => item.tab.key === tab.key)
          )
            failures.push({ tab, laterEdits: true });
        setErrors(failures);
        if (failures.length || unsaved(targets)) return false;
        if (closeId === undefined) return true;
        const latest = callbacks.current.readTabs();
        if (!sameTabs(targets, latest)) {
          show(latest);
          return false;
        }
        return close(targets);
      } finally {
        if (operation.current === token) {
          operation.current = null;
          if (lifetime.current === epoch) setBusy(false);
        }
      }
    },
    [cache, unsaved, show, close],
  );
  const ownsDialog = useCallback(
    (id: number) => !!lifetime.current && dialogRef.current?.id === id,
    [],
  );
  return { busy, dialog, errors, saveAll, requestClose, discard, cancel, ownsDialog };
}
