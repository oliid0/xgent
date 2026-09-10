import {
  CommandPalette,
  CommandPaletteFooter,
  CommandPaletteInput,
} from "@astryxdesign/core/CommandPalette";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { SearchSource } from "@astryxdesign/core/Typeahead";
import { useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import { searchChatHistory } from "../../lib/chat/history/chatHistory";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import type { SidebarConversation } from "../../lib/sidebar/types";
import { invokeFs } from "../../lib/tools/fsBackend";
import type { SectionId } from "../../pages/settings/types";
import { File, FolderOpen, MessageSquare, Plus, Settings } from "../icons";

type SearchItem = {
  id: string;
  label: string;
  auxiliaryData: { group: string };
  description?: string;
  icon: typeof File;
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

export function WorkspaceSearchPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: readonly SidebarConversation[];
  workdir?: string;
  onSelectConversation: (id: string) => void;
  onOpenFile: (path: string) => void;
  onOpenSettings: (section?: SectionId) => void;
  onNewConversation: () => void;
  onCreateProject?: () => void;
}) {
  const { t } = useLocale();
  const results = useRef<SearchItem[]>([]);
  const [searchError, setSearchError] = useState("");
  const source = useMemo<SearchSource<SearchItem>>(() => {
    let generation = 0;
    const item = (
      id: string,
      label: string,
      group: string,
      icon: typeof File,
      select: () => void,
      description?: string,
    ): SearchItem => ({ id, label, auxiliaryData: { group }, icon, select, description });
    const settings = [
      ...SETTINGS,
      ...((isNativeMobileRuntime()
        ? [
            ["mobileAssistant", "settings.navMobileAssistant"],
            ["mobileExecution", "settings.navMobileExecution"],
          ]
        : [
            ["voice", "settings.navVoice"],
            ["shortcuts", "settings.navShortcuts"],
          ]) as [SectionId, string][]),
    ].map(([section, key]) =>
      item(`settings:${section}:${key}`, t(key), t("search.settings"), Settings, () =>
        props.onOpenSettings(section),
      ),
    );
    const actions = [
      item("new", t("chat.newConversation"), t("search.actions"), Plus, props.onNewConversation),
    ];
    if (props.onCreateProject)
      actions.push(
        item(
          "folder",
          t("search.openFolder"),
          t("search.actions"),
          FolderOpen,
          props.onCreateProject,
        ),
      );
    const initial = [
      ...props.conversations
        .slice(0, 5)
        .map((conversation) =>
          item(
            `chat:${conversation.id}`,
            conversation.title || t("tray.untitledConversation"),
            t("search.chats"),
            MessageSquare,
            () => props.onSelectConversation(conversation.id),
          ),
        ),
      ...actions,
      ...settings,
    ];
    return {
      bootstrap() {
        generation++;
        setSearchError("");
        results.current = initial;
        return initial;
      },
      cancel() {
        generation++;
      },
      async search(query) {
        const request = ++generation;
        setSearchError("");
        const normalized = query.trim().toLocaleLowerCase();
        if (!normalized) {
          results.current = initial;
          return initial;
        }
        const matches = [...actions, ...settings].filter((entry) =>
          entry.label.toLocaleLowerCase().includes(normalized),
        );
        // fs_glob normalizes backslashes to separators. Character classes
        // preserve literal metacharacters across Windows and Unix backends.
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
        setSearchError(
          [
            history.status === "rejected" ? t("chat.history.searchFailed") : "",
            files.status === "rejected" ? t("search.filesFailed") : "",
          ]
            .filter(Boolean)
            .join(" · "),
        );
        const next = [
          ...(history.status === "fulfilled"
            ? history.value.map((match, index) =>
                item(
                  `chat:${match.conversationId}:${index}`,
                  match.title || t("tray.untitledConversation"),
                  t("search.chats"),
                  MessageSquare,
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
                  File,
                  () => props.onOpenFile(path),
                  props.workdir,
                ),
              )
            : []),
          ...matches,
        ];
        results.current = next;
        return next;
      },
    };
  }, [
    props.conversations,
    props.workdir,
    props.onSelectConversation,
    props.onOpenFile,
    props.onOpenSettings,
    props.onNewConversation,
    props.onCreateProject,
    props.onOpenChange,
    t,
  ]);

  return (
    <CommandPalette
      isOpen={props.open}
      onOpenChange={props.onOpenChange}
      searchSource={source}
      label={t("search.title")}
      input={<CommandPaletteInput placeholder={t("search.placeholder")} />}
      width="min(640px, calc(100vw - 24px))"
      maxHeight="min(560px, calc(100dvh - 80px))"
      emptySearchText={t("chat.history.searchEmpty")}
      footer={
        searchError ? (
          <CommandPaletteFooter>
            <Text color="secondary" type="supporting" role="alert">
              {searchError} · {t("search.retry")}
            </Text>
          </CommandPaletteFooter>
        ) : undefined
      }
      onValueChange={(id) => results.current.find((entry) => entry.id === id)?.select()}
      renderItem={(entry) => (
        <HStack gap={3} vAlign="center" width="100%" style={{ minWidth: 0 }}>
          <Icon icon={entry.icon} size="sm" color="secondary" />
          <VStack gap={0} style={{ minWidth: 0, flex: 1 }}>
            <Text type="body" maxLines={1}>
              {entry.label}
            </Text>
            {entry.description ? (
              <Text type="supporting" color="secondary" maxLines={2}>
                {entry.description}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      )}
    />
  );
}
