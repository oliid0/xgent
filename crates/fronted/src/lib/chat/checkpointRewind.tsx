import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type CheckpointTurnSummary = {
  turnSeq: number;
  turnId: string;
  fileCount: number;
  dirCount: number;
  incomplete: boolean;
  firstCapturedAt: number;
};

export type CheckpointDiffEntry = {
  path: string;
  key: string;
  action: string;
  currentHash?: string;
};

export type CheckpointDiffStats = {
  turnSeq: number;
  restoreFiles: number;
  deleteFiles: number;
  cleanFiles: number;
  skippedDirs: number;
  missingBlobs: number;
  unresolvableFiles: number;
  captureErrors: number;
  entries: CheckpointDiffEntry[];
};

export type CheckpointExpectedEntry = { key: string; currentHash: string };

export type CheckpointRewindResult = {
  turnSeq: number;
  restoredFiles: number;
  deletedFiles: number;
  cleanFiles: number;
  skippedDirs: number;
  captureErrors: number;
  conflicts: string[];
  failed: string[];
};

export type CheckpointRewoundInfo = {
  turn: CheckpointTurnSummary;
  preview: CheckpointDiffStats;
  result: CheckpointRewindResult;
};

export type CheckpointRewindClient = {
  list: (conversationId: string) => Promise<CheckpointTurnSummary[]>;
  preview: (input: {
    conversationId: string;
    turnSeq: number;
    authorizedRoots: string[];
  }) => Promise<CheckpointDiffStats>;
  rewind: (input: {
    conversationId: string;
    turnSeq: number;
    authorizedRoots: string[];
    expected: CheckpointExpectedEntry[];
  }) => Promise<CheckpointRewindResult>;
};

type CheckpointRewindContextValue = {
  available: boolean;
  busyTurnId: string | null;
  rewindTurn: (turnId: string) => Promise<CheckpointRewoundInfo>;
};

const CheckpointRewindContext = createContext<CheckpointRewindContextValue | null>(null);

export function CheckpointRewindProvider(props: {
  client: CheckpointRewindClient;
  conversationId: string;
  disabled?: boolean;
  resolveAuthorizedRoots: () => Promise<string[]>;
  onRewound?: (info: CheckpointRewoundInfo) => void;
  children: ReactNode;
}) {
  const [busyTurnId, setBusyTurnId] = useState<string | null>(null);
  const rewindTurn = useCallback(
    async (turnId: string) => {
      if (props.disabled) throw new Error("Checkpoint rewind is currently unavailable.");
      setBusyTurnId(turnId);
      try {
        const turns = await props.client.list(props.conversationId);
        const turn = turns.find((item) => item.turnId === turnId);
        if (!turn) throw new Error("This message has no recoverable code checkpoint.");
        const authorizedRoots = await props.resolveAuthorizedRoots();
        if (authorizedRoots.length === 0) throw new Error("No writable workspace root is authorized.");
        const preview = await props.client.preview({
          conversationId: props.conversationId,
          turnSeq: turn.turnSeq,
          authorizedRoots,
        });
        const expected = preview.entries.flatMap((entry) =>
          typeof entry.currentHash === "string"
            ? [{ key: entry.key, currentHash: entry.currentHash }]
            : [],
        );
        const result = await props.client.rewind({
          conversationId: props.conversationId,
          turnSeq: turn.turnSeq,
          authorizedRoots,
          expected,
        });
        const info = { turn, preview, result };
        props.onRewound?.(info);
        return info;
      } finally {
        setBusyTurnId(null);
      }
    }, [props],
  );
  const value = useMemo(
    () => ({ available: !props.disabled, busyTurnId, rewindTurn }),
    [busyTurnId, props.disabled, rewindTurn],
  );
  return (
    <CheckpointRewindContext.Provider value={value}>
      {props.children}
    </CheckpointRewindContext.Provider>
  );
}

export function useCheckpointRewind() {
  return useContext(CheckpointRewindContext);
}
