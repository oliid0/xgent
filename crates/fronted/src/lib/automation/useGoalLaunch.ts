import { useCallback, useEffect, useRef, useState } from "react";
import { createUuid } from "../shared/id";
import type { GoalExecutor, GoalLaunchInput, GoalRecord } from "./goals";
import type { useGoals } from "./useGoals";

export function goalPlanningModels(target: GoalExecutor | undefined) {
  return (
    target?.host.providers.flatMap((provider) =>
      provider.models
        .filter((model) => {
          const profile = provider.modelProfiles?.find((profile) => profile.model === model);
          return (
            !profile?.skills.length ||
            !profile.skills.every((skill) => ["image", "video", "audio"].includes(skill))
          );
        })
        .map((model) => ({
          value: JSON.stringify([provider.id, model]),
          label: `${provider.name} · ${model}`,
          providerId: provider.id,
          model,
        })),
    ) ?? []
  );
}

export function useGoalLaunch(data: ReturnType<typeof useGoals>) {
  const [draft, setDraft] = useState<{
    goalId: string;
    storeId: string;
    revision: number;
    peer: string;
    model: string;
    scheduling: boolean;
  } | null>(null);
  const [targets, setTargets] = useState<GoalExecutor[]>([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(false);
  const current = useRef(true),
    version = useRef(0),
    lock = useRef(false),
    pending = useRef<GoalLaunchInput | null>(null);
  const owner = data.snapshot?.storeId ?? "";
  useEffect(() => {
    current.current = true;
    version.current++;
    pending.current = null;
    lock.current = false;
    setDraft(null);
    setTargets([]);
    setLoading(false);
    setBusy(false);
    setError("");
    setRetry(false);
    return () => {
      current.current = false;
      version.current++;
    };
  }, [owner]);
  const open = useCallback(
    async (goal: GoalRecord, revision: number, storeId: string) => {
      if (lock.current) return;
      const scope = ++version.current;
      pending.current = null;
      setRetry(false);
      setError("");
      setTargets([]);
      setDraft({ goalId: goal.id, storeId, revision, peer: "", model: "", scheduling: false });
      setLoading(true);
      try {
        const result = await data.readExecutors();
        if (!current.current || scope !== version.current) return;
        if (result.storeId !== storeId) throw new Error("goals.ownerChanged");
        setTargets(
          result.targets.filter(
            (target) =>
              target.host.executorReady &&
              target.host.acceptsBackgroundTasks &&
              target.host.workspaceAvailable,
          ),
        );
      } catch (failure) {
        if (current.current && scope === version.current)
          setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (current.current && scope === version.current) setLoading(false);
      }
    },
    [data.readExecutors],
  );
  const target = targets.find((target) => (target.peerId ?? "local") === draft?.peer);
  const models = goalPlanningModels(target);
  const model = models.find((model) => model.value === draft?.model);
  const canRun = !!draft && !!target && !!model && !loading && !busy && !retry;
  const start = async () => {
    if (lock.current || !draft || (!pending.current && !canRun)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const scope = version.current;
    const input = pending.current ?? {
      requestId: createUuid(),
      goal: { goalId: draft.goalId, storeId: draft.storeId, revision: draft.revision },
      peerId: target!.peerId,
      providerId: model!.providerId,
      model: model!.model,
      workdir: target!.host.workdir,
      intelligentSchedulingEnabled: draft.scheduling,
    };
    pending.current = input;
    try {
      const result = await data.launch(input);
      if (!current.current || scope !== version.current) return;
      if (
        result.requestId !== input.requestId ||
        result.sourceHostId !== (target?.host.hostId ?? input.peerId)
      )
        throw new Error("goals.ownerChanged");
      pending.current = null;
      setRetry(false);
      setDraft(null);
    } catch (failure) {
      if (current.current && scope === version.current) {
        const message = failure instanceof Error ? failure.message : String(failure);
        if (
          [
            "goals.conflict",
            "goals.notActive",
            "goals.runActive",
            "goals.invalidConfig",
            "goals.executorUnavailable",
            "goals.planningModelRequired",
            "goals.workLimit",
          ].includes(message)
        )
          pending.current = null;
        setError(message);
        setRetry(pending.current !== null);
      }
    } finally {
      if (scope === version.current) {
        lock.current = false;
        if (current.current) setBusy(false);
      }
    }
  };
  return {
    draft,
    targets,
    loading,
    busy,
    error,
    retry,
    models,
    target,
    canRun,
    open,
    start,
    close: () => {
      version.current++;
      lock.current = false;
      setBusy(false);
      setLoading(false);
      setDraft(null);
      setError("");
    },
    setPeer: (peer: string) => {
      if (!lock.current && !pending.current)
        setDraft((old) => (old ? { ...old, peer, model: "", scheduling: false } : null));
    },
    setModel: (model: string) => {
      if (!lock.current && !pending.current) setDraft((old) => (old ? { ...old, model } : null));
    },
    setScheduling: (scheduling: boolean) => {
      if (!lock.current && !pending.current)
        setDraft((old) => (old ? { ...old, scheduling } : null));
    },
  };
}
