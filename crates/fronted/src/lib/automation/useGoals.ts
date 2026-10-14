import { useCallback, useEffect, useRef, useState } from "react";
import { LAN_PC_SESSION_CHANGED_EVENT } from "../../runtime/lanPcCommandHost";
import { createUuid } from "../shared/id";
import { type GoalArtifactTransfer, sameGoalArtifact, transferGoalArtifact } from "./goalArtifacts";
import { captureGoalBackend } from "./goalBackend";
import type {
  GoalActivityCursor,
  GoalActivityPage,
  GoalApplyInput,
  GoalArtifact,
  GoalArtifactsPage,
  GoalLaunchInput,
  GoalOperation,
  GoalSnapshot,
} from "./goals";
import { validateGoalConfig } from "./goals";

export function useGoals() {
  const [snapshot, setSnapshot] = useState<GoalSnapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [activity, setActivity] = useState<GoalActivityPage | null>(null),
    [activityBusy, setActivityBusy] = useState(false),
    [activityError, setActivityError] = useState("");
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [observationError, setObservationError] = useState("");
  const current = useRef<GoalSnapshot | null>(null),
    port = useRef<Awaited<ReturnType<typeof captureGoalBackend>> | null>(null);
  const generation = useRef(0),
    active = useRef(true),
    lock = useRef(false),
    activityVersion = useRef(0);
  const pending = useRef<{ storeId: string; input: GoalApplyInput } | null>(null);
  const [artifacts, setArtifacts] = useState<GoalArtifactsPage | null>(null),
    [artifactsBusy, setArtifactsBusy] = useState(false),
    [artifactsError, setArtifactsError] = useState("");
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null),
    [downloadError, setDownloadError] = useState("");
  const [transfers, setTransfers] = useState<Record<string, GoalArtifactTransfer>>({});
  const artifactVersion = useRef(0),
    artifactPage = useRef<GoalArtifactsPage | null>(null),
    downloadLock = useRef(false);
  const observationVersion = useRef(0),
    observing = useRef(false);

  const perform = useCallback(
    async (operation?: GoalOperation, revision?: number, replay = false) => {
      if (lock.current) return false;
      lock.current = true;
      observationVersion.current++;
      const owner = generation.current;
      setBusy(true);
      setError("");
      try {
        let next: GoalSnapshot;
        if (operation || replay) {
          if (!port.current || !current.current) throw new Error("goals.refreshRequired");
          if (operation) {
            if (pending.current) throw new Error("goals.retryPending");
            if (revision !== current.current.revision) throw new Error("goals.conflict");
            if (operation.op === "create" || operation.op === "update")
              validateGoalConfig(operation.config);
            pending.current = {
              storeId: current.current.storeId,
              input: { revision, requestId: createUuid(), operation: structuredClone(operation) },
            };
          }
          const write = pending.current;
          if (!write || write.storeId !== current.current.storeId)
            throw new Error("goals.ownerChanged");
          next = await port.current.apply(write.input);
          if (next.storeId !== write.storeId) throw new Error("goals.ownerChanged");
          if (!active.current || owner !== generation.current) return false;
          pending.current = null;
          setRetryAvailable(false);
        } else {
          const captured = await captureGoalBackend();
          next = await captured.snapshot();
          if (!active.current || owner !== generation.current) return false;
          if (pending.current && next.storeId !== pending.current.storeId) {
            pending.current = null;
            setRetryAvailable(false);
          }
          port.current = captured;
        }
        if (!active.current || owner !== generation.current) return false;
        current.current = next;
        setSnapshot(next);
        setObservationError("");
        return true;
      } catch (failure) {
        if (active.current && owner === generation.current) {
          const message = failure instanceof Error ? failure.message : String(failure);
          if (
            [
              "goals.conflict",
              "goals.invalidIdentity",
              "goals.invalidConfig",
              "goals.missing",
              "goals.parentCycle",
              "goals.limit",
              "goals.workLimit",
              "goals.hasChildren",
              "goals.missingStep",
              "goals.missingTask",
              "goals.requestChanged",
            ].includes(message)
          )
            pending.current = null;
          setError(message);
          setRetryAvailable(pending.current !== null);
        }
        return false;
      } finally {
        if (owner === generation.current) {
          lock.current = false;
          if (active.current) setBusy(false);
        }
      }
    },
    [],
  );

  const observe = useCallback(async () => {
    const captured = port.current,
      saved = current.current;
    if (
      !active.current ||
      lock.current ||
      pending.current ||
      observing.current ||
      !captured ||
      !saved
    )
      return;
    observing.current = true;
    const owner = generation.current,
      version = observationVersion.current;
    const live = () =>
      active.current &&
      owner === generation.current &&
      version === observationVersion.current &&
      port.current === captured &&
      current.current?.storeId === saved.storeId;
    try {
      const next = await captured.snapshot();
      if (!live()) return;
      if (next.storeId !== saved.storeId) throw new Error("goals.ownerChanged");
      setObservationError("");
      if (JSON.stringify(next) !== JSON.stringify(current.current)) {
        current.current = next;
        setSnapshot(next);
      }
    } catch (failure) {
      if (live()) setObservationError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (owner === generation.current) observing.current = false;
    }
  }, []);

  const readExecutors = useCallback(async () => {
    const captured = port.current,
      owner = generation.current,
      saved = current.current;
    if (!captured || !saved) throw new Error("goals.refreshRequired");
    const result = await captured.executors();
    if (
      !active.current ||
      owner !== generation.current ||
      port.current !== captured ||
      result.storeId !== saved.storeId
    )
      throw new Error("goals.ownerChanged");
    return result;
  }, []);

  const launch = useCallback(async (input: GoalLaunchInput) => {
    const captured = port.current,
      owner = generation.current;
    if (!captured || !current.current || current.current.storeId !== input.goal.storeId)
      throw new Error("goals.ownerChanged");
    if (lock.current || pending.current) throw new Error("goals.retryPending");
    lock.current = true;
    observationVersion.current++;
    setBusy(true);
    try {
      const result = await captured.launch(input);
      if (!active.current || owner !== generation.current || port.current !== captured)
        throw new Error("goals.ownerChanged");
      if (
        result.requestId !== input.requestId ||
        result.snapshot.storeId !== input.goal.storeId ||
        (input.peerId !== null && result.sourceHostId !== input.peerId)
      )
        throw new Error("goals.ownerChanged");
      current.current = result.snapshot;
      setSnapshot(result.snapshot);
      setObservationError("");
      return result;
    } finally {
      if (owner === generation.current) {
        lock.current = false;
        if (active.current) setBusy(false);
      }
    }
  }, []);

  const readActivity = useCallback(async (id: string, cursor: GoalActivityCursor | null = null) => {
    const version = ++activityVersion.current,
      owner = generation.current;
    setActivityBusy(true);
    setActivityError("");
    if (!cursor) setActivity(null);
    try {
      if (!port.current) throw new Error("goals.refreshRequired");
      const page = await port.current.activity(id, cursor);
      if (!active.current || version !== activityVersion.current || owner !== generation.current)
        return;
      if (page.goalId !== id) throw new Error("goals.ownerChanged");
      setActivity((old) =>
        cursor && old?.goalId === id
          ? {
              ...page,
              items: [
                ...old.items,
                ...page.items.filter(
                  (item) => !old.items.some((previous) => previous.id === item.id),
                ),
              ],
            }
          : page,
      );
    } catch (failure) {
      if (active.current && version === activityVersion.current && owner === generation.current)
        setActivityError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (active.current && version === activityVersion.current && owner === generation.current)
        setActivityBusy(false);
    }
  }, []);

  const readArtifacts = useCallback(
    async (id: string, cursor: GoalActivityCursor | null = null) => {
      const version = ++artifactVersion.current,
        owner = generation.current,
        storeId = current.current?.storeId;
      setArtifactsBusy(true);
      setArtifactsError("");
      if (!cursor) {
        artifactPage.current = null;
        setArtifacts(null);
      }
      try {
        if (!port.current || !storeId) throw new Error("goals.refreshRequired");
        const page = await port.current.artifacts(id, cursor);
        if (!active.current || version !== artifactVersion.current || owner !== generation.current)
          return;
        if (page.goalId !== id || page.storeId !== storeId) throw new Error("goals.ownerChanged");
        const old = artifactPage.current;
        const next =
          cursor && old?.goalId === id
            ? {
                ...page,
                items: [
                  ...old.items,
                  ...page.items.filter(
                    (item) => !old.items.some((previous) => previous.id === item.id),
                  ),
                ],
              }
            : page;
        artifactPage.current = next;
        setArtifacts(next);
      } catch (failure) {
        if (active.current && version === artifactVersion.current && owner === generation.current)
          setArtifactsError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (active.current && version === artifactVersion.current && owner === generation.current)
          setArtifactsBusy(false);
      }
    },
    [],
  );

  const downloadArtifact = useCallback(
    async (goalId: string, artifact: GoalArtifact, workdir: string, viewCurrent: () => boolean) => {
      if (downloadLock.current) return;
      downloadLock.current = true;
      const owner = generation.current,
        version = artifactVersion.current,
        storeId = current.current?.storeId;
      setDownloadBusy(artifact.id);
      setDownloadError("");
      const live = () =>
        active.current &&
        owner === generation.current &&
        version === artifactVersion.current &&
        storeId === current.current?.storeId &&
        viewCurrent();
      try {
        const page = artifactPage.current,
          captured = port.current;
        if (
          !captured ||
          page?.storeId !== current.current?.storeId ||
          page?.goalId !== goalId ||
          !page.items.some((item) => sameGoalArtifact(item, artifact))
        )
          throw new Error("goals.artifactChanged");
        const content = await captured.artifactContent(goalId, artifact);
        if (!live()) return;
        const saved = await transferGoalArtifact(goalId, artifact, content, workdir, live);
        if (live())
          setTransfers((old) => ({ ...old, [`${page.storeId}:${goalId}:${artifact.id}`]: saved }));
      } catch (failure) {
        if (live()) setDownloadError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (owner === generation.current) {
          downloadLock.current = false;
          if (active.current) setDownloadBusy(null);
        }
      }
    },
    [],
  );

  useEffect(() => {
    active.current = true;
    const changed = () => {
      generation.current++;
      observationVersion.current++;
      observing.current = false;
      activityVersion.current++;
      artifactVersion.current++;
      artifactPage.current = null;
      downloadLock.current = false;
      port.current = null;
      current.current = null;
      pending.current = null;
      lock.current = false;
      setSnapshot(null);
      setActivity(null);
      setRetryAvailable(false);
      setError("goals.ownerChanged");
      setObservationError("");
      setBusy(false);
      setActivityBusy(false);
      setArtifacts(null);
      setArtifactsBusy(false);
      setArtifactsError("");
      setDownloadBusy(null);
      setDownloadError("");
      setTransfers({});
    };
    window.addEventListener(LAN_PC_SESSION_CHANGED_EVENT, changed);
    window.addEventListener("focus", observe);
    const timer = window.setInterval(observe, 15000);
    void perform();
    return () => {
      active.current = false;
      generation.current++;
      observationVersion.current++;
      observing.current = false;
      activityVersion.current++;
      artifactVersion.current++;
      downloadLock.current = false;
      lock.current = false;
      window.removeEventListener(LAN_PC_SESSION_CHANGED_EVENT, changed);
      window.removeEventListener("focus", observe);
      window.clearInterval(timer);
    };
  }, [perform, observe]);

  return {
    snapshot,
    readExecutors,
    launch,
    busy,
    error,
    observationError,
    activity,
    activityBusy,
    activityError,
    retryAvailable,
    refresh: () => perform(),
    apply: (operation: GoalOperation, revision: number) => perform(operation, revision),
    retry: () => perform(undefined, undefined, true),
    readActivity,
    artifacts,
    artifactsBusy,
    artifactsError,
    readArtifacts,
    downloadBusy,
    downloadError,
    downloadArtifact,
    transfers,
    retireArtifacts: () => {
      artifactVersion.current++;
      artifactPage.current = null;
      setArtifacts(null);
      setArtifactsBusy(false);
      setArtifactsError("");
      setDownloadError("");
    },
    retireActivity: () => {
      activityVersion.current++;
      setActivity(null);
      setActivityBusy(false);
      setActivityError("");
    },
  };
}
