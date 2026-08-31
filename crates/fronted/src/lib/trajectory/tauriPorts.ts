import { invoke } from "@xgent/runtime";
import type { TrajectoryEvent, TrajectorySection } from "@/lib/trajectory/types";
import type { TrajectoryRecorderPorts } from "./recorder";

export type TrajectoryPublish = (events: readonly TrajectoryEvent[]) => void;

export function createTauriTrajectoryPorts(publish?: TrajectoryPublish): TrajectoryRecorderPorts {
  return {
    persist: (conversationId, segmentIndex, eventsJson) =>
      invoke("trajectory_append_events", { conversationId, segmentIndex, eventsJson }),
    persistSections: (conversationId, sections: readonly TrajectorySection[]) =>
      invoke("trajectory_put_sections", { conversationId, sections }),
    ...(publish === undefined ? {} : { publish }),
  };
}
/** Resolve the next turn from persisted messages and the highest trajectory turn. */
export async function resolvePersistedTrajectoryTurnNumber(
  conversationId: string,
  currentUserPersisted: boolean,
): Promise<number> {
  const value = await invoke<number>("trajectory_resolve_turn_number", {
    conversationId,
    currentUserPersisted,
  });
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}
