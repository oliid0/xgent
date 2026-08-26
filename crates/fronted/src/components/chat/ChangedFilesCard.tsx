// Reply-footer changed-files card: lists every file the assistant reply
// wrote/edited/deleted with per-file +N/-N stats, and wires the three
// file-reference actions (open editor / reveal in file tree / view diff).
// Rendered only after the reply settles (never mid-stream). Actions arrive
// through context so transcript row props stay memo-stable; without a
// provider (shared read-only views) the card renders as plain data.
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { createContext, memo, useContext, useMemo } from "react";

import { useLocale } from "../../i18n";
import type { ChangedFileEntry, ChangedFilesSummary } from "../../lib/chat/messages/changedFiles";
import { FilePenLine, FolderTree, GitCommitHorizontal } from "../icons";
import { FileChangeBadge } from "./FileChangeBadge";
import { getFileTypeIcon } from "./fileTypeIcons";

export type ChangedFilesActions = {
  onOpenFile?: (path: string) => void;
  onRevealInFileTree?: (path: string) => void;
  /** null = open the review panel without focusing a specific file. */
  onOpenDiff?: (path: string | null) => void;
};

const ChangedFilesActionsContext = createContext<ChangedFilesActions | null>(null);

export const ChangedFilesActionsProvider = ChangedFilesActionsContext.Provider;

export function useChangedFilesActions(): ChangedFilesActions | null {
  return useContext(ChangedFilesActionsContext);
}

function splitPath(path: string): { dir: string; base: string } {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return { dir: "", base: normalized };
  return { dir: normalized.slice(0, index + 1), base: normalized.slice(index + 1) };
}

const MAX_VISIBLE_FILES = 5;

const ChangedFileRow = memo(function ChangedFileRow({ file }: { file: ChangedFileEntry }) {
  const { t } = useLocale();
  const actions = useChangedFilesActions();
  const { dir, base } = splitPath(file.path);
  const canOpen = Boolean(actions?.onOpenFile) && !file.deleted;
  const FileTypeIcon = getFileTypeIcon(file.path, "file");
  const openLabel = `${t("chat.changedFiles.open")}: ${file.path}`;
  const revealLabel = `${t("chat.changedFiles.reveal")}: ${file.path}`;
  const diffLabel = `${t("chat.changedFiles.diff")}: ${file.path}`;

  return (
    <ListItem
      label={
        <Text
          type="label"
          maxLines={1}
          hasTruncateTooltip="above"
          hasStrikethrough={file.deleted}
          color={file.deleted ? "secondary" : "primary"}
        >
          {base}
        </Text>
      }
      description={
        <Text type="supporting" color="secondary" maxLines={1} hasTruncateTooltip="above">
          {dir || "."}
        </Text>
      }
      startContent={
        <Icon
          icon={FileTypeIcon}
          size="sm"
          color={file.deleted ? "disabled" : "secondary"}
        />
      }
      endContent={
        <HStack gap={1} vAlign="center">
          {file.deleted ? (
            <Token label={t("chat.changedFiles.deleted")} size="sm" color="gray" />
          ) : (
            <FileChangeBadge added={file.added} removed={file.removed} />
          )}
          {actions?.onRevealInFileTree ? (
            <IconButton
              label={revealLabel}
              tooltip={revealLabel}
              icon={<Icon icon={FolderTree} size="sm" color="inherit" />}
              size="sm"
              variant="ghost"
              onClick={() => actions.onRevealInFileTree?.(file.path)}
            />
          ) : null}
          {actions?.onOpenDiff ? (
            <IconButton
              label={diffLabel}
              tooltip={diffLabel}
              icon={<Icon icon={GitCommitHorizontal} size="sm" color="inherit" />}
              size="sm"
              variant="ghost"
              onClick={() => actions.onOpenDiff?.(file.path)}
            />
          ) : null}
        </HStack>
      }
      onClick={canOpen ? () => actions?.onOpenFile?.(file.path) : undefined}
      title={file.path}
      aria-label={canOpen ? openLabel : file.path}
    />
  );
});

export const ChangedFilesCard = memo(function ChangedFilesCard({
  summary,
}: {
  summary: ChangedFilesSummary;
}) {
  const { t } = useLocale();
  const actions = useChangedFilesActions();
  const title = useMemo(() => {
    const key =
      summary.files.length === 1 ? "chat.changedFiles.titleOne" : "chat.changedFiles.title";
    return t(key).replace("{count}", String(summary.files.length));
  }, [summary.files.length, t]);

  return (
    <Card padding={0} elevation="low">
      <VStack gap={0}>
        <HStack gap={3} vAlign="center" padding={3}>
          <Icon icon={FilePenLine} size="md" color="secondary" />
          <StackItem size="fill">
            <VStack gap={1}>
              <Heading level={4}>{title}</Heading>
              <FileChangeBadge added={summary.totalAdded} removed={summary.totalRemoved} />
            </VStack>
          </StackItem>
          {actions?.onOpenDiff ? (
            <Button
              label={t("chat.changedFiles.review")}
              icon={<Icon icon={GitCommitHorizontal} size="sm" color="inherit" />}
              size="sm"
              variant="ghost"
              onClick={() => actions.onOpenDiff?.(null)}
            />
          ) : null}
        </HStack>
        <List
          density="compact"
          hasDividers
          aria-label={title}
          style={
            summary.files.length > MAX_VISIBLE_FILES
              ? {
                  maxHeight: "var(--xagent-changed-files-list-max-height)",
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                }
              : undefined
          }
        >
          {summary.files.map((file) => (
            <ChangedFileRow key={file.lastToolCallId || file.path} file={file} />
          ))}
        </List>
      </VStack>
    </Card>
  );
});
