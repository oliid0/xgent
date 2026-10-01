import type { PresentationDocument } from "./types";

/** Placement only; each existing shared controller still owns its data and close action. */
export function createNativeWorkspacePanel(
  t: (key: string) => string,
  compact: boolean,
  focusRequest = 0,
): Pick<PresentationDocument, "mode" | "workspacePanel"> {
  return compact
    ? { mode: "root" }
    : {
        mode: "panel",
        workspacePanel: {
          focusRequest,
          openLabel: t("chat.workspacePanel.open"),
          returnLabel: t("chat.workspacePanel.return"),
          expandLabel: t("chat.workspacePanel.expand"),
          restoreLabel: t("chat.workspacePanel.restore"),
          closeLabel: t("chat.workspacePanel.close"),
        },
      };
}
