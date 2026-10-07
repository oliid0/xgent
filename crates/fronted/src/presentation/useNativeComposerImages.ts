import { useEffect, useState } from "react";
import type { PendingUploadedFile } from "../lib/chat/messages/uploadedFiles";
import { invokeFs } from "../lib/tools/fsBackend";

// Use the same workspace-scoped image reader as the Astryx composer.
export function useNativeComposerImages(uploads: readonly PendingUploadedFile[], workdir: string) {
  const paths = JSON.stringify(
    uploads.filter((file) => file.kind === "image").map((file) => file.relativePath),
  );
  const owner = JSON.stringify([workdir, paths]);
  const [state, setState] = useState<{
    owner: string;
    images: Record<string, { source?: string; error?: string }>;
  }>({ owner: "", images: {} });
  useEffect(() => {
    let active = true;
    setState({ owner, images: {} });
    if (workdir.trim()) {
      for (const path of JSON.parse(paths) as string[]) {
        void invokeFs<{ mimeType: string; data: string }>("fs_read_workspace_image", {
          workdir,
          path,
        })
          .then(({ mimeType, data }) => ({ source: `data:${mimeType};base64,${data}` }))
          .catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
          }))
          .then((image) => {
            if (active)
              setState((previous) => ({ owner, images: { ...previous.images, [path]: image } }));
          });
      }
    }
    return () => {
      active = false;
    };
  }, [owner, paths, workdir]);
  return state.owner === owner ? state.images : {};
}
