import { getLanPcCommandHostConfig } from "@xgent/runtime";
import { runDurableChatTurn } from "../../../lib/automation/backgroundChatIntake";
import {
  type RunAgentConversationTurnParams,
  runAgentConversationTurn,
} from "../turns/runAgentConversationTurn";
import {
  type RunTextConversationTurnParams,
  runTextConversationTurn,
} from "../turns/runTextConversationTurn";

export type ChatRuntimeHostTurn =
  | {
      mode: "agent";
      params: RunAgentConversationTurnParams;
    }
  | {
      mode: "text";
      params: RunTextConversationTurnParams;
    };

export type ChatRuntimeHost = {
  runTurn: (turn: ChatRuntimeHostTurn) => Promise<void>;
};

export function createChatRuntimeHost(): ChatRuntimeHost {
  return {
    async runTurn(turn) {
      if (turn.mode === "agent") {
        // Capture before history persistence and model assessment can yield.
        const params: RunAgentConversationTurnParams = {
          ...turn.params,
          commandHostSnapshot: {
            ...(turn.params.commandHostSnapshot ?? getLanPcCommandHostConfig()),
          },
        };
        let foregroundParams = params;
        if (
          await runDurableChatTurn(params, (prepared) => {
            foregroundParams = prepared;
          })
        )
          return;
        await runAgentConversationTurn(foregroundParams);
        return;
      }
      await runTextConversationTurn(turn.params);
    },
  };
}
