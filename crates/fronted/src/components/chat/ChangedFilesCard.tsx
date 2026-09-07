// Reply-footer changed-files card: lists every file the assistant reply
// wrote/edited/deleted with per-file +N/-N stats, and wires the three
// file-reference actions (open editor / reveal in file tree / view diff).
// Rendered only after the reply settles (never mid-stream). Actions arrive
// through context so transcript row props stay memo-stable; without a
// provider (shared read-only views) the card renders as plain data.

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { createContext, memo, useContext, useMemo, useState } from "react";

import { useLocale } from "../../i18n";
import { useCheckpointRewind } from "../../lib/chat/checkpointRewind";
import type { ChangedFileEntry, ChangedFilesSummary } from "../../lib/chat/messages/changedFiles";
import { ConfirmActionPopover } from "../astryx/ConfirmActionPopover";
import { ChevronDown, ChevronUp, FileText, Undo2 } from "../icons";
import { FileChangeBadge } from "./FileChangeBadge";

export type ChangedFilesActions = {
  onOpenFile?: (path: string) => void;
  onRevealInFileTree?: (path: string) => void;
  /** null = open the latest diffable edit; this is independent from Git state. */
  onOpenDiff?: (file: ChangedFileEntry | null) => void;
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

const MAX_VISIBLE_FILES = 3;
const DIFFABLE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cfg",
  "cpp",
  "cs",
  "css",
  "dart",
  "env",
  "ex",
  "exs",
  "go",
  "gradle",
  "graphql",
  "h",
  "hpp",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "kts",
  "less",
  "lock",
  "lua",
  "md",
  "mdx",
  "php",
  "properties",
  "py",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

function canDiffPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return DIFFABLE_EXTENSIONS.has(extension);
}

const ChangedFileRow = memo(function ChangedFileRow({ file }: { file: ChangedFileEntry }) {
  const { t } = useLocale();
  const actions = useChangedFilesActions();
  const { dir, base } = splitPath(file.path);
  const canOpen = Boolean(actions?.onOpenFile) && !file.deleted;
  const canDiff = Boolean(actions?.onOpenDiff) && canDiffPath(file.path);

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
          <Text as="span" type="inherit" color="secondary">
            {dir}
          </Text>
          {base}
        </Text>
      }
      endContent={
        <HStack gap={1} vAlign="center">
          {file.deleted ? (
            <Token label={t("chat.changedFiles.deleted")} size="sm" color="gray" />
          ) : (
            <FileChangeBadge added={file.added} removed={file.removed} />
          )}
        </HStack>
      }
      onClick={
        canDiff
          ? () => actions?.onOpenDiff?.(file)
          : canOpen
            ? () => actions?.onOpenFile?.(file.path)
            : undefined
      }
    />
  );
});

export const ChangedFilesCard = memo(function ChangedFilesCard({
  summary,
  turnId,
}: {
  summary: ChangedFilesSummary;
  turnId?: string;
}) {
  const { t } = useLocale();
  const actions = useChangedFilesActions();
  const [expanded, setExpanded] = useState(false);
  const [rewindError, setRewindError] = useState("");
  const rewind = useCheckpointRewind();
  const title = useMemo(() => {
    const key =
      summary.files.length === 1 ? "chat.changedFiles.titleOne" : "chat.changedFiles.title";
    return t(key).replace("{count}", String(summary.files.length));
  }, [summary.files.length, t]);
  const hasDiffableFiles = summary.files.some((file) => canDiffPath(file.path));

  return (
    <Card padding={0} className="changed-files-card">
      <VStack gap={0}>
        <HStack gap={3} vAlign="center" padding={4} className="changed-files-header">
          <VStack padding={3} className="changed-files-icon">
            <Icon icon={FileText} size="md" color="secondary" />
          </VStack>
          <StackItem size="fill">
            <VStack gap={1}>
              <Heading level={4}>{title}</Heading>
              <FileChangeBadge added={summary.totalAdded} removed={summary.totalRemoved} />
            </VStack>
          </StackItem>
          {rewind?.available && turnId ? (
            <ConfirmActionPopover
              title={t("chat.checkpointRewind.title")}
              description={t("chat.checkpointRewind.description")}
              confirmLabel={t("chat.checkpointRewind.confirm")}
              onConfirm={() => {
                setRewindError("");
                void rewind.rewindTurn(turnId).catch((error) => setRewindError(String(error)));
              }}
            >
              {() => (
                <Button
                  label={t("chat.changedFiles.undo")}
                  variant="ghost"
                  size="sm"
                  endContent={<Icon icon={Undo2} size="sm" />}
                  isLoading={rewind.busyTurnId === turnId}
                  isDisabled={rewind.busyTurnId !== null}
                />
              )}
            </ConfirmActionPopover>
          ) : null}
          {actions?.onOpenDiff && hasDiffableFiles ? (
            <Button
              label={t("chat.changedFiles.review")}
              size="sm"
              variant="secondary"
              onClick={() =>
                actions.onOpenDiff?.(
                  summary.files.filter((file) => canDiffPath(file.path)).at(-1) ?? null,
                )
              }
            />
          ) : null}
        </HStack>
        {rewindError ? <Banner status="error" title={rewindError} /> : null}
        <List density="compact" aria-label={title}>
          {(expanded ? summary.files : summary.files.slice(0, MAX_VISIBLE_FILES)).map((file) => (
            <ChangedFileRow key={file.lastToolCallId || file.path} file={file} />
          ))}
        </List>
        {summary.files.length > MAX_VISIBLE_FILES ? (
          <HStack padding={3}>
            <Button
              variant="ghost"
              size="sm"
              label={
                expanded
                  ? t("chat.changedFiles.collapse")
                  : t("chat.changedFiles.expand").replace(
                      "{count}",
                      String(summary.files.length - MAX_VISIBLE_FILES),
                    )
              }
              endContent={<Icon icon={expanded ? ChevronUp : ChevronDown} size="sm" />}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            />
          </HStack>
        ) : null}
      </VStack>
    </Card>
  );
});
