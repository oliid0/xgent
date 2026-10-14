import { isBrowserRuntime } from "@xgent/runtime";
import { useEffect, useRef } from "react";
import { useLocale } from "../../i18n";
import { backend } from "../../lib/automation/backend";
import { startBackgroundInboxReceiver } from "../../lib/automation/backgroundInboxReceiver";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { useAppToast } from "../astryx/useAppToast";

/** Foreground notice delivery on this device, including after mobile reopen. */
export function BackgroundInboxReceiver({ deferNotices = false }: { deferNotices?: boolean }) {
  const toast = useAppToast();
  const { t } = useLocale();
  const deferredRef = useRef(deferNotices);
  const receiverRef = useRef<ReturnType<typeof startBackgroundInboxReceiver> | null>(null);
  deferredRef.current = deferNotices;
  useEffect(() => {
    receiverRef.current?.attentionChanged();
  }, [deferNotices]);
  useEffect(() => {
    if (isBrowserRuntime()) return;
    const receiver = startBackgroundInboxReceiver({
      ...backend,
      notifyBackgroundInbox: isNativeMobileRuntime() ? backend.notifyBackgroundInbox : undefined,
      isVisible: () => document.visibilityState !== "hidden",
      shouldDeferNotices: () => deferredRef.current && document.visibilityState !== "hidden",
      shouldDeferChatDelivery: () => deferredRef.current,
      show: (entry, acknowledge) =>
        toast({
          body: `${entry.name} · ${t(entry.state === "waiting" ? "backgroundInbox.waiting" : entry.success ? "backgroundInbox.completed" : "backgroundInbox.unfinished")}\n${entry.preview}${entry.preview.length === 512 ? "…" : ""}`,
          type:
            entry.state === "expired" || (entry.state === "done" && !entry.success)
              ? "error"
              : "info",
          uniqueID: `background-inbox:${entry.id}`,
          collisionBehavior: "overwrite",
          isAutoHide: false,
          onHide: (reason) => {
            if (reason === "manual") acknowledge();
          },
        }),
    });
    receiverRef.current = receiver;
    window.addEventListener("online", receiver.refresh);
    window.addEventListener("focus", receiver.refresh);
    document.addEventListener("visibilitychange", receiver.refresh);
    return () => {
      window.removeEventListener("online", receiver.refresh);
      window.removeEventListener("focus", receiver.refresh);
      document.removeEventListener("visibilitychange", receiver.refresh);
      receiver.stop();
      if (receiverRef.current === receiver) receiverRef.current = null;
    };
  }, [toast, t]);
  return null;
}
