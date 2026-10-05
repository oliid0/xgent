import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../i18n";
import { isNativeMobileRuntime } from "../lib/runtimePlatform";
import {
  createWorkspaceSearchSource,
  type WorkspaceSearchItem,
  type WorkspaceSearchProps,
} from "../lib/search/workspaceSearchSource";
import type { AppSettings } from "../lib/settings";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import type { PresentationNode } from "./types";

const icons = {
  file: "doc",
  folder: "folder",
  chat: "bubble.left",
  plus: "plus",
  settings: "gearshape",
};

export function NativeWorkspaceSearchPalette(
  props: WorkspaceSearchProps & { settings: AppSettings },
) {
  const { t } = useLocale();
  const mobile = isNativeMobileRuntime();
  const latest = useRef(props);
  latest.current = props;
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [results, setResults] = useState<{
    items: WorkspaceSearchItem[];
    query: string;
    workdir?: string;
    epoch: number;
    retry: number;
    source: unknown;
  }>({ items: [], query: "", epoch: 0, retry: 0, source: null });
  const hasCreateProject = !!props.onCreateProject;
  const search = useMemo(
    () =>
      createWorkspaceSearchSource(
        {
          conversations: props.conversations,
          workdir: props.workdir,
          onSelectConversation: (id) => latest.current.onSelectConversation(id),
          onOpenFile: (path) => latest.current.onOpenFile(path),
          onOpenSettings: (section) => latest.current.onOpenSettings(section),
          onNewConversation: () => latest.current.onNewConversation(),
          onCreateProject: hasCreateProject ? () => latest.current.onCreateProject?.() : undefined,
        },
        mobile,
        t,
        setError,
      ),
    [props.conversations, props.workdir, hasCreateProject, mobile, t],
  );
  const active = useRef({ query, search, mounted: true });
  active.current.query = query;
  active.current.search = search;
  useEffect(() => {
    active.current.mounted = true;
    return () => {
      active.current.mounted = false;
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    const publish = (items: WorkspaceSearchItem[]) => {
      if (!disposed)
        setResults((previous) => ({
          items,
          query,
          workdir: props.workdir,
          source: search,
          epoch: previous.epoch + 1,
          retry,
        }));
    };
    if (!query.trim()) publish(search.source.bootstrap());
    const timer = query.trim()
      ? setTimeout(() => {
          void search.source.search(query).then(publish);
        }, 180)
      : undefined;
    return () => {
      disposed = true;
      clearTimeout(timer);
      search.source.cancel();
    };
  }, [search, query, props.workdir, retry]);

  const pending =
    results.source !== search ||
    results.query !== query ||
    results.workdir !== props.workdir ||
    results.retry !== retry;
  const c = presentationControls(
    JSON.stringify(["workspace-search", props.workdir ?? "", query, results.epoch]),
  );
  const close = () => {
    search.source.cancel();
    latest.current.onOpenChange(false);
  };
  const grouped = new Map<string, PresentationNode[]>();
  for (const [index, item] of results.items.entries()) {
    const row: PresentationNode = {
      ...c.action(
        `workspace-search-result:${index}`,
        item.label,
        () => {
          if (
            !active.current.mounted ||
            active.current.query !== query ||
            active.current.search !== search ||
            !latest.current.open
          )
            return;
          close();
          item.select();
        },
        !pending,
      ),
      kind: "NavigationRow",
      text: item.description,
      icon: icons[item.icon],
    };
    const group = grouped.get(item.auxiliaryData.group) ?? [];
    group.push(row);
    grouped.set(item.auxiliaryData.group, group);
  }
  const nodes: PresentationNode[] = [
    {
      id: "workspace-search-palette",
      kind: "VStack",
      variant: "workspace-search-palette",
      fill: true,
      children: [
        c.input("workspace-search-query", t("search.placeholder"), query, (value) => {
          setError("");
          setQuery(value);
        }),
        {
          ...c.action("workspace-search-close", t("common.close"), close),
          kind: "IconButton",
          icon: "xmark",
          variant: "ghost",
        },
        {
          id: "workspace-search-results",
          kind: "List",
          fill: true,
          children: [...grouped].map(([group, children], index) => ({
            id: `workspace-search-group:${index}`,
            kind: "VStack",
            label: group,
            children,
          })),
        },
        ...(pending
          ? [
              {
                id: "workspace-search-loading",
                kind: "ProgressBar" as const,
                label: t("common.loading"),
              },
            ]
          : []),
        ...(!pending && !results.items.length
          ? [
              {
                id: "workspace-search-empty",
                kind: "Text" as const,
                text: t("chat.history.searchEmpty"),
              },
            ]
          : []),
        ...(error
          ? [
              {
                id: "workspace-search-error",
                kind: "Text" as const,
                text: error,
                variant: "error",
              },
              c.action(
                "workspace-search-retry",
                t("search.retry"),
                () => setRetry((value) => value + 1),
                !pending,
              ),
            ]
          : []),
      ],
    },
  ];
  return (
    <NativeSurface
      document={{
        mode: "sheet",
        title: t("search.title"),
        appearance: props.settings.theme,
        formFactor: mobile ? "mobile" : "desktop",
        dismissAction: c.actionId("workspace-search-close"),
        theme: createNativePresentationTheme(props.settings, mobile, "sidebar"),
        nodes,
      }}
      handlers={c.handlers}
      onError={(failure) => setError(String(failure))}
    />
  );
}
