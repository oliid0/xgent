import { useEffect, useState } from "react";
import { type TerminalShellPreference, updateSystem } from "../lib/settings";
import { tauriTerminalClient } from "../lib/terminal/tauriTerminalClient";
import type { TerminalShellOption } from "../lib/terminal/types";
import { useTrayPrefs, writeTrayPrefs } from "../lib/tray/trayPrefs";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

type ShellDiscovery = {
  status: "loading" | "ready" | "error";
  options: TerminalShellOption[];
  error?: string;
};

/** macOS uses the same shell discovery and live tray preferences as desktop chat. */
export function useNativeDesktopSystem(
  { settings, setSettings }: SettingsSectionProps,
  enabled: boolean,
  t: (key: string) => string,
) {
  const tray = useTrayPrefs();
  const [shell, setShell] = useState<ShellDiscovery>({ status: "loading", options: [] });
  const [request] = useState(() => ({ active: enabled, revision: 0 }));

  async function refresh() {
    if (!request.active) return;
    const revision = ++request.revision;
    setShell({ status: "loading", options: [] });
    try {
      const result = await tauriTerminalClient.shellOptions();
      if (request.active && request.revision === revision) {
        setShell({ status: "ready", options: result.options });
      }
    } catch (cause) {
      if (request.active && request.revision === revision) {
        setShell({
          status: "error",
          options: [],
          error: cause instanceof Error ? cause.message : String(cause),
        });
        throw cause;
      }
    }
  }

  useEffect(() => {
    request.active = enabled;
    if (enabled) void refresh().catch(() => undefined);
    return () => {
      request.active = false;
      request.revision++;
    };
  }, [enabled]);

  const c = presentationControls();
  if (!enabled) return { nodes: [], handlers: c.handlers };
  const ready = shell.status === "ready" && shell.options.length > 0;
  const current = settings.system.terminalShell;
  const selected =
    current === "auto" || shell.options.some((option) => option.id === current) ? current : "auto";
  const nodes: PresentationNode[] = [
    c.group("desktop-terminal", "", [
      {
        ...c.select(
          "terminal-shell",
          t("settings.terminalShell"),
          selected,
          [
            { value: "auto", label: t("settings.terminalShellAuto") },
            ...shell.options.map((option) => ({ value: option.id, label: option.label })),
          ],
          (value) =>
            setSettings((previous) =>
              updateSystem(previous, { terminalShell: value as TerminalShellPreference }),
            ),
          ready,
        ),
        text: t("settings.terminalShellDesc"),
      },
      ...(!ready
        ? [
            {
              id: "desktop-shell-status",
              kind: "StatusDot" as const,
              status:
                shell.status === "loading"
                  ? ("running" as const)
                  : shell.status === "error"
                    ? ("error" as const)
                    : ("paused" as const),
              label:
                shell.status === "loading"
                  ? t("settings.loading")
                  : (shell.error ?? t("settings.terminalShellUnavailable")),
            },
          ]
        : []),
      c.action(
        "desktop-shell-refresh",
        t("settings.mobileRefresh"),
        refresh,
        shell.status !== "loading",
      ),
    ]),
    c.group("desktop-tray", t("settings.trayTitle"), [
      {
        ...c.toggle(
          "tray-show-titles",
          t("settings.trayShowTitles"),
          tray.showConversationTitles,
          (showConversationTitles) => writeTrayPrefs({ showConversationTitles }),
        ),
        text: t("settings.trayShowTitlesDesc"),
      },
      {
        ...c.toggle(
          "tray-running-badge",
          t("settings.trayRunningBadge"),
          tray.showRunningBadge,
          (showRunningBadge) => writeTrayPrefs({ showRunningBadge }),
        ),
        text: t("settings.trayRunningBadgeDesc"),
      },
    ]),
  ];
  return { nodes, handlers: c.handlers };
}
