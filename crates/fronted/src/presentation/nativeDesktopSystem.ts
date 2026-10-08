import { type TerminalShellPreference, updateSystem } from "../lib/settings";
import { useTerminalShellDiscovery } from "../lib/terminal/useTerminalShellDiscovery";
import { useTrayPrefs, writeTrayPrefs } from "../lib/tray/trayPrefs";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

/** macOS uses the same shell discovery and live tray preferences as desktop chat. */
export function useNativeDesktopSystem(
  { settings, setSettings }: SettingsSectionProps,
  enabled: boolean,
  t: (key: string) => string,
) {
  const tray = useTrayPrefs();
  const { shell, refresh } = useTerminalShellDiscovery(enabled);

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
