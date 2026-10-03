import { useEffect, useState } from "react";
import { type CronRunRecord, clearCronRuns, listCronRuns } from "../../lib/automation";

export function useCronRunHistory(taskId: string, enabled = true) {
  const [history, setHistory] = useState({
    taskId,
    logs: [] as CronRunRecord[],
    error: "",
    clearError: "",
    loading: false,
    clearing: false,
  });
  const [scope] = useState(() => ({
    active: true,
    taskId,
    revision: 0,
    fetching: false,
    clearing: false,
  }));
  if (scope.taskId !== taskId) {
    scope.taskId = taskId;
    scope.revision++;
    scope.fetching = false;
    scope.clearing = false;
  }
  const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
  const logs = history.taskId === taskId ? history.logs : [];
  const successCount = logs.filter((log) => log.state === "done" && log.success).length;
  const failCount = logs.filter(
    (log) => (log.state === "done" || log.state === "expired") && !log.success,
  ).length;
  const runningCount = logs.filter(
    (log) => log.state === "pending" || log.state === "leased",
  ).length;
  const currentState = () => enabled && scope.active && scope.taskId === taskId;

  async function refresh() {
    if (!currentState() || scope.fetching || scope.clearing) return;
    const revision = scope.revision;
    scope.fetching = true;
    setHistory((previous) => ({ ...previous, taskId, loading: true, error: "" }));
    const current = () => currentState() && scope.revision === revision;
    try {
      const next = await listCronRuns(taskId, 100);
      if (current()) setHistory((previous) => ({ ...previous, taskId, logs: next, error: "" }));
    } catch (cause) {
      if (current()) {
        setHistory((previous) => ({ ...previous, taskId, error: errorText(cause) }));
        throw cause;
      }
    } finally {
      if (current()) {
        scope.fetching = false;
        setHistory((previous) => ({ ...previous, loading: false }));
      }
    }
  }

  async function clear() {
    if (!currentState() || scope.clearing || successCount + failCount === 0) return;
    // A read begun before clearing must not republish deleted records.
    const revision = ++scope.revision;
    scope.clearing = true;
    scope.fetching = false;
    const current = () => currentState() && revision === scope.revision;
    setHistory((previous) => ({
      ...previous,
      taskId,
      clearing: true,
      loading: false,
      clearError: "",
    }));
    try {
      await clearCronRuns(taskId);
      if (current())
        setHistory((previous) => ({
          ...previous,
          logs: previous.logs.filter((log) => log.state === "pending" || log.state === "leased"),
        }));
    } catch (cause) {
      if (current()) {
        setHistory((previous) => ({ ...previous, clearError: errorText(cause) }));
        throw cause;
      }
    } finally {
      if (current()) {
        scope.clearing = false;
        setHistory((previous) => ({ ...previous, clearing: false }));
      }
    }
  }

  const [latest] = useState(() => ({ refresh }));
  latest.refresh = refresh;
  useEffect(() => {
    if (!enabled) {
      scope.active = false;
      return;
    }
    scope.active = true;
    scope.fetching = false;
    scope.clearing = false;
    setHistory({ taskId, logs: [], error: "", clearError: "", loading: false, clearing: false });
    void latest.refresh().catch(() => undefined);
    const timer = window.setInterval(() => {
      void latest.refresh().catch(() => undefined);
    }, 5000);
    return () => {
      scope.active = false;
      scope.revision++;
      scope.fetching = false;
      scope.clearing = false;
      window.clearInterval(timer);
    };
  }, [taskId, enabled]);

  return {
    logs,
    successCount,
    failCount,
    runningCount,
    clearableCount: successCount + failCount,
    loading: history.taskId === taskId && history.loading,
    isClearing: history.taskId === taskId && history.clearing,
    loadError: history.taskId === taskId ? history.error : "",
    clearError: history.taskId === taskId ? history.clearError : "",
    refresh,
    clear,
  };
}
