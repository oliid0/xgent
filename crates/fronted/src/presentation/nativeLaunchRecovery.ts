import { t } from "../i18n/config";
import { createUuid } from "../lib/shared/id";
import { createPresentationActionRegistry } from "./actionRegistry";
import { presentationControls } from "./controls";
import { createPresentationDocumentChannel } from "./documentChannel";
import type { PresentationAction, PresentationActionResult, PresentationDocument } from "./types";
import { validatePresentationDocument } from "./validateDocument";

/** The boot error path cannot depend on React successfully importing. */
export function createNativeLaunchRecovery(deps: {
  publish: (document: PresentationDocument) => Promise<void>;
  subscribe: (receive: (action: PresentationAction) => void) => () => void;
  acknowledge: (result: PresentationActionResult) => Promise<void>;
  reload: () => void;
  nativeMobile: boolean;
}) {
  const surface = `xgent-launch-recovery:${createUuid()}`,
    registry = createPresentationActionRegistry();
  const channel = createPresentationDocumentChannel(deps.publish);
  let revision = 0,
    active = true,
    unsubscribe: (() => void) | undefined;
  const onError = (error: unknown) => console.error("Native launch recovery failed", error);
  const c = presentationControls();
  const reload = c.action("launch:reload", t("app.errorBoundaryReload", "system"), () => {
    if (active) deps.reload();
  });
  registry.register(surface, c.handlers);
  return {
    show(error?: unknown) {
      if (!active) return Promise.resolve();
      unsubscribe ??= deps.subscribe((action) => {
        if (active && action.surface === surface)
          void registry
            .dispatch(action)
            .then((result) => {
              if (active) return deps.acknowledge(result);
            })
            .catch(onError);
      });
      const document: PresentationDocument = {
        version: 1,
        surface,
        revision: ++revision,
        mode: "root",
        title: "",
        appearance: "system",
        formFactor: deps.nativeMobile ? "mobile" : "desktop",
        nodes: [
          {
            id: "launch:failure",
            kind: "Banner",
            variant: "error-screen",
            label: t("app.errorBoundaryTitle", "system"),
            icon: "exclamationmark.triangle",
            status: "error",
            text: (error instanceof Error
              ? error.message
              : error == null
                ? t("app.errorBoundaryTitle", "system")
                : String(error)
            ).slice(0, 8000),
            children: [reload],
          },
        ],
      };
      validatePresentationDocument(document, c.handlers);
      return channel.publish(document);
    },
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe?.();
      registry.remove(surface);
      if (revision > 0)
        void channel
          .publish({
            version: 1,
            surface,
            revision: ++revision,
            mode: "root",
            title: "",
            appearance: "system",
            nodes: [],
            removed: true,
          })
          .catch(onError);
    },
  };
}
