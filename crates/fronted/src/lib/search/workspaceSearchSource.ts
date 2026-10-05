import type { SectionId } from "../../pages/settings/types";
import { searchChatHistory } from "../chat/history/chatHistory";
import type { SidebarConversation } from "../sidebar/types";
import { invokeFs } from "../tools/fsBackend";

export type WorkspaceSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: readonly SidebarConversation[];
  workdir?: string;
  onSelectConversation: (id: string) => void;
  onOpenFile: (path: string) => void;
  onOpenSettings: (section?: SectionId) => void;
  onNewConversation: () => void;
  onCreateProject?: () => void;
};

export type WorkspaceSearchItem = {
  id: string;
  label: string;
  auxiliaryData: { group: string };
  description?: string;
  icon: "file" | "folder" | "chat" | "plus" | "settings";
  select: () => void;
};

const SETTINGS: [SectionId, string][] = [
  ["system", "settings.navSystem"],
  ["system", "settings.ui.title"],
  ["system", "settings.ui.accentLight"],
  ["toolPermissions", "settings.commandSafety.title"],
  ["providers", "settings.navProviders"],
  ["failover", "settings.navFailover"],
  ["projectRoots", "settings.navProjectRoots"],
  ["skills", "settings.navSkills"],
  ["hooks", "settings.navHooks"],
  ["cron", "settings.navCron"],
  ["ssh", "settings.navSsh"],
  ["usage", "settings.navUsage"],
  ["soul", "settings.navSoul"],
  ["memory", "settings.navMemory"],
  ["computerUse", "settings.cua.title"],
  ["toolPermissions", "settings.navToolPermissions"],
  ["access", "settings.navAccess"],
  ["backup", "settings.navBackup"],
  ["other", "settings.navOther"],
  ["about", "settings.navAbout"],
];

/** Search data and actions shared by Astryx's command palette and Apple's native palette. */
export function createWorkspaceSearchSource(
  props: Omit<WorkspaceSearchProps, "open" | "onOpenChange">,
  mobile: boolean,
  t: (key: string) => string,
  reportError: (message: string) => void,
) {
  let generation = 0;
  let results: WorkspaceSearchItem[] = [];
  const item = (
    id: string,
    label: string,
    group: string,
    icon: WorkspaceSearchItem["icon"],
    select: () => void,
    description?: string,
  ): WorkspaceSearchItem => ({ id, label, auxiliaryData: { group }, icon, select, description });
  const settings = [
    ...SETTINGS,
    ...((mobile
      ? [
          ["mobileAssistant", "settings.navMobileAssistant"],
          ["mobileExecution", "settings.navMobileExecution"],
        ]
      : [
          ["voice", "settings.navVoice"],
          ["shortcuts", "settings.navShortcuts"],
        ]) as [SectionId, string][]),
  ].map(([section, key]) =>
    item(`settings:${section}:${key}`, t(key), t("search.settings"), "settings", () =>
      props.onOpenSettings(section),
    ),
  );
  const actions = [
    item("new", t("chat.newConversation"), t("search.actions"), "plus", props.onNewConversation),
  ];
  if (props.onCreateProject)
    actions.push(
      item("folder", t("search.openFolder"), t("search.actions"), "folder", props.onCreateProject),
    );
  const initial = [
    ...props.conversations
      .slice(0, 5)
      .map((conversation) =>
        item(
          `chat:${conversation.id}`,
          conversation.title || t("tray.untitledConversation"),
          t("search.chats"),
          "chat",
          () => props.onSelectConversation(conversation.id),
        ),
      ),
    ...actions,
    ...settings,
  ];
  const source = {
    bootstrap() {
      generation++;
      reportError("");
      results = initial;
      return results;
    },
    cancel() {
      generation++;
    },
    async search(query: string) {
      const request = ++generation;
      reportError("");
      const normalized = query.trim().toLocaleLowerCase();
      if (!normalized) {
        results = initial;
        return results;
      }
      const matches = [...actions, ...settings].filter((entry) =>
        entry.label.toLocaleLowerCase().includes(normalized),
      );
      // Preserve literal glob metacharacters, including Windows separators.
      const literal = query
        .trim()
        .replaceAll("\\", "/")
        .replace(/[*?[\]{}]/g, (character) => `[${character}]`);
      const [history, files] = await Promise.allSettled([
        searchChatHistory(query.trim(), 20),
        props.workdir
          ? invokeFs<{ paths: string[] }>("fs_glob", {
              workdir: props.workdir,
              pattern: `**/*${literal}*`,
              max_results: 20,
            })
          : Promise.resolve({ paths: [] }),
      ]);
      if (request !== generation) return [];
      reportError(
        [
          history.status === "rejected" ? t("chat.history.searchFailed") : "",
          files.status === "rejected" ? t("search.filesFailed") : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
      results = [
        ...(history.status === "fulfilled"
          ? history.value.map((match, index) =>
              item(
                `chat:${match.conversationId}:${index}`,
                match.title || t("tray.untitledConversation"),
                t("search.chats"),
                "chat",
                () => props.onSelectConversation(match.conversationId),
                match.snippet.replaceAll("[", "").replaceAll("]", ""),
              ),
            )
          : []),
        ...(files.status === "fulfilled"
          ? files.value.paths.map((path) =>
              item(
                `file:${path}`,
                path,
                t("search.files"),
                "file",
                () => props.onOpenFile(path),
                props.workdir,
              ),
            )
          : []),
        ...matches,
      ];
      return results;
    },
  };
  return { source, currentResults: () => results };
}
