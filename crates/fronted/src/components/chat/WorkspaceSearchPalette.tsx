import {
  CommandPalette,
  CommandPaletteFooter,
  CommandPaletteInput,
} from "@astryxdesign/core/CommandPalette";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useMemo, useState } from "react";
import { useLocale } from "../../i18n";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import {
  createWorkspaceSearchSource,
  type WorkspaceSearchProps,
} from "../../lib/search/workspaceSearchSource";
import { File, FolderOpen, MessageSquare, Plus, Settings } from "../icons";

const icons = {
  file: File,
  folder: FolderOpen,
  chat: MessageSquare,
  plus: Plus,
  settings: Settings,
};

export function WorkspaceSearchPalette(props: WorkspaceSearchProps) {
  const { t } = useLocale();
  const [searchError, setSearchError] = useState("");
  const search = useMemo(
    () =>
      createWorkspaceSearchSource(
        {
          conversations: props.conversations,
          workdir: props.workdir,
          onSelectConversation: props.onSelectConversation,
          onOpenFile: props.onOpenFile,
          onOpenSettings: props.onOpenSettings,
          onNewConversation: props.onNewConversation,
          onCreateProject: props.onCreateProject,
        },
        isNativeMobileRuntime(),
        t,
        setSearchError,
      ),
    [
      props.conversations,
      props.workdir,
      props.onSelectConversation,
      props.onOpenFile,
      props.onOpenSettings,
      props.onNewConversation,
      props.onCreateProject,
      t,
    ],
  );

  return (
    <CommandPalette
      isOpen={props.open}
      onOpenChange={props.onOpenChange}
      searchSource={search.source}
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
      onValueChange={(id) =>
        search
          .currentResults()
          .find((entry) => entry.id === id)
          ?.select()
      }
      renderItem={(entry) => (
        <HStack gap={3} vAlign="center" width="100%" style={{ minWidth: 0 }}>
          <Icon icon={icons[entry.icon]} size="sm" color="secondary" />
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
