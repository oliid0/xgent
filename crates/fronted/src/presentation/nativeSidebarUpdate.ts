import { type AppUpdateController, getAppUpdateDisplayVersion } from "../lib/appUpdates";
import type { PresentationHandler, PresentationNode } from "./types";

export function createNativeSidebarUpdate(
  options: {
    readController: () => AppUpdateController | undefined;
    request: { busy: boolean; mounted: boolean };
    setBusy: (busy: boolean) => void;
  },
  t: (key: string) => string,
): { node?: PresentationNode; handlers: Map<string, PresentationHandler> } {
  const controller = options.readController();
  const handlers = new Map<string, PresentationHandler>();
  if (!controller?.showUpdateButton) return { handlers };
  const version = getAppUpdateDisplayVersion(controller.result);
  const scope = (value: AppUpdateController) =>
    JSON.stringify([
      "sidebar-update",
      value.installed,
      value.status,
      getAppUpdateDisplayVersion(value.result),
    ]);
  const action = scope(controller);
  const busy = options.request.busy || controller.installing || controller.restarting;
  const label =
    controller.status === "error" && controller.message
      ? t("appUpdate.failedRetry").replaceAll("{message}", controller.message)
      : controller.installed
        ? t("appUpdate.restartToComplete")
        : version
          ? t("appUpdate.updateTo").replaceAll("{version}", version)
          : t("appUpdate.update");
  handlers.set(action, {
    enabled: !busy,
    accepts: (value) => value === null,
    async run() {
      const current = options.readController();
      if (
        !options.request.mounted ||
        options.request.busy ||
        !current?.showUpdateButton ||
        current.installing ||
        current.restarting ||
        scope(current) !== action
      )
        throw new Error(t("settings.saving"));
      options.request.busy = true;
      options.setBusy(true);
      try {
        // Keep the shared controller's install, unsaved-work guard and restart.
        if (current.installed) await current.restart();
        else await current.installAndRestart();
      } finally {
        options.request.busy = false;
        if (options.request.mounted) options.setBusy(false);
      }
    },
  });
  return {
    handlers,
    node: {
      id: "sidebar-update",
      kind: "IconButton",
      variant: "sidebar-update",
      icon: controller.installed ? "arrow.clockwise" : "arrow.down",
      label,
      action,
      disabled: busy,
      status: busy ? "running" : controller.status === "error" ? "error" : "pending",
      accessibilityValue: t(
        controller.restarting
          ? "settings.aboutRestarting"
          : controller.installing
            ? "settings.aboutInstalling"
            : controller.installed
              ? "appUpdate.restart"
              : "appUpdate.update",
      ),
    },
  };
}
