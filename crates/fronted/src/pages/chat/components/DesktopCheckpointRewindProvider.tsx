import { invoke } from "@xgent/runtime";
import { type ReactNode, useCallback } from "react";
import {
  type CheckpointDiffStats,
  type CheckpointRewindClient,
  CheckpointRewindProvider,
  type CheckpointRewindResult,
  type CheckpointRewoundInfo,
  type CheckpointTurnSummary,
} from "../../../lib/chat/checkpointRewind";
import type { WorkspaceProject } from "../../../lib/settings";
import { listWorkspaceRootGrants } from "../../../lib/workspaceRootGrants";

const desktopCheckpointRewindClient: CheckpointRewindClient = {
  list: (conversationId) =>
    invoke<CheckpointTurnSummary[]>("checkpoint_list", { conversation_id: conversationId }),
  preview: ({ conversationId, turnSeq, authorizedRoots }) =>
    invoke<CheckpointDiffStats>("checkpoint_diff_stats", {
      conversation_id: conversationId,
      turn_seq: turnSeq,
      authorized_roots: authorizedRoots,
    }),
  rewind: ({ conversationId, turnSeq, authorizedRoots, expected }) =>
    invoke<CheckpointRewindResult>("checkpoint_rewind_code", {
      conversation_id: conversationId,
      turn_seq: turnSeq,
      authorized_roots: authorizedRoots,
      expected,
    }),
};

export function DesktopCheckpointRewindProvider(props: {
  children: ReactNode;
  conversationId: string;

  workspaceRoot?: string;

  project?: Pick<WorkspaceProject, "id" | "path"> | null;
  disabled?: boolean;

  onRewound?: (info: CheckpointRewoundInfo) => void;
}) {
  const { children, conversationId, workspaceRoot, project, disabled, onRewound } = props;

  //

  const resolveAuthorizedRoots = useCallback(async () => {
    const roots: string[] = [];
    const push = (raw?: string | null) => {
      const value = raw?.trim();
      if (value && !roots.includes(value)) roots.push(value);
    };
    push(workspaceRoot);
    if (project) {
      try {
        const grants = await listWorkspaceRootGrants(project);
        for (const grant of grants) {
          if (grant.state === "active" && grant.access === "write") push(grant.canonicalPath);
        }
      } catch {}
    }
    return roots;
  }, [project, workspaceRoot]);

  return (
    <CheckpointRewindProvider
      client={desktopCheckpointRewindClient}
      conversationId={conversationId}
      disabled={disabled}
      resolveAuthorizedRoots={resolveAuthorizedRoots}
      onRewound={onRewound}
    >
      {children}
    </CheckpointRewindProvider>
  );
}
