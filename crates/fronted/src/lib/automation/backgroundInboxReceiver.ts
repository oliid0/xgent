import type { BackgroundInboxItem, BackgroundInboxPage, BackgroundInboxSync } from "./types";

type InboxPorts = {
  syncBackgroundInbox: () => Promise<BackgroundInboxSync>;
  listBackgroundInbox: (
    cursor: number,
    limit: number,
    unreadOnly: boolean,
  ) => Promise<BackgroundInboxPage>;
  acknowledgeBackgroundInbox: (id: string) => Promise<void>;
  notifyBackgroundInbox?: (
    id: string,
  ) => Promise<"accepted" | "blocked" | "obsolete" | "unavailable">;
  show: (item: BackgroundInboxItem, acknowledge: () => void) => () => void;
  isVisible?: () => boolean;
  /** Presentation only: never stop result receipt or imply an acknowledgment. */
  shouldDeferNotices?: () => boolean;
  shouldDeferChatDelivery?: () => boolean;
  /** Project retained data to existing original chat receipts, never ACK it. */
  projectBackgroundChatResults?: (cursor: number) => Promise<{
    changed: number;
    nextCursor: number | null;
  }>;
};

/** Native owns receipt/retry/deduplication. A view shows at most four notices;
 * closing a view or losing notification delivery never acknowledges data. */
export function startBackgroundInboxReceiver(ports: InboxPorts) {
  let stopped = false,
    reconciling = false;
  const shown = new Map<string, () => void>();
  const acknowledging = new Set<string>();
  let notificationCursor = 0;
  let chatCursor = 0;
  const deferred = () => ports.shouldDeferNotices?.() === true;
  const deliverChats = async () => {
    if (
      !ports.projectBackgroundChatResults ||
      stopped ||
      (ports.shouldDeferChatDelivery?.() ?? deferred())
    )
      return;
    try {
      // Bounded pages rotate through all retained submissions, including read
      // notices and results older than the latest four in-app notifications.
      const page = await ports.projectBackgroundChatResults(chatCursor);
      if (stopped) return;
      if (
        !Number.isSafeInteger(page.changed) ||
        page.changed < 0 ||
        page.changed > 20 ||
        (page.nextCursor !== null &&
          (!Number.isSafeInteger(page.nextCursor) ||
            page.nextCursor <= 0 ||
            (chatCursor !== 0 && page.nextCursor >= chatCursor)))
      )
        throw new Error("Invalid original chat delivery cursor");
      chatCursor = page.nextCursor ?? 0;
    } catch {
      console.warn("Original chat result delivery unavailable; immutable inbox retained for retry");
    }
  };
  const notify = async () => {
    if (!ports.notifyBackgroundInbox || stopped || deferred()) return;
    // OS delivery has its own queue; four persistent in-app cards cannot starve
    // later results. Native and platform journals own deduplication across reopen.
    const page = await ports.listBackgroundInbox(notificationCursor, 20, true);
    for (const entry of page.items) {
      if (stopped || deferred()) {
        if (deferred()) suspendNotices();
        return;
      }
      try {
        const result = await ports.notifyBackgroundInbox(entry.id);
        if (result === "blocked" || result === "unavailable") {
          notificationCursor = 0;
          return; // No permission dialog or fake delivery/read acknowledgment.
        }
      } catch {
        console.warn("System result notice unavailable; immutable inbox retained for retry");
      }
    }
    if (deferred()) suspendNotices();
    else notificationCursor = page.nextCursor ?? 0;
  };
  const remove = (id: string) => {
    const dismiss = shown.get(id);
    shown.delete(id); // Programmatic dismissal cannot turn into an ACK.
    dismiss?.();
  };
  const suspendNotices = () => {
    notificationCursor = 0;
    for (const id of shown.keys()) remove(id);
  };
  const display = async () => {
    if (deferred()) {
      suspendNotices();
      return;
    }
    const page = await ports.listBackgroundInbox(0, 4, true);
    if (deferred()) {
      suspendNotices();
      return;
    }
    if (stopped || ports.isVisible?.() === false) return;
    for (const id of shown.keys()) if (!page.items.some((item) => item.id === id)) remove(id);
    for (const item of page.items.slice(0, 4)) {
      if (deferred()) {
        suspendNotices();
        return;
      }
      if (stopped) return;
      if (shown.has(item.id) || acknowledging.has(item.id)) continue;
      shown.set(item.id, () => {});
      try {
        const dismiss = ports.show(item, () => {
          if (stopped || !shown.has(item.id) || acknowledging.has(item.id)) return;
          acknowledging.add(item.id);
          // Explicit manual close is notice acknowledgment, not file delivery.
          void ports
            .acknowledgeBackgroundInbox(item.id)
            .catch(() => {
              console.warn("Result notice acknowledgment was not saved; it remains available");
            })
            .finally(() => {
              acknowledging.delete(item.id);
              shown.delete(item.id);
            });
        });
        if (stopped || deferred() || !shown.has(item.id)) {
          shown.delete(item.id);
          dismiss();
        } else {
          shown.set(item.id, dismiss);
        }
      } catch {
        shown.delete(item.id);
        console.warn("Result notice could not be displayed; retained inbox will retry");
      }
    }
  };
  const reconcile = async () => {
    if (stopped || reconciling || (ports.isVisible?.() === false && !ports.notifyBackgroundInbox))
      return;
    reconciling = true;
    try {
      // Cached notices appear before any slow/unavailable PC can delay sync.
      await deliverChats();
      await display();
      await notify();
      if (stopped) return;
      try {
        await ports.syncBackgroundInbox();
      } catch {
        console.warn("Background result synchronization unavailable; existing inbox retained");
      }
      if (!stopped) {
        await deliverChats();
        await display();
        await notify();
      }
    } catch {
      console.warn("Background inbox unavailable; reception will retry");
    } finally {
      reconciling = false;
    }
  };
  const timer = setInterval(() => void reconcile(), 30_000);
  void reconcile();
  return {
    refresh: () => void reconcile(),
    attentionChanged() {
      if (deferred()) {
        suspendNotices();
      }
      void reconcile();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const id of shown.keys()) remove(id);
    },
  };
}
