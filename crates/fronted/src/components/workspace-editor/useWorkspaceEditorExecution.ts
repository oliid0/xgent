import { invoke } from "@xgent/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { runnableWorkspaceFile } from "./workspaceEditorRun";

type RunResponse = {
  exit_code?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
  timed_out?: boolean;
  timedOut?: boolean;
  cancelled?: boolean;
};
export type WorkspaceEditorRunTarget = {
  key: string;
  session: number;
  workdir: string;
  path: string;
};
export type WorkspaceEditorRunResult = {
  runId: string;
  target: WorkspaceEditorRunTarget;
  fileName: string;
  command: string;
  phase: "running" | "complete" | "failed";
  output: string;
  exitCode?: number;
  error?: string;
  timedOut?: boolean;
  cancelled?: boolean;
};
type RunSession = { id: string; lifetime: object; target: WorkspaceEditorRunTarget };
let runSequence = 0;

/** The editor owns execution, so switching or hiding a file cannot retire its process output. */
export function useWorkspaceEditorExecution({
  beforeRun,
  canRun,
  failure,
  stopFailure,
}: {
  beforeRun: (target: WorkspaceEditorRunTarget) => Promise<boolean>;
  canRun: (target: WorkspaceEditorRunTarget, saved?: boolean) => boolean;
  failure: string;
  stopFailure: string;
}) {
  const callbacks = useRef({ beforeRun, canRun, failure, stopFailure });
  callbacks.current = { beforeRun, canRun, failure, stopFailure };
  const lifetime = useRef<object | null>(null),
    active = useRef<RunSession | null>(null),
    stopping = useRef<object | null>(null);
  const [session, setSession] = useState<RunSession | null>(null);
  const [isStopping, setStopping] = useState(false);
  const [result, renderResult] = useState<WorkspaceEditorRunResult | null>(null);
  const resultRef = useRef<WorkspaceEditorRunResult | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const setResult = useCallback((next: WorkspaceEditorRunResult | null) => {
    resultRef.current = next;
    renderResult(next);
  }, []);
  useEffect(() => {
    const epoch = {};
    lifetime.current = epoch;
    active.current = null;
    stopping.current = null;
    setSession(null);
    setStopping(false);
    setResult(null);
    setStopError(null);
    return () => {
      if (lifetime.current === epoch) lifetime.current = null;
    };
  }, [setResult]);
  const current = useCallback(
    (run: RunSession | null) =>
      !!run && lifetime.current === run.lifetime && active.current === run,
    [],
  );
  const run = useCallback(
    async (origin: WorkspaceEditorRunTarget, prepare?: () => boolean) => {
      const runnable = runnableWorkspaceFile(origin.path),
        epoch = lifetime.current;
      if (!epoch || active.current || !callbacks.current.canRun(origin) || !runnable) return false;
      const token: RunSession = {
        id: `workspace-editor-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++runSequence}`}`,
        lifetime: epoch,
        target: { ...origin },
      };
      active.current = token;
      stopping.current = null;
      setSession(token);
      setStopping(false);
      setStopError(null);
      setResult(null);
      try {
        if (prepare && !prepare()) return false;
        if (
          !(await callbacks.current.beforeRun(token.target)) ||
          !current(token) ||
          !callbacks.current.canRun(token.target, true)
        )
          return false;
        const base = { ...runnable, runId: token.id, target: token.target };
        setResult({ ...base, phase: "running", output: "" });
        const response = await invoke<RunResponse>("shell_run", {
          workdir: token.target.workdir,
          command: runnable.command,
          cwd: runnable.cwd,
          timeout_ms: 120_000,
          max_timeout_ms: 1_800_000,
          provider_id: null,
          run_id: token.id,
          sandbox: false,
          sandbox_allow_network: true,
        });
        if (!current(token)) return false;
        setResult({
          ...base,
          phase: "complete",
          output: [response.stdout, response.stderr ? `[stderr]\n${response.stderr}` : ""]
            .filter(Boolean)
            .join("\n"),
          exitCode: response.exitCode ?? response.exit_code,
          timedOut: response.timedOut ?? response.timed_out,
          cancelled: response.cancelled,
        });
        return true;
      } catch (error) {
        if (current(token))
          setResult({
            ...runnable,
            runId: token.id,
            target: token.target,
            phase: "failed",
            output: "",
            error: String(error || callbacks.current.failure),
          });
        return false;
      } finally {
        if (current(token)) {
          active.current = null;
          stopping.current = null;
          setSession(null);
          setStopping(false);
        }
      }
    },
    [current, setResult],
  );
  const stop = useCallback(async () => {
    if (!current(session) || !session || stopping.current) return false;
    const token = {};
    stopping.current = token;
    setStopping(true);
    setStopError(null);
    try {
      await invoke("shell_cancel", { run_id: session.id });
      return current(session);
    } catch (error) {
      if (current(session)) setStopError(String(error || callbacks.current.stopFailure));
      return false;
    } finally {
      if (current(session) && stopping.current === token) {
        stopping.current = null;
        setStopping(false);
      }
    }
  }, [current, session]);
  const dismiss = useCallback(() => {
    if (!lifetime.current || active.current || resultRef.current !== result) return false;
    setResult(null);
    setStopError(null);
    return true;
  }, [result, setResult]);
  return {
    busy: session !== null,
    isStopping,
    result,
    stopError,
    run,
    stop,
    dismiss,
    runId: session?.id ?? result?.runId,
  };
}
export type WorkspaceEditorExecution = ReturnType<typeof useWorkspaceEditorExecution>;
