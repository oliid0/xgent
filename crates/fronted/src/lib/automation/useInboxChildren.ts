import { useEffect, useRef, useState } from "react";
import { readInboxChild } from "./backgroundInboxChildren";
import type { BackgroundChildSummary, BackgroundTaskRecord } from "./types";

export function useInboxChildren(entryId: string | null, parent: BackgroundTaskRecord | null) {
  const owner = JSON.stringify([entryId, parent?.requestId, parent?.hostId]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const stateOwner = useRef(owner);
  const live = useRef(true),
    version = useRef(0);
  const [selected, setSelected] = useState<BackgroundChildSummary | null>(null);
  const selectedRef = useRef<BackgroundChildSummary | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof readInboxChild>> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    live.current = true;
    version.current++;
    stateOwner.current = owner;
    selectedRef.current = null;
    setSelected(null);
    setDetail(null);
    setBusy(false);
    setError("");
    return () => {
      live.current = false;
      version.current++;
    };
  }, [owner]);
  const close = (child?: BackgroundChildSummary) => {
    if (owner !== currentOwner.current) return;
    if (
      child &&
      (selectedRef.current?.callId !== child.callId ||
        selectedRef.current.requestId !== child.requestId ||
        selectedRef.current.peerId !== child.peerId)
    )
      return;
    version.current++;
    selectedRef.current = null;
    setSelected(null);
    setDetail(null);
    setBusy(false);
    setError("");
  };
  const open = async (child: BackgroundChildSummary) => {
    if (
      !live.current ||
      owner !== currentOwner.current ||
      !entryId ||
      !parent ||
      !parent.children?.some(
        (item) =>
          item.callId === child.callId &&
          item.requestId === child.requestId &&
          item.peerId === child.peerId,
      )
    )
      return;
    const scope = ++version.current;
    const current = () =>
      live.current && scope === version.current && owner === currentOwner.current;
    const previous = selectedRef.current;
    selectedRef.current = child;
    setSelected(child);
    setBusy(true);
    setError("");
    if (
      previous?.callId !== child.callId ||
      previous.requestId !== child.requestId ||
      previous.peerId !== child.peerId
    )
      setDetail(null);
    try {
      const result = await readInboxChild(entryId, parent, child, current);
      if (current()) setDetail(result);
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const sameOwner = stateOwner.current === owner;
  return {
    selected: sameOwner ? selected : null,
    detail: sameOwner ? detail : null,
    busy: sameOwner && busy,
    error: sameOwner ? error : "",
    open,
    close,
  };
}
