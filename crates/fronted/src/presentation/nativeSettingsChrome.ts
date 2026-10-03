import type { PresentationDocument, PresentationHandler, PresentationNode } from "./types";

type NativeSettingsChrome = {
  sidebar: PresentationNode;
  saveStatus: PresentationNode;
  handlers: ReadonlyMap<string, PresentationHandler>;
};

const sessions = new Map<string, NativeSettingsChrome>();

export function setNativeSettingsChrome(surface: string, chrome?: NativeSettingsChrome) {
  if (chrome) sessions.set(surface, chrome);
  else sessions.delete(surface);
}

/** Preserve desktop settings navigation when a section publishes its own state. */
export function withNativeSettingsChrome(
  surface: string,
  document: Omit<PresentationDocument, "surface" | "revision" | "version">,
  handlers: ReadonlyMap<string, PresentationHandler>,
) {
  const chrome = sessions.get(surface);
  if (
    !chrome ||
    document.mode !== "sheet" ||
    document.formFactor !== "desktop" ||
    document.nodes.some((node) => node.kind === "SettingsLayout")
  )
    return { document, handlers };
  const canClose = !!document.dismissAction;
  const shellHandlers = new Map(chrome.handlers);
  const close = shellHandlers.get("settings-close");
  if (close) shellHandlers.set("settings-close", { ...close, enabled: canClose && close.enabled });
  return {
    document: {
      ...document,
      dismissAction: document.dismissAction ? "settings-close" : undefined,
      nodes: [
        {
          id: "settings-layout",
          kind: "SettingsLayout",
          fill: true,
          children: [
            {
              ...chrome.sidebar,
              children: chrome.sidebar.children?.map((node) =>
                node.id === "settings-close"
                  ? { ...node, disabled: !canClose || node.disabled }
                  : node,
              ),
            },
            {
              id: "settings-detail",
              kind: "ScrollView",
              fill: true,
              children: [
                { id: "settings-detail-title", kind: "Heading", text: document.title },
                chrome.saveStatus,
                ...document.nodes.filter((node) => node.id !== "save-status"),
              ],
            },
          ],
        },
      ] as PresentationNode[],
    },
    // Section actions remain intact, while the shell keeps search/close/nav live.
    handlers: new Map([...handlers, ...shellHandlers]),
  };
}
