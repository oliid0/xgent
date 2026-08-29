import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Thumbnail } from "@astryxdesign/core/Thumbnail";
import { memo, useEffect, useState } from "react";
import { useLocale } from "../../i18n";
import type { ChatFileLink } from "../../lib/chat/chatFileLinks";
import type { CloudArtifactAttachment } from "../../lib/chat/messages/cloudArtifacts";
import { invokeFs } from "../../lib/tools/fsBackend";
import { invoke } from "../../runtime";
import { Archive, Eye, FolderOpen } from "../icons";
import { isWorkspaceImagePath } from "../workspace-editor/workspaceImagePreview";
import { getFileTypeIcon } from "./fileTypeIcons";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function artifactFileName(artifact: CloudArtifactAttachment): string {
  const fileName = artifact.localPath.replaceAll("\\", "/").split("/").pop()?.trim();
  return fileName || artifact.artifactName;
}

function artifactPreviewTarget(path: string) {
  const normalized = path.trim().replaceAll("\\", "/");
  const separator = normalized.lastIndexOf("/");
  if (separator < 0) return null;
  let workdir = normalized.slice(0, separator) || "/";
  if (/^[a-z]:$/i.test(workdir)) workdir = `${workdir}/`;
  const fileName = normalized.slice(separator + 1);
  return fileName ? { workdir, path: fileName } : null;
}

function ArtifactImageThumbnail({ artifact }: { artifact: CloudArtifactAttachment }) {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const fileName = artifactFileName(artifact);

  useEffect(() => {
    const target = artifactPreviewTarget(artifact.localPath);
    if (!target) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSource("");
    void invokeFs<{ data: string; mimeType: string }>("fs_read_workspace_image", target)
      .then((response) => {
        if (!cancelled) setSource(`data:${response.mimeType};base64,${response.data}`);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact.localPath]);

  return (
    <Thumbnail src={source || undefined} alt={fileName} label={fileName} isLoading={loading} />
  );
}

function ArtifactRow({
  artifact,
  onOpenFileLink,
}: {
  artifact: CloudArtifactAttachment;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const { t } = useLocale();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  const openArtifact = async () => {
    if (opening) return;
    if (onOpenFileLink) {
      setError("");
      onOpenFileLink({ path: artifact.localPath, source: "absolute" });
      return;
    }
    setOpening(true);
    setError("");
    try {
      await invoke("cloud_task_open_artifact", { localPath: artifact.localPath });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(false);
    }
  };

  const openLabel = `${t(
    onOpenFileLink ? "chat.cloudArtifacts.open" : "chat.cloudArtifacts.reveal",
  )}: ${artifactFileName(artifact)}`;
  const FileTypeIcon = getFileTypeIcon(artifact.localPath, "file");

  return (
    <ListItem
      label={
        <Text type="label" maxLines={1} hasTruncateTooltip="above">
          {artifactFileName(artifact)}
        </Text>
      }
      description={
        error ? (
          <Text type="supporting" color="primary" wordBreak="break-word">
            {error}
          </Text>
        ) : (
          <Text type="supporting" color="secondary" maxLines={1} hasTabularNumbers>
            {formatBytes(artifact.sizeBytes)} · {artifact.taskId}
          </Text>
        )
      }
      startContent={
        isWorkspaceImagePath(artifact.localPath) ? (
          <ArtifactImageThumbnail artifact={artifact} />
        ) : (
          <Icon icon={FileTypeIcon} size="sm" color="secondary" />
        )
      }
      endContent={
        opening ? (
          <Spinner size="sm" shade="subtle" aria-label={openLabel} />
        ) : (
          <Icon icon={onOpenFileLink ? Eye : FolderOpen} size="sm" color="secondary" />
        )
      }
      onClick={() => void openArtifact()}
      isDisabled={opening}
    />
  );
}

export const CloudArtifactsCard = memo(function CloudArtifactsCard({
  artifacts,
  onOpenFileLink,
}: {
  artifacts: CloudArtifactAttachment[];
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const { t } = useLocale();
  const title = t(
    artifacts.length === 1 ? "chat.cloudArtifacts.titleOne" : "chat.cloudArtifacts.title",
  ).replace("{count}", String(artifacts.length));

  return (
    <Card padding={0} elevation="low">
      <VStack gap={0}>
        <HStack gap={3} vAlign="center" padding={3}>
          <Icon icon={Archive} size="md" color="secondary" />
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Heading level={4}>{title}</Heading>
              <Text type="supporting" color="secondary">
                {t("chat.cloudArtifacts.hint")}
              </Text>
            </VStack>
          </StackItem>
        </HStack>
        <List
          density="compact"
          hasDividers
          aria-label={title}
          style={{
            maxHeight: "var(--xagent-artifacts-list-max-height)",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          {artifacts.map((artifact) => (
            <ArtifactRow
              key={`${artifact.taskId}:${artifact.artifactId}:${artifact.toolCallId}`}
              artifact={artifact}
              onOpenFileLink={onOpenFileLink}
            />
          ))}
        </List>
      </VStack>
    </Card>
  );
});
