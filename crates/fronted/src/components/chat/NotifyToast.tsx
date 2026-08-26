import { useToast } from "@astryxdesign/core/Toast";
import { memo, useEffect, useRef } from "react";

export type NotifyItem = {
  id: string;
  type: "success" | "warning" | "error";
  message: string;
};

/** Bridges the existing notification state into Astryx's managed toast layer. */
export const NotifyToast = memo(function NotifyToast(props: {
  items: NotifyItem[];
  onDismiss: (id: string) => void;
}) {
  const { items, onDismiss } = props;
  const showToast = useToast();
  const shownIDs = useRef(new Set<string>());
  const dismissers = useRef(new Map<string, () => void>());

  useEffect(() => {
    const currentIDs = new Set(items.map((item) => item.id));

    for (const [id, dismiss] of dismissers.current) {
      if (currentIDs.has(id)) continue;
      dismiss();
      dismissers.current.delete(id);
      shownIDs.current.delete(id);
    }

    for (const item of items) {
      if (shownIDs.current.has(item.id)) continue;
      shownIDs.current.add(item.id);
      const dismiss = showToast({
        body: item.message,
        type: item.type === "error" ? "error" : "info",
        isAutoHide: item.type !== "error",
        autoHideDuration: 5000,
        uniqueID: item.id,
        collisionBehavior: "overwrite",
        onHide: () => {
          dismissers.current.delete(item.id);
          shownIDs.current.delete(item.id);
          onDismiss(item.id);
        },
      });
      dismissers.current.set(item.id, dismiss);
    }
  }, [items, onDismiss, showToast]);

  useEffect(() => () => {
    for (const dismiss of dismissers.current.values()) dismiss();
    dismissers.current.clear();
    shownIDs.current.clear();
  });

  return null;
});
