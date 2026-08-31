import type { ConversationViewState, HistoryMessageRef } from "../conversationState";
import type { RetryAttemptRecord } from "../liveTranscriptStore";

type QueueEventOptions = {
  allowAfterClose?: boolean;
};

type QueueUserMessageOptions = {
  // Edit-resend broadcasts the truncation base so every paired client can
  // apply the same conversation rebase.
  baseMessageRef?: HistoryMessageRef;
};

function buildBaseMessageRefPayload(ref: HistoryMessageRef): Record<string, unknown> {
  return {
    segment_index: ref.segmentIndex,
    message_index: ref.messageIndex,
    segment_id: ref.segmentId,
    message_id: ref.messageId,
    role: ref.role,
    content_hash: ref.contentHash,
  };
}

type ConversationEventSendResult = Promise<void> | void;

type ConversationEventControllerParams = {
  conversationId: string;
  requestId: string;
  enabled: boolean;
  sendEvent: (requestId: string, event: Record<string, unknown>) => ConversationEventSendResult;
  resolveErrorConversationId?: () => string;
};

export type ConversationEventController = {
  queueEvent: (
    event: Record<string, unknown>,
    options?: QueueEventOptions,
  ) => ConversationEventSendResult;
  queueUserMessage: (
    message: string,
    uploadedFiles?: readonly unknown[],
    options?: QueueUserMessageOptions,
  ) => ConversationEventSendResult;
  queueToken: (delta: string, extra?: Record<string, unknown>) => void;
  queueTitle: (nextTitle: string, allowAfterClose?: boolean) => void;
  queueToolStatus: (status: string | null, isCompaction?: boolean) => void;
  queueRetryAttempts: (attempts: readonly RetryAttemptRecord[]) => void;
  queueCheckpoint: (state: ConversationViewState) => void;
  emitError: (message: string, conversationIdOverride?: string) => void;
  close: () => void;
  hasForwardedText: () => boolean;
  isClosed: () => boolean;
};

export function createConversationEventController(
  params: ConversationEventControllerParams,
): ConversationEventController {
  let forwardedText = false;
  let streamClosed = false;
  let lastToolStatusKey = "";
  let lastToolStatus: string | null = null;
  let lastToolStatusIsCompaction = false;
  let lastRetryAttemptsKey = "[]";

  const queueEvent = (event: Record<string, unknown>, options?: QueueEventOptions) => {
    if (!params.enabled) return;
    if (streamClosed && !options?.allowAfterClose) return;
    return params.sendEvent(params.requestId, event);
  };

  const queueToolStatus = (status: string | null, isCompaction = false) => {
    const normalizedStatus = status?.trim() ?? "";
    const statusKey = `${normalizedStatus}::${isCompaction ? "1" : "0"}`;
    if (statusKey === lastToolStatusKey) return;
    lastToolStatusKey = statusKey;
    lastToolStatus = normalizedStatus || null;
    lastToolStatusIsCompaction = isCompaction;
    queueEvent({
      type: "tool_status",
      status: normalizedStatus || null,
      isCompaction,
      conversation_id: params.conversationId,
    });
  };

  // Rides on the tool_status wire event (re-sending the current status text)
  // so paired clients can mirror the expandable retry-details block
  // without a new event type. Events without a retryAttempts array leave the
  // WebUI's list untouched; an explicit empty array clears it.
  const queueRetryAttempts = (attempts: readonly RetryAttemptRecord[]) => {
    const payload = attempts.map((entry) => ({
      attempt: entry.attempt,
      maxAttempts: entry.maxAttempts,
      errorMessage: entry.errorMessage,
    }));
    const attemptsKey = JSON.stringify(payload);
    if (attemptsKey === lastRetryAttemptsKey) return;
    lastRetryAttemptsKey = attemptsKey;
    queueEvent({
      type: "tool_status",
      status: lastToolStatus,
      isCompaction: lastToolStatusIsCompaction,
      retryAttempts: payload,
      conversation_id: params.conversationId,
    });
  };

  return {
    queueEvent,
    queueUserMessage(message: string, uploadedFiles = [], options?: QueueUserMessageOptions) {
      if (!message.trim() && uploadedFiles.length === 0) return;
      return queueEvent({
        type: "user_message",
        message,
        uploaded_files: uploadedFiles.map((file) =>
          file && typeof file === "object" ? { ...(file as Record<string, unknown>) } : file,
        ),
        conversation_id: params.conversationId,
        ...(options?.baseMessageRef
          ? {
              base_message_ref: buildBaseMessageRefPayload(options.baseMessageRef),
              reason: "edit_resend",
            }
          : {}),
      });
    },
    queueToken(delta: string, extra?: Record<string, unknown>) {
      if (delta.length === 0 && !extra) return;
      if (delta.length > 0) {
        forwardedText = true;
      }
      queueEvent({
        type: "token",
        text: delta,
        conversation_id: params.conversationId,
        ...extra,
      });
    },
    queueTitle(nextTitle: string, allowAfterClose = false) {
      const title = nextTitle.trim();
      if (!title) return;
      queueEvent(
        {
          type: "token",
          text: "",
          title,
          titleFinal: allowAfterClose === true,
          conversation_id: params.conversationId,
        },
        { allowAfterClose },
      );
    },
    queueToolStatus,
    queueRetryAttempts,
    queueCheckpoint(state: ConversationViewState) {
      const activeSegment = state.segments[state.activeSegmentIndex];
      const summary = activeSegment?.summary;
      if (!summary?.content.trim()) return;

      queueEvent({
        type: "token",
        text: summary.content,
        provider: "xgent",
        model: "summary",
        api: "xgent-compaction",
        conversation_id: params.conversationId,
        checkpoint: {
          summaryId: summary.id,
          segmentIndex: state.activeSegmentIndex,
          coveredMessageCount: summary.summaryMeta.coveredMessageCount,
          coversThroughMessageId: summary.summaryMeta.coversThroughMessageId,
          timestamp: summary.timestamp,
          generatedBy: {
            providerId: summary.summaryMeta.generatedBy.providerId,
            model: summary.summaryMeta.generatedBy.model,
            promptVersion: summary.summaryMeta.generatedBy.promptVersion,
          },
        },
      });
    },
    emitError(message: string, conversationIdOverride?: string) {
      queueEvent({
        type: "error",
        message,
        conversation_id:
          conversationIdOverride ?? params.resolveErrorConversationId?.() ?? params.conversationId,
      });
    },
    close() {
      streamClosed = true;
    },
    hasForwardedText() {
      return forwardedText;
    },
    isClosed() {
      return streamClosed;
    },
  };
}
