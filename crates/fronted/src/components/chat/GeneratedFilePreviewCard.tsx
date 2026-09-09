import { useState } from "react";
import type { ChatFileLink } from "../../lib/chat/chatFileLinks";
import type { ChangedFilesSummary } from "../../lib/chat/messages/changedFiles";
import { OpenWithMenu } from "../workspace-editor/OpenWithMenu";
import { isWorkspacePreviewPath } from "../workspace-editor/workspaceImagePreview";
import { getFileTypeIcon } from "./fileTypeIcons";

export function GeneratedFilePreviewCard({
  summary,
  workdir,
  onOpenFileLink,
}: {
  summary: ChangedFilesSummary;
  workdir: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const [error, setError] = useState("");
  const files = summary.files.filter((file) => !file.deleted && isWorkspacePreviewPath(file.path));
  if (!files.length) return null;
  return (
    <div className="generated-file-cards">
      {files.map((file) => {
        const FileIcon = getFileTypeIcon(file.path, "file");
        const name = file.path.replace(/\\/g, "/").split("/").pop() || file.path;
        return (
          <div className="generated-file-card" key={file.path}>
            <FileIcon />
            <button
              type="button"
              className="generated-file-card-name"
              disabled={!onOpenFileLink}
              onClick={() => onOpenFileLink?.({ path: file.path, source: "relative" })}
            >
              <strong>{name}</strong>
              <span>{name.split(".").pop()?.toUpperCase()}</span>
            </button>
            <OpenWithMenu
              workdir={workdir}
              path={file.path}
              onError={setError}
              onPreview={
                onOpenFileLink
                  ? () => onOpenFileLink({ path: file.path, source: "relative" })
                  : undefined
              }
            />
          </div>
        );
      })}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
