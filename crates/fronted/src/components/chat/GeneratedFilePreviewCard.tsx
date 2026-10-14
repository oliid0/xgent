import { Button } from "@astryxdesign/core/Button";
import { useMemo, useState } from "react";
import { useLocale } from "../../i18n";
import type { ChatFileLink } from "../../lib/chat/chatFileLinks";
import { backgroundChatArtifactLabel } from "../../lib/chat/messages/backgroundArtifacts";
import type { PreviewedFile } from "../../lib/chat/messages/previewedFiles";
import {
  restoreWorkspaceFilePort,
  workspaceFileSourceKey,
} from "../../lib/tools/workspaceFileSource";
import { OpenWithMenu } from "../workspace-editor/OpenWithMenu";
import { isWorkspacePreviewPath } from "../workspace-editor/workspaceImagePreview";
import { getFileTypeIcon } from "./fileTypeIcons";

export function GeneratedFilePreviewCard({
  paths,
  previewedFiles = [],
  workdir,
  onOpenFileLink,
}: {
  paths: string[];
  previewedFiles?: PreviewedFile[];
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const { t } = useLocale();
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const files = useMemo(
    () =>
      [
        ...paths.map((path) => ({
          path,
          workdir,
          key: JSON.stringify([workdir, path]),
          commandPort: undefined,
          fileSource: undefined,
          backgroundArtifact: undefined,
        })),
        ...previewedFiles.map((file) => ({
          ...file,
          workdir: file.fileSource?.workdir,
          key: JSON.stringify([
            file.fileSource ? workspaceFileSourceKey(file.fileSource) : "unknown",
            file.toolCallId,
            file.path,
          ]),
          commandPort: file.fileSource ? restoreWorkspaceFilePort(file.fileSource) : undefined,
          fileSource: file.fileSource ?? null,
        })),
      ].filter((file) => !!file.backgroundArtifact || isWorkspacePreviewPath(file.path)),
    [paths, previewedFiles, workdir],
  );
  if (!files.length) return null;
  return (
    <div className="generated-file-cards">
      {files.map((file) => {
        const { path } = file;
        const link: ChatFileLink = {
          path,
          source: "relative",
          ...(file.fileSource !== undefined ? { fileSource: file.fileSource } : {}),
          ...(file.backgroundArtifact ? { backgroundArtifact: file.backgroundArtifact } : {}),
        };
        const FileIcon = getFileTypeIcon(path, "file");
        const name = path.replace(/\\/g, "/").split("/").pop() || path;
        return (
          <div className="generated-file-card" key={file.key}>
            <FileIcon />
            <button
              type="button"
              className="generated-file-card-name"
              disabled={!onOpenFileLink}
              title={file.fileSource ? `${file.fileSource.hostId} · ${file.workdir}` : file.workdir}
              onClick={() => onOpenFileLink?.(link)}
            >
              <strong>{name}</strong>
              <span>
                {file.backgroundArtifact
                  ? backgroundChatArtifactLabel(file.backgroundArtifact)
                  : `${name.split(".").pop()?.toUpperCase()}${file.fileSource ? ` · ${file.fileSource.hostId.slice(0, 8)}` : ""}`}
              </span>
            </button>
            <div className="generated-file-card-actions">
              {file.backgroundArtifact ? (
                <Button
                  label={t("backgroundInbox.download")}
                  variant="ghost"
                  size="sm"
                  isDisabled={!onOpenFileLink}
                  clickAction={async () => {
                    await onOpenFileLink?.(link);
                  }}
                />
              ) : (
                <OpenWithMenu
                  workdir={file.workdir ?? ""}
                  commandPort={file.commandPort}
                  enabled={!!file.workdir && file.fileSource !== null}
                  path={path}
                  onError={(message) => setError({ key: file.key, message })}
                  onPreview={onOpenFileLink ? () => onOpenFileLink(link) : undefined}
                />
              )}
            </div>
          </div>
        );
      })}
      {error?.message && files.some((file) => file.key === error.key) ? (
        <p role="alert">{error.message}</p>
      ) : null}
    </div>
  );
}
