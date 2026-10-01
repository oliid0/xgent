import type { ToastDismissReason, ToastOptions } from "@astryxdesign/core/Toast";
import { createUuid } from "../../lib/shared/id";

// App call sites use message toasts. Custom-rendered interactive content must
// have its own native presentation rather than silently losing its controls.
export type AppNotificationOptions = Omit<ToastOptions, "endContent" | "renderContent">;
export type AppNotification = { id: string; options: AppNotificationOptions };

export function createAppNotificationStore(nextId: () => string = createUuid) {
  let entries: readonly AppNotification[] = [];
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const dismiss = (id: string, reason: ToastDismissReason = "manual") => {
    const current = entries.find((entry) => entry.id === id);
    if (!current) return;
    // Remove first: onHide can synchronously dismiss or show another toast.
    entries = entries.filter((entry) => entry.id !== id);
    publish();
    current.options.onHide?.(reason);
  };
  return {
    getSnapshot: () => entries,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dismiss,
    show(options: AppNotificationOptions) {
      const id = nextId(),
        existing = options.uniqueID
          ? entries.find((entry) => entry.options.uniqueID === options.uniqueID)
          : undefined;
      if (existing && options.collisionBehavior === "ignore") return () => {};
      const entry = { id, options };
      // Match Astryx: overwrite in place without invoking the old onHide.
      entries = existing
        ? entries.map((item) => (item.id === existing.id ? entry : item))
        : [...entries, entry];
      publish();
      return () => dismiss(id);
    },
  };
}

export const appNotifications = createAppNotificationStore();
