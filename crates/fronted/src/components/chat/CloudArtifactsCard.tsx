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

  return (
    <div className="group/cloud-artifact min-w-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-foreground/[0.04]">
      <div className="flex min-w-0 items-center gap-2">
        <Archive className="h-4 w-4 shrink-0 text-muted-foreground/75" />
        <button
          type="button"
          disabled={opening}
          onClick={() => void reveal()}
          title={artifact.localPath}
          className="min-w-0 flex-1 text-left focus-visible:outline-none disabled:opacity-60"
        >
          <span className="block truncate font-mono text-[calc(11.5px*var(--zone-font-scale,1))] leading-[1.5] text-foreground/90">
            {artifactFileName(artifact)}
          </span>
          <span className="block truncate text-[calc(10.5px*var(--zone-font-scale,1))] text-muted-foreground/65">
            {formatBytes(artifact.sizeBytes)} · {artifact.taskId}
          </span>
        </button>
        <button
          type="button"
          disabled={opening}
          onClick={() => void reveal()}
          title={t("chat.cloudArtifacts.reveal")}
          aria-label={t("chat.cloudArtifacts.reveal")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none disabled:opacity-50"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </div>
      {error ? (
        <div className="mt-1 break-words pl-6 text-[calc(10.5px*var(--zone-font-scale,1))] text-destructive">
          {error}
        </div>
      ) : null}
    </div>
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
    <div className="overflow-hidden rounded-xl border border-border/45 bg-background/60 backdrop-blur-sm dark:border-white/[0.07] dark:bg-white/[0.03]">
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/45 bg-background/75 text-foreground/70 dark:border-white/[0.08] dark:bg-white/[0.05]">
          <Archive className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[calc(12px*var(--zone-font-scale,1))] font-medium text-foreground/85">
            {title}
          </div>
          <div className="text-[calc(10.5px*var(--zone-font-scale,1))] text-muted-foreground/65">
            {t("chat.cloudArtifacts.hint")}
          </div>
        </div>
      </div>
      <div className="flex max-h-[calc(150px*var(--zone-font-scale,1))] flex-col gap-0.5 overflow-y-auto border-t border-border/35 px-1 py-1 dark:border-white/[0.05]">
        {artifacts.map((artifact) => (
          <ArtifactRow
            key={`${artifact.taskId}:${artifact.artifactId}:${artifact.toolCallId}`}
            artifact={artifact}
          />
        ))}
      </div>
    </div>
  );
});
