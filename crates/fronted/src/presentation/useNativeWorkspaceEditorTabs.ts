import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceCodeEditorOpenRequest } from "../components/workspace-editor/WorkspaceCodeEditorOverlay";

export type NativeWorkspaceEditorTab = {
  key: string;
  session: number;
  request: WorkspaceCodeEditorOpenRequest;
};
type TabState = {
  tabs: NativeWorkspaceEditorTab[];
  active: string;
  sequence: number;
  close: { key: string; token: number } | null;
  lastRequest: string;
};

export function nativeWorkspaceEditorKey(request: WorkspaceCodeEditorOpenRequest) {
  return JSON.stringify([request.projectPathKey, request.workdir, request.path]);
}
function requestToken(request: WorkspaceCodeEditorOpenRequest | null) {
  return request
    ? JSON.stringify([
        request.id,
        nativeWorkspaceEditorKey(request),
        request.line,
        request.endLine,
        request.column,
      ])
    : "";
}
function open(state: TabState, request: WorkspaceCodeEditorOpenRequest): TabState {
  const key = nativeWorkspaceEditorKey(request),
    previous = state.tabs.find((tab) => tab.key === key);
  const sequence = previous ? state.sequence : state.sequence + 1;
  const tab = { key, session: previous?.session ?? sequence, request: { ...request } };
  return {
    ...state,
    sequence,
    lastRequest: requestToken(request),
    active: key,
    close: null,
    tabs: previous
      ? state.tabs.map((item) => (item.key === key ? tab : item))
      : [...state.tabs, tab],
  };
}

/** Native file tabs own selection and identity; their source and write guards stay in the file cache. */
export function useNativeWorkspaceEditorTabs(request: WorkspaceCodeEditorOpenRequest | null) {
  const [state, render] = useState<TabState>(() => {
    const initial = { tabs: [], active: "", sequence: 0, close: null, lastRequest: "" };
    return request ? open(initial, request) : initial;
  });
  const current = useRef(state);
  current.current = state;
  const closeSequence = useRef(0);
  const update = useCallback((next: TabState) => {
    current.current = next;
    render(next);
  }, []);
  const token = requestToken(request);
  useEffect(() => {
    if (token === current.current.lastRequest) return;
    if (request) update(open(current.current, request));
    else update({ ...current.current, lastRequest: "" });
  }, [request, token, update]);
  const select = useCallback(
    (key: string) => {
      if (!current.current.tabs.some((tab) => tab.key === key)) return false;
      update({ ...current.current, active: key, close: null });
      return true;
    },
    [update],
  );
  const requestClose = useCallback(
    (key: string) => {
      if (!current.current.tabs.some((tab) => tab.key === key)) return false;
      update({ ...current.current, active: key, close: { key, token: ++closeSequence.current } });
      return true;
    },
    [update],
  );
  const remove = useCallback(
    (key: string, session: number) => {
      const before = current.current,
        index = before.tabs.findIndex((tab) => tab.key === key && tab.session === session);
      if (index < 0) return false;
      const tabs = before.tabs.filter((_, item) => item !== index);
      update({
        ...before,
        tabs,
        close: null,
        active:
          before.active === key ? (tabs[index]?.key ?? tabs[index - 1]?.key ?? "") : before.active,
      });
      return tabs.length === 0;
    },
    [update],
  );
  const active = state.tabs.find((tab) => tab.key === state.active) ?? null;
  const readTabs = useCallback(() => current.current.tabs, []);
  const removeAll = useCallback(
    (snapshot: NativeWorkspaceEditorTab[]) => {
      const tabs = current.current.tabs;
      if (
        tabs.length !== snapshot.length ||
        tabs.some(
          (tab) => !snapshot.some((item) => item.key === tab.key && item.session === tab.session),
        )
      )
        return false;
      update({ ...current.current, tabs: [], active: "", close: null });
      return true;
    },
    [update],
  );
  return {
    tabs: state.tabs,
    active,
    closeRequest: state.close,
    select,
    requestClose,
    remove,
    readTabs,
    removeAll,
  };
}
