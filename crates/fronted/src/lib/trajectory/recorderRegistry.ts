import {
  createPreparedSystemPromptSlotHolder,
  type PreparedSystemPromptSlots,
} from "../../pages/chat/runtime/conversationContextBuilders";
import { appendDesktopLiveTrajectory, clearDesktopLiveTrajectory } from "./liveTrajectory";
import { createTrajectoryRecorder, type TrajectoryRecorder } from "./recorder";
import {
  createTauriTrajectoryPorts,
  resolvePersistedTrajectoryTurnNumber,
  type TrajectoryPublish,
} from "./tauriPorts";

type Entry = {
  recorder: TrajectoryRecorder;
  slots: ReturnType<typeof createPreparedSystemPromptSlotHolder>;

  segmentIndex: number;

  publish: TrajectoryPublish | undefined;
};

const entries = new Map<string, Entry>();

export function acquireTrajectoryRecorder(
  conversationId: string,
  segmentIndex: number,
  publish?: TrajectoryPublish,
): { recorder: TrajectoryRecorder; readSlots: () => PreparedSystemPromptSlots } {
  const existing = entries.get(conversationId);
  if (existing !== undefined) {
    existing.segmentIndex = segmentIndex;
    existing.publish = publish;
    return { recorder: existing.recorder, readSlots: existing.slots.read };
  }
  const slots = createPreparedSystemPromptSlotHolder();
  const entry: Entry = {
    slots,
    segmentIndex,
    publish,
    recorder: createTrajectoryRecorder({
      conversationId,
      getSegmentIndex: () => entries.get(conversationId)?.segmentIndex ?? segmentIndex,
      ports: createTauriTrajectoryPorts((events) => {
        appendDesktopLiveTrajectory(conversationId, events);
        entries.get(conversationId)?.publish?.(events);
      }),
    }),
  };
  entries.set(conversationId, entry);
  return { recorder: entry.recorder, readSlots: slots.read };
}

export function trajectorySlotCapture(
  conversationId: string,
): ((slots: PreparedSystemPromptSlots) => void) | undefined {
  return entries.get(conversationId)?.slots.capture;
}

/** Move subsequent events to the segment produced by a completed compaction. */
export function updateTrajectoryRecorderSegment(
  conversationId: string,
  segmentIndex: number,
): void {
  const entry = entries.get(conversationId);
  if (entry === undefined || !Number.isFinite(segmentIndex)) return;
  entry.segmentIndex = Math.max(0, Math.trunc(segmentIndex));
}

export async function releaseTrajectoryRecorder(conversationId: string): Promise<void> {
  const key = conversationId.trim();
  const entry = entries.get(key);
  if (entry === undefined) return;
  entries.delete(key);
  await entry.recorder.dispose();

  clearDesktopLiveTrajectory(key);
}

export function discardTrajectoryRecorder(conversationId: string): void {
  const key = conversationId.trim();
  const entry = entries.get(key);
  if (entry !== undefined) {
    entries.delete(key);
    entry.recorder.discard();
  }
  clearDesktopLiveTrajectory(key);
}

/**
 * Resolve the absolute turn number from all persisted segments.
 *
 * A history window may contain only the tail, so counting visible transcript rows can reuse
 * an old turn number and merge unrelated events. The backend also advances past the highest
 * persisted trajectory turn, so a high fallback turn remains monotonic after IPC recovers.
 */
export async function resolveTrajectoryTurnNumber(params: {
  conversationId: string;
  currentUserPersisted: boolean;
  fallbackTurn: number;
}): Promise<number> {
  try {
    return await resolvePersistedTrajectoryTurnNumber(
      params.conversationId,
      params.currentUserPersisted,
    );
  } catch (error) {
    console.warn("[trajectory] failed to resolve persisted turn; using safe fallback", error);
    return Math.max(1, Math.trunc(params.fallbackTurn) || 1);
  }
}
