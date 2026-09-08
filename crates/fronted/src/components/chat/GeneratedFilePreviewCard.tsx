import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { useState } from "react";
import { useLocale } from "../../i18n";
import type { ChatFileLink } from "../../lib/chat/chatFileLinks";
import type { ChangedFilesSummary } from "../../lib/chat/messages/changedFiles";
import { invokeFs } from "../../lib/tools/fsBackend";
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
  const { t } = useLocale();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = async (path: string, mode: string) => {
    setError("");
    setBusy(true);
    try {
      await invokeFs("fs_open_workspace_path", { workdir, path, mode });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
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
              disabled={!onOpenFileLink || busy}
              onClick={() => onOpenFileLink?.({ path: file.path, source: "relative" })}
            >
              <strong>{name}</strong>
              <span>{name.split(".").pop()?.toUpperCase()}</span>
            </button>
            <DropdownMenu
              button={{
                label: t("workspaceFiles.openWith"),
                variant: "ghost",
                size: "sm",
                isDisabled: busy,
              }}
              items={[
                {
                  label: t("workspaceFilePreview.preview"),
                  isDisabled: !onOpenFileLink,
                  onClick: () => onOpenFileLink?.({ path: file.path, source: "relative" }),
                },
                {
                  label: t("workspaceFiles.openWith"),
                  onClick: () => void open(file.path, "choose"),
                },
                {
                  label: t("workspaceFiles.revealInFinder"),
                  onClick: () => void open(file.path, "reveal"),
                },
              ]}
            />
          </div>
        );
      })}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
