import { useToast } from "@astryxdesign/core/Toast";
import { useCallback } from "react";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import { type AppNotificationOptions, appNotifications } from "./appNotifications";

/** One notification API with platform-native presentation. */
export function useAppToast() {
  const showWebToast = useToast();
  return useCallback(
    (options: AppNotificationOptions) =>
      isApplePresentationRuntime() ? appNotifications.show(options) : showWebToast(options),
    [showWebToast],
  );
}
