import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";

const EMPTY_RESPONSE_ERROR =
  "Provider returned error: the response contained no content (empty response)";

function hasUsableAssistantContent(message: AssistantMessage): boolean {
  const hasToolCall = message.content.some(
    (block) => block.type === "toolCall" && Boolean(block.id && block.name),
  );
  const hasText = message.content.some(
    (block) => block.type === "text" && block.text.trim().length > 0,
  );

  const hasThinking = message.content.some(
    (block) => block.type === "thinking" && block.thinking.trim().length > 0,
  );
  return hasToolCall || hasText || hasThinking;
}

function shouldRejectAsEmptyResponse(message: AssistantMessage): boolean {
  if (message.stopReason === "length" || message.stopReason === "aborted") return false;
  if (message.stopReason === "error") return false;
  return !hasUsableAssistantContent(message);
}

function buildEmptyResponseError(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    stopReason: "error",
    errorMessage: EMPTY_RESPONSE_ERROR,
  };
}

export function rejectEmptyOpenAICompletionsResponse(
  source: AssistantMessageEventStream,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();

  void (async () => {
    for await (const event of source) {
      if (event.type === "done" && shouldRejectAsEmptyResponse(event.message)) {
        const error = buildEmptyResponseError(event.message);
        output.push({ type: "error", reason: "error", error });
        return;
      }

      output.push(event);
      if (event.type === "done" || event.type === "error") return;
    }

    const result = await source.result();
    if (shouldRejectAsEmptyResponse(result)) {
      const error = buildEmptyResponseError(result);
      output.push({ type: "error", reason: "error", error });
      return;
    }
    output.end(result);
  })();

  return output;
}

function isMissingFinishReasonError(message: AssistantMessage): boolean {
  return (
    message.stopReason === "error" &&
    /(?:missing|without|before).{0,40}finish[_ -]?reason|finish[_ -]?reason.{0,40}(?:missing|without)/i.test(
      message.errorMessage ?? "",
    )
  );
}

/**
 * A number of OpenAI-compatible relays omit the final finish_reason even after
 * sending a complete answer.  Salvage only messages with usable content and
 * only for that exact protocol error; empty and unrelated failures remain
 * failures so retry/failover can still handle them.
 */
export function recoverOpenAICompletionsMissingFinishReason(
  source: AssistantMessageEventStream,
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();

  void (async () => {
    for await (const event of source) {
      if (
        event.type === "error" &&
        isMissingFinishReasonError(event.error) &&
        hasUsableAssistantContent(event.error)
      ) {
        const stopReason = event.error.content.some((block) => block.type === "toolCall")
          ? "toolUse"
          : "stop";
        const recovered: AssistantMessage = {
          ...event.error,
          stopReason,
          errorMessage: undefined,
        };
        output.push({ type: "done", reason: stopReason, message: recovered });
        return;
      }

      output.push(event);
      if (event.type === "done" || event.type === "error") return;
    }

    output.end(await source.result());
  })();

  return output;
}
