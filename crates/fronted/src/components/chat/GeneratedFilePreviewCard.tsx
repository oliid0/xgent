import { useState } from "react";
import type { ChatFileLink } from "../../lib/chat/chatFileLinks";
import { OpenWithMenu } from "../workspace-editor/OpenWithMenu";
import { isWorkspacePreviewPath } from "../workspace-editor/workspaceImagePreview";
import { getFileTypeIcon } from "./fileTypeIcons";

export function GeneratedFilePreviewCard({
  paths,
  workdir,
  onOpenFileLink,
}: {
  paths: string[];
  workdir: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const [error, setError] = useState("");
  const files = paths.filter(isWorkspacePreviewPath);
  if (!files.length) return null;
  return (
    <div className="generated-file-cards">
      {files.map((path) => {
        const FileIcon = getFileTypeIcon(path, "file");
        const name = path.replace(/\\/g, "/").split("/").pop() || path;
        return (
          <div className="generated-file-card" key={path}>
            <FileIcon />
            <button
              type="button"
              className="generated-file-card-name"
              disabled={!onOpenFileLink}
              onClick={() => onOpenFileLink?.({ path, source: "relative" })}
            >
              <strong>{name}</strong>
              <span>{name.split(".").pop()?.toUpperCase()}</span>
            </button>
            <OpenWithMenu
              workdir={workdir}
              path={path}
              onError={setError}
              onPreview={
                onOpenFileLink ? () => onOpenFileLink({ path, source: "relative" }) : undefined
              }
            />
          </div>
        );
      })}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
