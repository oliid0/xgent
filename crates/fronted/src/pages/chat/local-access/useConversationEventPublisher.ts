import { invoke } from "@xgent/runtime";
import { useCallback, useEffect, useRef } from "react";

type BatchableConversationEvent = {
  conversationId: string;
  round: number | null;
} & (
  | {
      type: "token" | "thinking";
      text: string;
    }
  | {
      type: "tool_call_delta";
      id: string;
      name?: string;
      arguments: unknown;
    }
);

type PendingConversationEventBatch = BatchableConversationEvent & {
  requestId: string;
  rafId: number | null;
  timeoutId: number | null;
  microtaskQueued: boolean;
};

const LOCAL_EVENT_BATCH_MAX_DELAY_MS = 32;
const LOCAL_EVENT_BATCH_MAX_TEXT_LENGTH = 640;
const LOCAL_EVENT_TOOL_DELTA_BATCH_MAX_DELAY_MS = 200;
const LOCAL_EVENT_TOOL_DELTA_HIDDEN_BATCH_MAX_DELAY_MS = 750;

function normalizeConversationEventRound(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shouldFlushConversationEventWithoutAnimationFrame() {
  if (typeof document === "undefined") {
    return false;
  }
  return document.visibilityState !== "visible";
}

function toBatchableConversationEvent(
  event: Record<string, unknown>,
): BatchableConversationEvent | null {
  const type = event.type;
  if (type === "token" || type === "thinking") {
    if (typeof event.text !== "string" || event.text.length === 0) {
      return null;
    }

    for (const key of Object.keys(event)) {
      if (key !== "type" && key !== "text" && key !== "conversation_id" && key !== "round") {
        return null;
      }
    }

    return {
      type,
      text: event.text,
      conversationId: typeof event.conversation_id === "string" ? event.conversation_id : "",
      round: normalizeConversationEventRound(event.round),
    };
  }

  if (type === "tool_call_delta" && typeof event.id === "string" && event.id.trim()) {
    return {
      type,
      id: event.id,
      name: typeof event.name === "string" ? event.name : undefined,
      arguments: event.arguments,
      conversationId: typeof event.conversation_id === "string" ? event.conversation_id : "",
      round: normalizeConversationEventRound(event.round),
    };
  }

  return null;
}

function batchableConversationEventKey(requestId: string, event: BatchableConversationEvent) {
  if (event.type === "tool_call_delta") {
    return [requestId, event.type, event.conversationId, event.round ?? "", event.id].join("\n");
  }
  return [requestId, event.type, event.conversationId, event.round ?? ""].join("\n");
}

function isSameConversationEventBatch(
  existing: PendingConversationEventBatch,
  next: BatchableConversationEvent,
) {
  return (
    existing.type === next.type &&
    existing.conversationId === next.conversationId &&
    existing.round === next.round &&
    (existing.type !== "tool_call_delta" ||
      (next.type === "tool_call_delta" && existing.id === next.id))
  );
}

function batchableConversationEventSize(event: BatchableConversationEvent) {
  if (event.type !== "tool_call_delta") {
    return event.text.length;
  }
  return 0;
}

export function useConversationEventPublisher(enabled = true) {
  const eventChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingConversationEventBatchesRef = useRef(
    new Map<string, PendingConversationEventBatch>(),
  );
  const sendConversationEventForRequest = useCallback(
    (requestId: string, event: Record<string, unknown>) => {
      if (!enabled) return Promise.resolve();
      const sendPromise = eventChainRef.current
        .catch(() => undefined)
        .then(() =>
          invoke("local_access_broadcast_event", {
            event: "xgent:conversation-event",
            payload: {
              requestId,
              event,
            },
          }),
        )
        .then(() => undefined)
        .catch((error) => {
          console.warn("local conversation event broadcast failed", error);
        });
      eventChainRef.current = sendPromise;
      return sendPromise;
    },
    [enabled],
  );

  const flushConversationEventBatchForRequest = useCallback(
    (batchKey: string) => {
      const pending = pendingConversationEventBatchesRef.current.get(batchKey);
      if (!pending) {
        return;
      }

      pendingConversationEventBatchesRef.current.delete(batchKey);
      if (pending.rafId !== null) {
        cancelAnimationFrame(pending.rafId);
      }
      if (pending.timeoutId !== null) {
        window.clearTimeout(pending.timeoutId);
      }
      pending.microtaskQueued = false;
      if (pending.type !== "tool_call_delta" && !pending.text) {
        return;
      }

      const event =
        pending.type === "tool_call_delta"
          ? {
              type: pending.type,
              id: pending.id,
              ...(pending.name ? { name: pending.name } : {}),
              arguments: pending.arguments,
              conversation_id: pending.conversationId,
              ...(pending.round !== null ? { round: pending.round } : {}),
            }
          : {
              type: pending.type,
              text: pending.text,
              conversation_id: pending.conversationId,
              ...(pending.round !== null ? { round: pending.round } : {}),
            };

      sendConversationEventForRequest(pending.requestId, event);
    },
    [sendConversationEventForRequest],
  );

  const flushConversationEventBatchesForRequest = useCallback(
    (requestId: string) => {
      const batchKeys = Array.from(pendingConversationEventBatchesRef.current.entries())
        .filter(([, pending]) => pending.requestId === requestId)
        .map(([batchKey]) => batchKey);
      for (const batchKey of batchKeys) {
        flushConversationEventBatchForRequest(batchKey);
      }
    },
    [flushConversationEventBatchForRequest],
  );

  const scheduleConversationEventBatchFlush = useCallback(
    (batchKey: string) => {
      const pending = pendingConversationEventBatchesRef.current.get(batchKey);
      if (!pending) {
        return;
      }
      const isToolCallDelta = pending.type === "tool_call_delta";
      const timeoutMs =
        isToolCallDelta && shouldFlushConversationEventWithoutAnimationFrame()
          ? LOCAL_EVENT_TOOL_DELTA_HIDDEN_BATCH_MAX_DELAY_MS
          : isToolCallDelta
            ? LOCAL_EVENT_TOOL_DELTA_BATCH_MAX_DELAY_MS
            : LOCAL_EVENT_BATCH_MAX_DELAY_MS;

      if (shouldFlushConversationEventWithoutAnimationFrame() && !isToolCallDelta) {
        if (pending.microtaskQueued) {
          return;
        }
        pending.microtaskQueued = true;
        queueMicrotask(() => {
          const currentPending = pendingConversationEventBatchesRef.current.get(batchKey);
          if (!currentPending) {
            return;
          }
          currentPending.microtaskQueued = false;
          flushConversationEventBatchForRequest(batchKey);
        });
        return;
      }

      if (pending.timeoutId === null) {
        pending.timeoutId = window.setTimeout(() => {
          const currentPending = pendingConversationEventBatchesRef.current.get(batchKey);
          if (!currentPending) {
            return;
          }
          currentPending.timeoutId = null;
          flushConversationEventBatchForRequest(batchKey);
        }, timeoutMs);
      }

      if (isToolCallDelta || pending.rafId !== null) {
        return;
      }
      pending.rafId = requestAnimationFrame(() => {
        const currentPending = pendingConversationEventBatchesRef.current.get(batchKey);
        if (!currentPending) {
          return;
        }
        currentPending.rafId = null;
        flushConversationEventBatchForRequest(batchKey);
      });
    },
    [flushConversationEventBatchForRequest],
  );

  const queueConversationEventForRequest = useCallback(
    (requestId: string, event: Record<string, unknown>) => {
      if (!enabled) return;
      const batchable = toBatchableConversationEvent(event);
      if (!batchable) {
        flushConversationEventBatchesForRequest(requestId);
        return sendConversationEventForRequest(requestId, event);
      }

      const batchKey = batchableConversationEventKey(requestId, batchable);
      const existing = pendingConversationEventBatchesRef.current.get(batchKey);
      if (existing && isSameConversationEventBatch(existing, batchable)) {
        if (existing.type === "tool_call_delta" && batchable.type === "tool_call_delta") {
          existing.name = batchable.name;
          existing.arguments = batchable.arguments;
        } else if (existing.type !== "tool_call_delta" && batchable.type !== "tool_call_delta") {
          existing.text += batchable.text;
        }
        if (batchableConversationEventSize(existing) >= LOCAL_EVENT_BATCH_MAX_TEXT_LENGTH) {
          flushConversationEventBatchForRequest(batchKey);
          return;
        }
        scheduleConversationEventBatchFlush(batchKey);
        return;
      }

      flushConversationEventBatchesForRequest(requestId);
      pendingConversationEventBatchesRef.current.set(batchKey, {
        requestId,
        ...batchable,
        rafId: null,
        timeoutId: null,
        microtaskQueued: false,
      });
      if (batchableConversationEventSize(batchable) >= LOCAL_EVENT_BATCH_MAX_TEXT_LENGTH) {
        flushConversationEventBatchForRequest(batchKey);
        return;
      }
      scheduleConversationEventBatchFlush(batchKey);
    },
    [
      flushConversationEventBatchesForRequest,
      flushConversationEventBatchForRequest,
      enabled,
      scheduleConversationEventBatchFlush,
      sendConversationEventForRequest,
    ],
  );

  const flushPendingConversationEvents = useCallback(() => {
    const batchKeys = Array.from(pendingConversationEventBatchesRef.current.keys());
    for (const batchKey of batchKeys) {
      flushConversationEventBatchForRequest(batchKey);
    }
  }, [flushConversationEventBatchForRequest]);

  useEffect(
    () => () => {
      for (const pending of pendingConversationEventBatchesRef.current.values()) {
        if (pending.rafId !== null) {
          cancelAnimationFrame(pending.rafId);
        }
        if (pending.timeoutId !== null) {
          window.clearTimeout(pending.timeoutId);
        }
        pending.microtaskQueued = false;
      }
      pendingConversationEventBatchesRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        flushPendingConversationEvents();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushPendingConversationEvents);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushPendingConversationEvents);
    };
  }, [enabled, flushPendingConversationEvents]);

  return {
    queueConversationEventForRequest,
    flushPendingConversationEvents,
  };
}
