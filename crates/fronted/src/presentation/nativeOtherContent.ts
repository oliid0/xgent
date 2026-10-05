import type { PresentationDocument, PresentationHandler, PresentationNode } from "./types";

export type NativeOtherArea = "hooks" | "cron" | "ssh";
type ContentDocument = Omit<PresentationDocument, "surface" | "revision" | "version">;
export type NativeSettingsContent = {
  document: ContentDocument;
  handlers: ReadonlyMap<string, PresentationHandler>;
  onError: (error: unknown) => void;
  detail: boolean;
};
export type NativeSettingsContentSink = {
  update: (owner: symbol, content: NativeSettingsContent) => void;
  remove: (owner: symbol) => void;
};
type Entry = NativeSettingsContent & {
  area: NativeOtherArea;
  owner: symbol;
  epoch: number;
  signature: string;
};
const areas: NativeOtherArea[] = ["hooks", "cron", "ssh"];

// The three real section controllers retain their own state. Only the primary
// content joins this settings session; their confirmation alerts stay separate.
export function createNativeOtherContentStore() {
  const entries = new Map<NativeOtherArea, Entry>();
  const listeners = new Set<() => void>();
  let epoch = 0;
  let disposed = false;
  let snapshot: readonly Entry[] = [];
  const emit = () => {
    snapshot = areas.flatMap((area) => entries.get(area) ?? []);
    for (const listener of listeners) listener();
  };
  const sinks = Object.fromEntries(
    areas.map((area) => [
      area,
      {
        update(owner: symbol, content: NativeSettingsContent) {
          if (disposed) return;
          const previous = entries.get(area);
          const signature = JSON.stringify([
            content.document,
            content.detail,
            [...content.handlers].map(([id, handler]) => [
              id,
              handler.enabled,
              !!handler.normalize,
              !!handler.resultValue,
            ]),
          ]);
          entries.set(area, {
            ...content,
            area,
            owner,
            signature,
            epoch: previous?.owner === owner ? previous.epoch : ++epoch,
          });
          if (previous?.owner !== owner || previous.signature !== signature) emit();
        },
        remove(owner: symbol) {
          if (entries.get(area)?.owner !== owner) return;
          entries.delete(area);
          emit();
        },
      } satisfies NativeSettingsContentSink,
    ]),
  ) as Record<NativeOtherArea, NativeSettingsContentSink>;

  function current(area: NativeOtherArea, expectedEpoch: number, action: string) {
    const entry = entries.get(area);
    const detail = snapshot.find((item) => item.detail);
    if (disposed || !entry || entry.epoch !== expectedEpoch || (detail && detail.area !== area))
      throw new Error("This settings action is no longer available.");
    const handler = entry.handlers.get(action);
    if (!handler?.enabled) throw new Error("This settings action is no longer available.");
    return handler;
  }

  return {
    sinks,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    dispose() {
      disposed = true;
      entries.clear();
      emit();
      listeners.clear();
    },
    compose(options: {
      title: string;
      appearance: ContentDocument["appearance"];
      theme: ContentDocument["theme"];
      mobile: boolean;
      backLabel: string;
      labels: Record<NativeOtherArea, { title: string; description: string }>;
      onBack: () => void;
      onClose: () => void;
    }): { document: ContentDocument; handlers: Map<string, PresentationHandler> } {
      const detail = snapshot.find((entry) => entry.detail);
      const visible = detail ? [detail] : snapshot;
      const handlers = new Map<string, PresentationHandler>();
      const actionName = (entry: Entry, action: string) =>
        JSON.stringify(["other", entry.area, entry.epoch, action]);
      const nodesFor = (entry: Entry, preserveIDs: boolean): PresentationNode[] => {
        const rewrite = (node: PresentationNode): PresentationNode => ({
          ...node,
          id: preserveIDs ? node.id : `other:${entry.area}:${node.id}`,
          action: node.action ? actionName(entry, node.action) : undefined,
          commitAction: node.commitAction ? actionName(entry, node.commitAction) : undefined,
          diagramAction: node.diagramAction ? actionName(entry, node.diagramAction) : undefined,
          selectionAction: node.selectionAction
            ? actionName(entry, node.selectionAction)
            : undefined,
          ...(node.children ? { children: node.children.map(rewrite) } : {}),
        });
        for (const [id, handler] of entry.handlers) {
          handlers.set(actionName(entry, id), {
            ...handler,
            accepts: (value) => {
              try {
                return current(entry.area, entry.epoch, id).accepts(value);
              } catch {
                return false;
              }
            },
            ...(handler.normalize
              ? {
                  normalize: (value) => {
                    const normalize = current(entry.area, entry.epoch, id).normalize;
                    if (!normalize) throw new Error("This settings action has changed.");
                    return normalize(value);
                  },
                }
              : {}),
            run: (value) => current(entry.area, entry.epoch, id).run(value),
          });
        }
        return entry.document.nodes
          .filter((node) => preserveIDs || node.id !== "back")
          .map(rewrite);
      };
      if (detail) {
        return {
          document: {
            ...detail.document,
            mode: "sheet",
            nodes: nodesFor(detail, true),
            dismissAction: detail.document.dismissAction
              ? actionName(detail, detail.document.dismissAction)
              : undefined,
          },
          handlers,
        };
      }
      const close: PresentationHandler = {
        enabled: true,
        accepts: (value) => value === null,
        run: options.onClose,
      };
      handlers.set("other-close", close);
      handlers.set("other-back", { ...close, run: options.onBack });
      return {
        document: {
          mode: "sheet",
          title: options.title,
          appearance: options.appearance,
          theme: options.theme,
          formFactor: options.mobile ? "mobile" : "desktop",
          dismissAction: "other-close",
          nodes: [
            ...(options.mobile
              ? [
                  {
                    id: "back",
                    kind: "IconButton" as const,
                    icon: "chevron.left",
                    label: options.backLabel,
                    action: "other-back",
                  },
                ]
              : []),
            ...visible.map((entry) => ({
              id: `other:${entry.area}`,
              kind: "VStack" as const,
              variant: "other-settings-area",
              label: options.labels[entry.area].title,
              spacing: 12,
              children: [
                {
                  id: `other:${entry.area}:description`,
                  kind: "Text" as const,
                  text: options.labels[entry.area].description,
                  secondary: true,
                },
                ...nodesFor(entry, false),
              ],
            })),
          ],
        },
        handlers,
      };
    },
  };
}
