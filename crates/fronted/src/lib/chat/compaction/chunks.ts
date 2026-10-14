import {
  type CompactionPayload,
  estimateCompactionPayloadTokens,
  type SerializedCompactionMessage,
} from "./payload";

// Same bounded cumulative-summary strategy as ll/1 (7), adapted to our
// serialized, untrusted history payload and existing checkpoint transaction.
export const COMPACTION_MAX_CHUNKS = 16;

type FragmentableMessage = SerializedCompactionMessage & {
  content?: string;
  text?: string;
  details?: string;
  toolCalls?: string[];
  fragment?: { part: number; continued: boolean };
};

function splitMessage(
  message: SerializedCompactionMessage,
  envelope: CompactionPayload,
  budget: number,
) {
  const { content, text, details, toolCalls, fragment, ...identity } =
    message as FragmentableMessage;
  const base = { ...identity, ...(message.role !== "assistant" ? { content: "" } : {}) };
  const fields: Array<{ key: "content" | "text" | "details" | "toolCalls"; value: string }> = [];
  if (typeof content === "string") fields.push({ key: "content", value: content });
  if (typeof text === "string") fields.push({ key: "text", value: text });
  for (const value of toolCalls ?? []) fields.push({ key: "toolCalls", value });
  if (typeof details === "string") fields.push({ key: "details", value: details });
  const parts: SerializedCompactionMessage[] = [];
  for (const { key, value } of fields) {
    let offset = 0;
    do {
      const makePart = (length: number) =>
        ({
          ...base,
          [key]:
            key === "toolCalls"
              ? [value.slice(offset, offset + length)]
              : value.slice(offset, offset + length),
          fragment: { part: parts.length + 1, continued: true },
        }) as SerializedCompactionMessage;
      let low = 0;
      let high = value.length - offset;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (
          estimateCompactionPayloadTokens({
            ...envelope,
            active_segment_messages: [makePart(mid)],
          }) <= budget
        )
          low = mid;
        else high = mid - 1;
      }
      // Avoid breaking a UTF-16 surrogate pair at a fragment boundary.
      if (low > 0 && offset + low < value.length && /[\uD800-\uDBFF]/.test(value[offset + low - 1]))
        low--;
      if (
        (low === 0 && value.length > offset) ||
        estimateCompactionPayloadTokens({ ...envelope, active_segment_messages: [makePart(low)] }) >
          budget
      )
        throw new Error(
          "Compaction message metadata exceeds the summary budget; original history retained",
        );
      parts.push(makePart(low));
      if (parts.length > COMPACTION_MAX_CHUNKS * 4)
        throw new Error(
          "Compaction message requires too many fragments; original history retained",
        );
      offset += low;
    } while (offset < value.length);
  }
  if (!parts.length)
    throw new Error("Compaction message exceeds the summary budget; original history retained");
  (parts[parts.length - 1] as FragmentableMessage).fragment!.continued =
    fragment?.continued ?? false;
  return parts;
}

export function takeCompactionChunk(
  envelope: CompactionPayload,
  pending: readonly SerializedCompactionMessage[],
  budget: number,
) {
  const empty = {
    ...envelope,
    compaction_reason: { ...envelope.compaction_reason, payload_budget_tokens: budget },
    active_segment_messages: [],
  };
  if (estimateCompactionPayloadTokens(empty) > budget)
    throw new Error(
      "Compaction checkpoint and request exceed the summary budget; original history retained",
    );
  let remaining = pending.slice();
  const messages: SerializedCompactionMessage[] = [];
  while (remaining.length) {
    const next = remaining[0];
    if (
      estimateCompactionPayloadTokens({ ...empty, active_segment_messages: [...messages, next] }) >
      budget
    ) {
      if (messages.length) break;
      remaining.splice(0, 1, ...splitMessage(next, empty, budget));
      continue;
    }
    messages.push(next);
    remaining.shift();
  }
  return { payload: { ...empty, active_segment_messages: messages }, remaining };
}
