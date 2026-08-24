import { invoke } from "@xagent/runtime";
import type { CronTask } from "../automation/types";
import type { Locale } from "../../i18n/config";
import { t } from "../../i18n/config";
import type { SidebarConversation } from "../sidebar/types";
import type { Theme, WorkspaceProject } from "../settings";
import { workspaceProjectPathKey } from "../settings";
import { readGlobalShortcutBindings } from "../shortcuts/globalShortcuts";
import type { TrayPrefs } from "./trayPrefs";

const TRAY_RECENT_LIMIT = 8;
const TRAY_WORKSPACE_LIMIT = 8;
const TRAY_RUNS_LIMIT = 10;
const TRAY_CRON_LIMIT = 10;

export type TrayMenuEntry = {
  id: string;
  label: string;
  checked?: boolean;
};

export type TrayMenuModel = {
  labels: {
    show: string;
    newChat: string;
    pin: string;
    recent: string;
    recentViewAll: string;
    workspaces: string;
    runs: string;
    stopAll: string;
    cron: string;
    appearance: string;
    themeLight: string;
    themeDark: string;
    themeSystem: string;
    settings: string;
    checkUpdates: string;
    openDataDir: string;
    quit: string;
  };
  statusSuffix: string | null;
  recent: TrayMenuEntry[];
  recentTruncated: boolean;
  workspaces: TrayMenuEntry[];
  runs: TrayMenuEntry[];
  cron: TrayMenuEntry[];
  theme: Theme;
  showAccelerator: string | null;
  newChatAccelerator: string | null;
  tooltip: string | null;
  badgeText: string | null;
};

export type BuildTrayMenuModelInput = {
  locale: Locale;
  theme: Theme;
  conversations: readonly SidebarConversation[];
  runningConversationIds: ReadonlySet<string>;
  workspaceProjects: readonly WorkspaceProject[];
  activeWorkspaceProjectId: string | undefined;
  archivedWorkspaceProjectPaths: readonly string[];
  cronTasks: readonly CronTask[];
  prefs: TrayPrefs;
};

function withCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

function enabledAccelerator(action: "summon" | "newChat"): string | null {
  const binding = readGlobalShortcutBindings()[action];
  if (!binding || binding.enabled === false) return null;
  return binding.accelerator.trim() || null;
}

function conversationLabel(
  conversation: SidebarConversation,
  index: number,
  locale: Locale,
  prefs: TrayPrefs,
): string {
  if (!prefs.showConversationTitles) {
    return withCount(t("tray.conversationPlaceholder", locale), index + 1);
  }
  return conversation.title.trim() || t("tray.untitledConversation", locale);
}

export function buildTrayMenuModel(input: BuildTrayMenuModelInput): TrayMenuModel {
  const persisted = input.conversations.filter((conversation) => !conversation.isPending);
  const recent = persisted.slice(0, TRAY_RECENT_LIMIT).map((conversation, index) => ({
    id: conversation.id,
    label: conversationLabel(conversation, index, input.locale, input.prefs),
  }));
  const archivedKeys = new Set(
    input.archivedWorkspaceProjectPaths.map((path) => workspaceProjectPathKey(path)),
  );
  const workspaces = input.workspaceProjects
    .filter((project) => !archivedKeys.has(workspaceProjectPathKey(project.path)))
    .slice(0, TRAY_WORKSPACE_LIMIT)
    .map((project) => ({
      id: project.id,
      label: project.name,
      checked: project.id === input.activeWorkspaceProjectId,
    }));

  const runs: TrayMenuEntry[] = [];
  let runIndex = 0;
  for (const conversation of persisted) {
    if (runs.length >= TRAY_RUNS_LIMIT) break;
    if (!input.runningConversationIds.has(conversation.id)) continue;
    runs.push({
      id: conversation.id,
      label: conversationLabel(conversation, runIndex, input.locale, input.prefs),
    });
    runIndex += 1;
  }
  const runningCount = input.runningConversationIds.size;
  const cron = input.cronTasks.slice(0, TRAY_CRON_LIMIT).map((task) => ({
    id: task.id,
    label: task.name.trim() || t("tray.untitledCronTask", input.locale),
    checked: task.enabled,
  }));
  const appearanceKey =
    input.theme === "light"
      ? "tray.themeLight"
      : input.theme === "dark"
        ? "tray.themeDark"
        : "tray.themeSystem";

  return {
    labels: {
      show: t("tray.show", input.locale),
      newChat: t("tray.newChat", input.locale),
      pin: t("tray.pin", input.locale),
      recent: t("tray.recent", input.locale),
      recentViewAll: t("tray.recentViewAll", input.locale),
      workspaces: t("tray.workspaces", input.locale),
      runs:
        runningCount > 0
          ? withCount(t("tray.runsActive", input.locale), runningCount)
          : t("tray.runsIdle", input.locale),
      stopAll: t("tray.stopAll", input.locale),
      cron: t("tray.cron", input.locale),
      appearance: `${t("tray.appearance", input.locale)} · ${t(appearanceKey, input.locale)}`,
      themeLight: t("tray.themeLight", input.locale),
      themeDark: t("tray.themeDark", input.locale),
      themeSystem: t("tray.themeSystem", input.locale),
      settings: t("tray.settings", input.locale),
      checkUpdates: t("tray.checkUpdates", input.locale),
      openDataDir: t("tray.openDataDir", input.locale),
      quit: t("tray.quit", input.locale),
    },
    statusSuffix:
      runningCount > 0 ? withCount(t("tray.tooltipRunning", input.locale), runningCount) : null,
    recent,
    recentTruncated: persisted.length > TRAY_RECENT_LIMIT,
    workspaces,
    runs,
    cron,
    theme: input.theme,
    showAccelerator: enabledAccelerator("summon"),
    newChatAccelerator: enabledAccelerator("newChat"),
    tooltip:
      runningCount > 0
        ? `XAgent · ${withCount(t("tray.tooltipRunning", input.locale), runningCount)}`
        : "XAgent",
    badgeText: input.prefs.showRunningBadge && runningCount > 0 ? String(runningCount) : null,
  };
}

let lastSyncedSignature: string | null = null;

export async function syncTrayMenu(model: TrayMenuModel): Promise<void> {
  const signature = JSON.stringify(model);
  if (signature === lastSyncedSignature) return;
  try {
    await invoke("app_tray_menu_sync", { model });
    lastSyncedSignature = signature;
  } catch {
    // Browser/mobile runtimes do not expose a native tray.
  }
}
