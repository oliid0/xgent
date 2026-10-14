import {
  type MemoryHistorySearchMatch,
  memoryReadPersonalHistoryEvidence,
  type PersonalHistoryMessageEvidence,
  type PersonalHistoryMessageRef,
} from "../api";
import { PERSONAL_HISTORY_OBSERVATION_LIMIT } from "../config";
import { collectUserMemoryObservations } from "./context";
import type { UserMemoryObservation } from "./personalEvidence";

function matchesReference(record: PersonalHistoryMessageEvidence, ref: PersonalHistoryMessageRef) {
  return (
    record.role === "user" &&
    record.conversationId === ref.conversationId &&
    record.segmentIndex === ref.segmentIndex &&
    record.segmentId === ref.segmentId &&
    record.messageIndex === ref.messageIndex &&
    record.messageId === ref.messageId &&
    typeof record.contentHash === "string" &&
    Boolean(record.contentHash) &&
    typeof record.text === "string"
  );
}

/** Per-extraction read-only history cache. Search snippets and their updatedAt
 * are never observations. Re-read retained originals before accepting a plan. */
export function createPersonalHistoryEvidence(observations: UserMemoryObservation[]) {
  const records = new Map<string, PersonalHistoryMessageEvidence>();
  let reads = 0;
  return {
    async hydrate(matches: readonly MemoryHistorySearchMatch[], signal?: AbortSignal) {
      const added: UserMemoryObservation[] = [];
      for (const match of matches) {
        signal?.throwIfAborted();
        if (
          match.source !== "message" ||
          match.role !== "user" ||
          !match.conversationId ||
          !match.segmentId ||
          !match.messageId ||
          typeof match.messageIndex !== "number" ||
          !Number.isSafeInteger(match.messageIndex) ||
          (match.messageIndex ?? -1) < 0 ||
          !Number.isSafeInteger(match.segmentIndex) ||
          match.segmentIndex < 0
        )
          continue;
        const ref: PersonalHistoryMessageRef = {
          conversationId: match.conversationId,
          segmentIndex: match.segmentIndex,
          segmentId: match.segmentId,
          messageIndex: match.messageIndex,
          messageId: match.messageId,
        };
        const id = `history:${JSON.stringify(ref)}`;
        if (records.has(id)) {
          const cached = observations.find((observation) => observation.id === id);
          if (cached && !added.some((observation) => observation.id === id)) added.push(cached);
          continue;
        }
        if (reads >= PERSONAL_HISTORY_OBSERVATION_LIMIT) continue;
        reads++;
        try {
          const record = await memoryReadPersonalHistoryEvidence(ref);
          signal?.throwIfAborted();
          if (!matchesReference(record, ref)) continue;
          const [observation] = collectUserMemoryObservations([
            { role: "user", content: record.text, timestamp: record.timestamp ?? 0 },
          ]);
          if (!observation) continue;
          observation.id = id;
          observation.history = {
            ...ref,
            contentHash: record.contentHash,
            truncated: record.truncated,
          };
          records.set(id, record);
          observations.push(observation);
          added.push(observation);
        } catch {
          signal?.throwIfAborted();
        }
      }
      return added;
    },
    async revalidate(signal?: AbortSignal) {
      const rejected = new Set<string>();
      for (const [id, previous] of records) {
        signal?.throwIfAborted();
        try {
          const current = await memoryReadPersonalHistoryEvidence({
            conversationId: previous.conversationId,
            segmentIndex: previous.segmentIndex,
            segmentId: previous.segmentId,
            messageIndex: previous.messageIndex,
            messageId: previous.messageId,
            expectedContentHash: previous.contentHash,
          });
          signal?.throwIfAborted();
          if (
            !matchesReference(current, previous) ||
            current.contentHash !== previous.contentHash ||
            current.timestamp !== previous.timestamp ||
            current.text !== previous.text ||
            current.truncated !== previous.truncated
          )
            rejected.add(id);
        } catch {
          signal?.throwIfAborted();
          rejected.add(id);
        }
      }
      for (let i = observations.length - 1; i >= 0; i--) {
        if (rejected.has(observations[i].id)) observations.splice(i, 1);
      }
      return rejected.size;
    },
  };
}
