import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { invoke } from "@xgent/runtime";
import { Fragment, memo, useState } from "react";
import { useLocale } from "../../i18n";
import type { ChatFileLink } from "../../lib/chat/chatFileLinks";
import type { CloudArtifactAttachment } from "../../lib/chat/messages/cloudArtifacts";

// Downloaded artifacts remain discoverable as inline filenames even when the
// assistant omitted a Markdown link. File edits have their own review card.
export const CloudArtifactsCard = memo(function CloudArtifactsCard({
  artifacts,
  onOpenFileLink,
}: {
  artifacts: CloudArtifactAttachment[];
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const { t } = useLocale();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  return (
    <Text as="p" type="body" className="break-words">
      {t("chat.cloudArtifacts.inline")}{" "}
      {artifacts.map((artifact, index) => {
        const name =
          artifact.localPath.replaceAll("\\", "/").split("/").pop() || artifact.artifactName;
        return (
          <Fragment key={`${artifact.taskId}:${artifact.artifactId}`}>
            {index > 0 ? ", " : ""}
            <Link
              href={encodeURI(artifact.localPath)}
              aria-busy={opening === artifact.localPath}
              onClick={(event) => {
                event.preventDefault();
                if (opening) return;
                setError("");
                if (onOpenFileLink) {
                  onOpenFileLink({ path: artifact.localPath, source: "absolute" });
                  return;
                }
                setOpening(artifact.localPath);
                void invoke("cloud_task_open_artifact", { localPath: artifact.localPath })
                  .catch((cause) => setError(String(cause)))
                  .finally(() => setOpening(null));
              }}
            >
              {name}
            </Link>
          </Fragment>
        );
      })}
      {error ? (
        <Text as="span" type="inherit" className="text-error" role="alert">
          {" "}
          {error}
        </Text>
      ) : null}
    </Text>
  );
});
