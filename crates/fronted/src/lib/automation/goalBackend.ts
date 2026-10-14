import { getLanPcCommandHostConfig, invoke, invokeNative, isTauriRuntime } from "@xgent/runtime";
import { captureLanPcCommandRouter } from "../../runtime/lanPcCommandHost";
import type { XgentRuntime } from "../../runtime/types";
import { captureToolCommandPort } from "../tools/toolCommandPort";
import type {
  GoalActivityCursor,
  GoalActivityPage,
  GoalApplyInput,
  GoalArtifact,
  GoalArtifactsPage,
  GoalExecutors,
  GoalLaunchInput,
  GoalLaunchReceipt,
  GoalSnapshot,
} from "./goals";
import type { BackgroundArtifactContent } from "./types";

/** A Goal store belongs to an installation, independently of the address used
 * to select it. Resolve once; each RPC then probes that peer's paired routes. */
export async function captureGoalBackend() {
  if (isTauriRuntime()) {
    const config = getLanPcCommandHostConfig();
    if (
      captureLanPcCommandRouter(config).shouldDelegateCommandToLanPc("automation_goal_snapshot")
    ) {
      const peerId = await invokeNative<string>("worker_peer_resolve_endpoint", {
        base_url: config.baseUrl,
      });
      if (
        typeof peerId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(peerId)
      )
        throw new Error("goals.ownerChanged");
      return createGoalBackend(
        {
          invoke: (command, args) =>
            invokeNative("worker_peer_invoke", { peer_id: peerId, command, args: args ?? {} }),
        },
        true,
      );
    }
    return createGoalBackend((await captureToolCommandPort(config)) ?? { invoke });
  }
  return createGoalBackend((await captureToolCommandPort()) ?? { invoke });
}

export function createGoalBackend(
  port: Pick<XgentRuntime, "invoke"> = { invoke },
  requireStoreBinding = false,
) {
  let owner: Pick<GoalSnapshot, "storeId" | "controlVersion"> | undefined;
  return {
    executors: () => port.invoke<GoalExecutors>("automation_goal_executors"),
    launch: (input: GoalLaunchInput) =>
      port.invoke<GoalLaunchReceipt>("automation_goal_launch", { input }),
    snapshot: async () => {
      const result = await port.invoke<GoalSnapshot>("automation_goal_snapshot");
      if (requireStoreBinding) {
        if (!result?.storeId || (owner && result.storeId !== owner.storeId))
          throw new Error("goals.ownerChanged");
        owner = { storeId: result.storeId, controlVersion: result.controlVersion };
      }
      return result;
    },
    apply: (input: GoalApplyInput) => {
      if (requireStoreBinding && owner?.controlVersion !== 1)
        throw new Error("goals.refreshRequired");
      return port.invoke<GoalSnapshot>("automation_goal_apply", {
        input: requireStoreBinding ? { ...structuredClone(input), storeId: owner?.storeId } : input,
      });
    },
    activity: (goalId: string, cursor: GoalActivityCursor | null = null) =>
      port.invoke<GoalActivityPage>("automation_goal_activity", {
        goal_id: goalId,
        cursor,
        limit: 20,
      }),
    artifacts: (goalId: string, cursor: GoalActivityCursor | null = null) =>
      port.invoke<GoalArtifactsPage>("automation_goal_artifacts", {
        goal_id: goalId,
        cursor,
        limit: 20,
      }),
    artifactContent: (goalId: string, artifact: GoalArtifact) =>
      port.invoke<BackgroundArtifactContent>("automation_goal_artifact_content", {
        goal_id: goalId,
        request_id: artifact.requestId,
        artifact_id: artifact.id,
      }),
  };
}
