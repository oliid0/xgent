import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { memo, useState } from "react";

import { useLocale } from "../../i18n";
import type { CloudArtifactAttachment } from "../../lib/chat/messages/cloudArtifacts";
import { invoke } from "../../runtime";
import { Archive, FolderOpen } from "../icons";

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

function ArtifactRow({ artifact }: { artifact: CloudArtifactAttachment }) {
  const { t } = useLocale();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");

  const reveal = async () => {
    if (opening) return;
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

  const revealLabel = `${t("chat.cloudArtifacts.reveal")}: ${artifactFileName(artifact)}`;

  return (
    <ListItem
      label={
        <Text type="label" maxLines={1} hasTruncateTooltip="above">
          {artifactFileName(artifact)}
        </Text>
      }
      description={
        error ? (
          <Text type="supporting" color="error" wordBreak="break-word">
            {error}
          </Text>
        ) : (
          <Text type="supporting" color="secondary" maxLines={1} hasTabularNumbers>
            {formatBytes(artifact.sizeBytes)} · {artifact.taskId}
          </Text>
        )
      }
      startContent={<Icon icon={Archive} size="sm" color="secondary" />}
      endContent={
        opening ? (
          <Spinner size="sm" shade="subtle" aria-label={revealLabel} />
        ) : (
          <Icon icon={FolderOpen} size="sm" color="secondary" />
        )
      }
      onClick={() => void reveal()}
      isDisabled={opening}
      title={artifact.localPath}
      aria-label={revealLabel}
    />
  );
}

export const CloudArtifactsCard = memo(function CloudArtifactsCard({
  artifacts,
}: {
  artifacts: CloudArtifactAttachment[];
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
            />
          ))}
        </List>
      </VStack>
    </Card>
  );
});
