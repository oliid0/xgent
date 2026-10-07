import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocale } from "../i18n";
import { canOpenBrowserPage, runBrowserPageAction } from "../lib/browser/browserPageActions";
import {
  browserSessionController,
  HIDDEN_BROWSER_VIEWPORT,
  MAX_BROWSER_SESSIONS,
  normalizeBrowserAddress,
} from "../lib/browser/browserSessionController";
import { isNativeMobileRuntime } from "../lib/runtimePlatform";
import type { AppSettings } from "../lib/settings";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import { createNativeWorkspacePanel } from "./nativeWorkspacePanel";
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

type NativeViewport = { x: number; y: number; width: number; height: number; visible: boolean };
function parseViewport(value: PresentationValue): NativeViewport | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<NativeViewport>;
    if (
      ![parsed.x, parsed.y, parsed.width, parsed.height].every(
        (item) => typeof item === "number" && Number.isFinite(item),
      ) ||
      typeof parsed.visible !== "boolean"
    )
      return null;
    return {
      x: Math.max(0, parsed.x as number),
      y: Math.max(0, parsed.y as number),
      width: Math.max(1, parsed.width as number),
      height: Math.max(1, parsed.height as number),
      visible: parsed.visible,
    };
  } catch {
    return null;
  }
}

/** Native chrome; the shared controller owns every browser session and command. */
export function NativeBrowserPage(props: {
  settings: AppSettings;
  tools?: readonly {
    id: string;
    label: string;
    icon: string;
    run: () => void;
    enabled?: boolean;
  }[];
}) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const state = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  const sessions = browserSessionController.sessionsForConversation();
  const active = sessions.find((session) => session.sessionId === state.activeSessionId);
  const visible = state.panelOpen && (!compact || state.panelOpenSource === "user");
  const [address, setAddress] = useState("");
  const [failure, setFailure] = useState("");
  const addressRef = useRef({ sessionId: "", text: "" });
  const commands = useRef(new Set<string>());
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!state.panelOpen) return;
    let current = true;
    setFailure("");
    void browserSessionController.initialize().catch((cause) => {
      if (current) setFailure(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      current = false;
    };
  }, [state.panelOpen]);
  useEffect(() => {
    const text = active?.url === "about:blank" ? "" : (active?.url ?? "");
    addressRef.current = { sessionId: active?.sessionId ?? "", text };
    setAddress(text);
  }, [active?.sessionId, active?.url]);
  useEffect(() => {
    const sessionId = visible ? active?.sessionId : undefined;
    return () => {
      if (sessionId)
        void browserSessionController
          .setViewport(sessionId, HIDDEN_BROWSER_VIEWPORT)
          .catch(() => undefined);
    };
  }, [active?.sessionId, visible]);
  useEffect(() => {
    if (visible && active?.sessionId && active.url === "about:blank") {
      void browserSessionController
        .setViewport(active.sessionId, HIDDEN_BROWSER_VIEWPORT)
        .catch(() => undefined);
    }
  }, [active?.sessionId, active?.url, visible]);
  if (!visible) return null;

  const handlers = new Map<string, PresentationHandler>();
  const currentSession = (id: string | undefined) =>
    alive.current &&
    !!id &&
    browserSessionController.getSnapshot().panelOpen &&
    browserSessionController.getSnapshot().activeSessionId === id &&
    browserSessionController.sessionsForConversation().some((session) => session.sessionId === id);
  const bind = (
    id: string,
    run: (value: PresentationValue) => unknown,
    accepts: (value: PresentationValue) => boolean,
    enabled = true,
  ) => {
    handlers.set(id, {
      enabled,
      accepts,
      run: (value) => {
        if (!alive.current || !browserSessionController.getSnapshot().panelOpen) return;
        return run(value);
      },
    });
    return id;
  };
  const button = (
    id: string,
    label: string,
    icon: string,
    run: () => unknown,
    enabled = true,
  ): PresentationNode => ({
    id,
    kind: "IconButton",
    label,
    icon,
    variant: "ghost",
    disabled: !enabled,
    action: bind(id, run, (value) => value === null, enabled),
  });
  const run = async (
    action: "navigate" | "reload" | "go_back" | "go_forward" | "open_devtools",
    submitted?: string,
  ) => {
    const id = active?.sessionId;
    if (
      !currentSession(id) ||
      !id ||
      commands.current.has(id) ||
      browserSessionController.getSnapshot().busySessionIds.includes(id)
    )
      return;
    const text =
      submitted ?? (addressRef.current.sessionId === id ? addressRef.current.text : address);
    if (action === "navigate" && !text.trim()) return;
    commands.current.add(id);
    try {
      return await browserSessionController.action(
        action,
        action === "navigate" ? { url: normalizeBrowserAddress(text) } : {},
        { sessionId: id },
      );
    } finally {
      commands.current.delete(id);
    }
  };
  const close = () => browserSessionController.closePanel();
  bind("close", close, (value) => value === null);
  const busy = !!active && state.busySessionIds.includes(active.sessionId);
  const suffix = active?.sessionId ?? "empty";
  const inputID = `browser-address:${suffix}`;
  const submitID = `browser-go:${suffix}`;
  const entry: PresentationNode = {
    id: "browser-address-entry",
    kind: "VStack",
    variant: "browser-address-entry",
    fill: true,
    children: [
      {
        id: inputID,
        kind: "TextInput",
        label: t("browser.addressPlaceholder"),
        text: t("browser.addressPlaceholder"),
        value: address,
        disabled: !active,
        action: bind(
          inputID,
          (value) => {
            if (!currentSession(active?.sessionId)) return;
            addressRef.current = { sessionId: active!.sessionId, text: value as string };
            setAddress(value as string);
          },
          (value) => typeof value === "string",
          !!active,
        ),
      },
      {
        id: submitID,
        kind: "IconButton",
        label: t("browser.open"),
        icon: "arrow.right",
        variant: "ghost",
        disabled: !active || busy,
        action: bind(
          submitID,
          (value) => run("navigate", typeof value === "string" ? value : undefined),
          (value) => value === null || typeof value === "string",
          !!active && !busy,
        ),
      },
    ],
  };
  const navigation: PresentationNode = {
    id: "browser-navigation",
    kind: "VStack",
    variant: "browser-navigation",
    children: [
      button(
        "browser-back",
        t("browser.back"),
        "chevron.left",
        () => run("go_back"),
        !!active && !busy,
      ),
      button(
        "browser-forward",
        t("browser.forward"),
        "chevron.right",
        () => run("go_forward"),
        !!active && !busy,
      ),
      entry,
      button(
        "browser-reload",
        t("browser.reload"),
        "arrow.clockwise",
        () => run("reload"),
        !!active && !busy,
      ),
      {
        id: "browser-more",
        kind: "Menu",
        variant: "compact",
        label: t("browser.more"),
        icon: "ellipsis",
        children: [
          ...(["copy_address", "open_external"] as const).map((action) =>
            button(
              `browser-${action}`,
              t(action === "copy_address" ? "browser.copyAddress" : "browser.openExternal"),
              action === "copy_address" ? "doc.on.doc" : "arrow.up.right.square",
              async () => {
                if (!currentSession(active?.sessionId) || !active) return;
                setFailure("");
                try {
                  await runBrowserPageAction(action, active.url);
                } catch {
                  if (currentSession(active.sessionId)) setFailure(t("browser.pageActionFailed"));
                }
              },
              canOpenBrowserPage(active?.url),
            ),
          ),
          ...(!compact
            ? [
                button(
                  "browser-devtools",
                  t("browser.developerTools"),
                  "terminal",
                  () => run("open_devtools"),
                  !!active && !busy,
                ),
              ]
            : []),
        ],
      },
      ...(compact ? [button("browser-close", t("browser.close"), "xmark", close)] : []),
    ],
  };
  const tabs: PresentationNode = {
    id: "browser-tabs",
    kind: "VStack",
    variant: "browser-tabs",
    children: [
      button(
        "browser-new",
        t("browser.newTab"),
        "plus",
        () => browserSessionController.newSession("about:blank"),
        state.sessions.length < MAX_BROWSER_SESSIONS,
      ),
      {
        id: "browser-tab-items",
        kind: "VStack",
        variant: "browser-tab-items",
        children: sessions.map((session) => ({
          id: `browser-tab:${session.sessionId}`,
          kind: "Button",
          label: session.title?.trim() || browserTabLabel(session.url) || t("browser.untitled"),
          text: session.url,
          selected: session.sessionId === active?.sessionId,
          status: state.busySessionIds.includes(session.sessionId) ? "running" : undefined,
          action: bind(
            `browser-tab:${session.sessionId}`,
            () => {
              if (alive.current) browserSessionController.selectSession(session.sessionId);
            },
            (value) => value === null,
          ),
        })),
      },
      ...(!compact
        ? [
            {
              id: "browser-tab-count",
              kind: "Badge" as const,
              label: `${state.sessions.length}/${MAX_BROWSER_SESSIONS}`,
            },
          ]
        : []),
      button(
        "browser-close-tab",
        t("browser.closeTab"),
        "xmark",
        () =>
          currentSession(active?.sessionId) &&
          browserSessionController.closeSession(active!.sessionId),
        !!active,
      ),
    ],
  };
  const localError = failure || state.error;
  const errorNodes: PresentationNode[] = localError
    ? [
        {
          id: "browser-error",
          kind: "VStack",
          variant: "browser-error",
          children: [
            { id: "browser-error-message", kind: "Banner", status: "error", label: localError },
            button("browser-dismiss-error", t("browser.dismissError"), "xmark", () => {
              setFailure("");
              browserSessionController.clearError();
            }),
          ],
        },
      ]
    : [];
  const blank = active?.url === "about:blank";
  const nodes: PresentationNode[] = [
    {
      id: "browser-layout",
      kind: "BrowserLayout",
      fill: true,
      children: [
        ...(!compact
          ? [
              {
                id: "browser-header",
                kind: "VStack" as const,
                variant: "browser-header",
                children: [
                  {
                    id: "browser-heading",
                    kind: "VStack" as const,
                    children: [
                      {
                        id: "browser-title",
                        kind: "Heading" as const,
                        text: t("browser.title"),
                        icon: "globe",
                      },
                      {
                        id: "browser-status",
                        kind: "Text" as const,
                        text: state.busySessionIds.length
                          ? t("browser.agentOperating")
                          : t("browser.sharedSession"),
                        secondary: true,
                      },
                    ],
                  },
                  button("browser-header-close", t("browser.close"), "xmark", close),
                ],
              },
            ]
          : []),
        tabs,
        navigation,
        ...errorNodes,
        ...(active && !blank
          ? [
              {
                id: `browser-viewport:${active.sessionId}`,
                kind: "BrowserViewport" as const,
                label: t("browser.title"),
                fill: true,
                action: bind(
                  `browser-viewport:${active.sessionId}`,
                  (value) => {
                    if (!currentSession(active.sessionId)) return;
                    const viewport = parseViewport(value);
                    if (!viewport) throw new Error("Invalid native browser viewport");
                    return browserSessionController.setViewport(active.sessionId, {
                      ...viewport,
                      scaleFactor: window.devicePixelRatio || 1,
                    });
                  },
                  (value) => parseViewport(value) !== null,
                ),
              },
            ]
          : [
              {
                id: "browser-empty",
                kind: "VStack" as const,
                variant: "browser-empty",
                fill: true,
                children: [
                  {
                    id: "browser-empty-message",
                    kind: "EmptyState" as const,
                    icon: "globe",
                    label: t(state.initializing ? "browser.preparing" : "browser.startBrowsing"),
                    text: t("browser.startBrowsingDescription"),
                  },
                  ...(blank && props.tools?.length
                    ? [
                        {
                          id: "browser-new-tab-tools",
                          kind: "HStack" as const,
                          wrap: true,
                          children: props.tools.map((tool) => ({
                            ...button(
                              `browser-tool:${tool.id}`,
                              tool.label,
                              tool.icon,
                              tool.run,
                              tool.enabled !== false,
                            ),
                            kind: "Button" as const,
                            variant: "secondary",
                          })),
                        },
                      ]
                    : []),
                  ...(!active
                    ? [
                        button(
                          "browser-empty-new",
                          t("browser.newTab"),
                          "plus",
                          () => browserSessionController.newSession(),
                          state.sessions.length < MAX_BROWSER_SESSIONS,
                        ),
                      ]
                    : []),
                ],
              },
            ]),
      ],
    },
  ];
  return (
    <NativeSurface
      document={{
        ...createNativeWorkspacePanel(t, compact, state.panelFocusRequest),
        title: t("browser.title"),
        appearance: props.settings.theme,
        formFactor: compact ? "mobile" : "desktop",
        theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
        nodes,
        dismissAction: "close",
      }}
      handlers={handlers}
      onError={(cause) => {
        if (alive.current && browserSessionController.getSnapshot().panelOpen)
          setFailure(cause instanceof Error ? cause.message : String(cause));
      }}
    />
  );
}

function browserTabLabel(url: string) {
  if (url === "about:blank") return "";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
