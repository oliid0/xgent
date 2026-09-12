import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocale } from "../i18n";
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
import type { PresentationHandler, PresentationNode, PresentationValue } from "./types";

type NativeViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

function parseViewport(value: PresentationValue): NativeViewport | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<NativeViewport>;
    if (
      ![parsed.x, parsed.y, parsed.width, parsed.height].every(
        (item) => typeof item === "number" && Number.isFinite(item),
      ) ||
      typeof parsed.visible !== "boolean"
    ) {
      return null;
    }
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

/** Native browser chrome over the shared BrowserSessionController/WebKit session. */
export function NativeBrowserPage(props: { settings: AppSettings }) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const state = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  const sessions = browserSessionController.sessionsForConversation();
  const active = sessions.find((session) => session.sessionId === state.activeSessionId);
  const [address, setAddress] = useState("");
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (state.panelOpen) void browserSessionController.initialize().catch(setFailure);
  }, [state.panelOpen]);
  useEffect(() => {
    setAddress(active?.url === "about:blank" ? "" : (active?.url ?? ""));
  }, [active?.url]);
  useEffect(() => {
    const sessionId = active?.sessionId;
    return () => {
      if (sessionId) void browserSessionController.setViewport(sessionId, HIDDEN_BROWSER_VIEWPORT);
    };
  }, [active?.sessionId]);

  if (failure) throw failure;
  if (!state.panelOpen || (compact && state.panelOpenSource !== "user")) return null;

  const handlers = new Map<string, PresentationHandler>();
  const bind = (
    id: string,
    run: (value: PresentationValue) => unknown,
    accepts: (value: PresentationValue) => boolean,
    enabled = true,
  ) => {
    handlers.set(id, { enabled, accepts, run });
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
    disabled: !enabled,
    action: bind(id, run, (value) => value === null, enabled),
  });
  const run = (action: "navigate" | "reload" | "go_back" | "go_forward") => {
    if (!active) return;
    return browserSessionController.action(
      action,
      action === "navigate" ? { url: normalizeBrowserAddress(address) } : {},
      { sessionId: active.sessionId },
    );
  };
  handlers.set("close", {
    enabled: true,
    accepts: (value) => value === null,
    run: () => browserSessionController.closePanel(),
  });
  const busy = Boolean(active && state.busySessionIds.includes(active.sessionId));
  const nodes: PresentationNode[] = [
    {
      id: "browser-layout",
      kind: "BrowserLayout",
      fill: true,
      children: [
        {
          id: "browser-toolbar",
          kind: "HStack",
          padding: 8,
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
            {
              id: "browser-tabs",
              kind: "Selector",
              label: t("browser.title"),
              value: active?.sessionId ?? "",
              disabled: sessions.length === 0,
              options: sessions.map((session) => ({
                value: session.sessionId,
                label: session.title?.trim() || session.url || t("browser.untitled"),
              })),
              action: bind(
                "browser-tabs",
                (value) => browserSessionController.selectSession(value as string),
                (value) =>
                  typeof value === "string" &&
                  sessions.some((session) => session.sessionId === value),
                sessions.length > 0,
              ),
            },
            { id: "browser-toolbar-space", kind: "Spacer" },
            button(
              "browser-new",
              t("browser.newTab"),
              "plus",
              () => browserSessionController.newSession(),
              sessions.length < MAX_BROWSER_SESSIONS,
            ),
            button(
              "browser-close-tab",
              t("browser.closeTab"),
              "xmark",
              () => active && browserSessionController.closeSession(active.sessionId),
              !!active,
            ),
            button("browser-close", t("browser.close"), "xmark.circle", () =>
              browserSessionController.closePanel(),
            ),
          ],
        },
        {
          id: "browser-address-row",
          kind: "HStack",
          padding: 8,
          children: [
            {
              id: "browser-address",
              kind: "TextInput",
              label: t("browser.addressPlaceholder"),
              value: address,
              fill: true,
              disabled: !active,
              action: bind(
                "browser-address",
                (value) => setAddress(value as string),
                (value) => typeof value === "string",
                !!active,
              ),
            },
            button(
              "browser-go",
              t("browser.open"),
              "arrow.right",
              () => run("navigate"),
              !!active && !!address.trim() && !busy,
            ),
            button(
              "browser-reload",
              t("browser.reload"),
              "arrow.clockwise",
              () => run("reload"),
              !!active && !busy,
            ),
          ],
        },
        ...(state.error
          ? [
              {
                id: "browser-error",
                kind: "Banner" as const,
                label: state.error,
                status: "error" as const,
              },
            ]
          : []),
        ...(active
          ? [
              {
                id: `browser-viewport:${active.sessionId}`,
                kind: "BrowserViewport" as const,
                label: t("browser.title"),
                fill: true,
                action: bind(
                  `browser-viewport:${active.sessionId}`,
                  (value) => {
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
                id: "browser-preparing",
                kind: "EmptyState" as const,
                icon: "globe",
                label: t("browser.preparing"),
                text: t("browser.startBrowsingDescription"),
              },
            ]),
      ],
    },
  ];

  return (
    <NativeSurface
      document={{
        mode: "root",
        title: t("browser.title"),
        appearance: props.settings.theme,
        formFactor: compact ? "mobile" : "desktop",
        theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
        nodes,
        dismissAction: "close",
      }}
      handlers={handlers}
      onError={setFailure}
    />
  );
}
