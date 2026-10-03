// Data hooks for the memory settings panel: list/read/mutate/wipe for the
// panel itself and organize-run list/read for the history modal. Organize-run
// status polling runs ONLY while some run is pending/running — idle panels
// never poll.
//
// Shared by every frontend runtime. Platform differences belong in the
// runtime boundary, never in this data hook.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatMemoryError,
  type MemoryMeta,
  type MemoryOrganizeRun,
  type MemoryOrganizeRunStatus,
  type MemoryPathsInfo,
  type MemoryReadResponse,
  memoryAccept,
  memoryDelete,
  memoryList,
  memoryOrganizeRunList,
  memoryOrganizeRunRead,
  memoryPathsInfo,
  memoryRead,
  memoryUpdate,
  memoryWipeAll,
  memoryWrite,
} from "../../../lib/memory/api";
import { PANEL_RUN_POLL_INTERVAL_MS } from "../../../lib/memory/config";
import type { MemoryType } from "../../../lib/memory/schema";
import {
  entryKey,
  isOrganizerRunActive,
  type MemoryQuota,
  selectedEntryWorkdir,
} from "./panelModel";

export type MemoryCreateDraft = {
  slug: string;
  scope: "global" | "project";
  memoryType: MemoryType;
  description: string;
  body: string;
};

export type MemoryEditDraft = {
  description: string;
  body: string;
  appendBody: string;
};

export function useMemoryPanelData(input: { workdir?: string; t: (key: string) => string }) {
  const { workdir, t } = input;
  const lifetime = useRef({ workdir, active: true, epoch: 0, read: 0, list: 0, mutating: false });
  if (lifetime.current.workdir !== workdir) {
    lifetime.current.active = false;
    lifetime.current = { workdir, active: true, epoch: 0, read: 0, list: 0, mutating: false };
  }
  const scope = lifetime.current;
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.epoch++;
      scope.read++;
      scope.list++;
    };
  }, [scope]);
  const [entries, setEntries] = useState<MemoryMeta[]>([]);
  const [quota, setQuota] = useState<MemoryQuota | null>(null);
  const [selected, setSelected] = useState<MemoryReadResponse | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<MemoryMeta | null>(null);
  const [pathsInfo, setPathsInfo] = useState<MemoryPathsInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [organizerWatchRunId, setOrganizerWatchRunId] = useState<string | null>(null);
  const [editDraft, setEditDraftState] = useState<MemoryEditDraft>({
    description: "",
    body: "",
    appendBody: "",
  });
  const editDraftRef = useRef(editDraft);
  const setEditDraft = useCallback(
    (update: MemoryEditDraft | ((current: MemoryEditDraft) => MemoryEditDraft)) => {
      const next = typeof update === "function" ? update(editDraftRef.current) : update;
      editDraftRef.current = next;
      setEditDraftState(next);
    },
    [],
  );

  async function reload(keepEntry?: string | null) {
    if (!scope.active) return false;
    const sequence = ++scope.list;
    const readSequence = scope.read;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [list, info] = await Promise.all([
        memoryList({ workdir, includeAllProjects: true, includeDaily: true, limit: 1000 }),
        memoryPathsInfo(),
      ]);
      if (!scope.active || sequence !== scope.list) return false;
      setEntries(list.entries);
      setQuota(list.quota);
      setPathsInfo(info);
      const keepKey =
        keepEntry === undefined ? (selectedEntry ? entryKey(selectedEntry) : null) : keepEntry;
      if (keepKey && readSequence === scope.read) {
        const found =
          list.entries.find((entry) => entryKey(entry) === keepKey) ??
          list.entries.find((entry) => entry.slug === keepKey);
        if (found) {
          if (!(await openEntry(found, true))) return false;
        } else {
          setSelected(null);
          setSelectedEntry(null);
        }
      }
      return scope.active && sequence === scope.list;
    } catch (err) {
      if (scope.active && sequence === scope.list) setError(formatMemoryError(err));
      return false;
    } finally {
      if (scope.active && sequence === scope.list) setLoading(false);
    }
  }

  async function openEntry(entry: MemoryMeta, reloadAfterMutation = false) {
    if (!scope.active || (scope.mutating && !reloadAfterMutation)) return false;
    const sequence = ++scope.read;
    setError(null);
    setNotice(null);
    try {
      const read = await memoryRead({
        slug: entry.slug,
        scope: entry.scope,
        workdir: selectedEntryWorkdir(entry, workdir),
        workdirHash: entry.scope === "project" ? entry.workdirHash : undefined,
      });
      if (!scope.active || sequence !== scope.read) return false;
      setSelected(read);
      setSelectedEntry(entry);
      setEditDraft({
        description: read.description,
        body: read.body,
        appendBody: "",
      });
      return true;
    } catch (err) {
      if (scope.active && sequence === scope.read) setError(formatMemoryError(err));
      return false;
    }
  }

  /** Returns true when the entry was created (so the caller can reset its form). */
  async function createEntry(draft: MemoryCreateDraft) {
    if (!scope.active || scope.mutating) return false;
    const epoch = scope.epoch;
    scope.mutating = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (draft.scope === "project" && !workdir) {
        throw new Error(t("settings.memoryProjectRequiresWorkdir"));
      }
      const result = await memoryWrite({
        slug: draft.slug,
        scope: draft.scope,
        workdir,
        memoryType: draft.memoryType,
        description: draft.description,
        body: draft.body,
        actor: "user",
      });
      if (!scope.active || scope.epoch !== epoch) return false;
      if (!(await reload(result.slug))) return false;
      setNotice(t("settings.memoryCreated"));
      return true;
    } catch (err) {
      if (scope.active && scope.epoch === epoch) setError(formatMemoryError(err));
      return false;
    } finally {
      if (scope.active && scope.epoch === epoch) {
        scope.mutating = false;
        setSaving(false);
      }
    }
  }

  async function saveSelected() {
    if (!selected || !scope.active || scope.mutating) return;
    const epoch = scope.epoch;
    const submittedDraft = editDraftRef.current;
    scope.mutating = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const isDaily = selected.memoryType === "daily";
      const result = await memoryUpdate({
        slug: selected.slug,
        scope: selected.scope,
        workdir: selectedEntryWorkdir(selectedEntry, workdir),
        workdirHash: selectedEntry?.scope === "project" ? selectedEntry.workdirHash : undefined,
        description: isDaily ? undefined : submittedDraft.description,
        body: isDaily ? submittedDraft.appendBody : submittedDraft.body,
        mode: isDaily ? "append" : "replace",
        actor: "user",
      });
      if (!scope.active || scope.epoch !== epoch) return;
      setEditDraft((prev) => ({ ...prev, appendBody: "" }));
      if (await reload(selectedEntry ? entryKey(selectedEntry) : result.slug)) {
        setNotice(t("settings.saved"));
      }
    } catch (err) {
      if (scope.active && scope.epoch === epoch) setError(formatMemoryError(err));
    } finally {
      if (scope.active && scope.epoch === epoch) {
        scope.mutating = false;
        setSaving(false);
      }
    }
  }

  async function acceptSelected() {
    if (!selected || !scope.active || scope.mutating) return;
    const epoch = scope.epoch;
    scope.mutating = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await memoryAccept({
        slug: selected.slug,
        scope: selected.scope,
        workdir: selectedEntryWorkdir(selectedEntry, workdir),
        workdirHash: selectedEntry?.scope === "project" ? selectedEntry.workdirHash : undefined,
      });
      if (!scope.active || scope.epoch !== epoch) return;
      if (await reload(selectedEntry ? entryKey(selectedEntry) : selected.slug)) {
        setNotice(t("settings.memoryAccepted"));
      }
    } catch (err) {
      if (scope.active && scope.epoch === epoch) setError(formatMemoryError(err));
    } finally {
      if (scope.active && scope.epoch === epoch) {
        scope.mutating = false;
        setSaving(false);
      }
    }
  }

  async function deleteSelected() {
    if (!selected || !scope.active || scope.mutating) return false;
    const epoch = scope.epoch;
    scope.mutating = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await memoryDelete({
        slug: selected.slug,
        scope: selected.scope,
        workdir: selectedEntryWorkdir(selectedEntry, workdir),
        workdirHash: selectedEntry?.scope === "project" ? selectedEntry.workdirHash : undefined,
        actor: "user",
      });
      if (!scope.active || scope.epoch !== epoch) return false;
      setSelected(null);
      setSelectedEntry(null);
      if (await reload()) setNotice(t("settings.memoryDeleted"));
      return scope.active && scope.epoch === epoch;
    } catch (err) {
      if (scope.active && scope.epoch === epoch) setError(formatMemoryError(err));
      return false;
    } finally {
      if (scope.active && scope.epoch === epoch) {
        scope.mutating = false;
        setSaving(false);
      }
    }
  }

  async function wipeAll() {
    if (!scope.active || scope.mutating) return false;
    const epoch = scope.epoch;
    scope.mutating = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const info = await memoryWipeAll();
      if (!scope.active || scope.epoch !== epoch) return false;
      setPathsInfo(info);
      setEntries([]);
      setQuota((prev) =>
        prev
          ? {
              ...prev,
              used: 0,
              scopeQuotas: prev.scopeQuotas?.map((item) => ({ ...item, used: 0 })),
            }
          : prev,
      );
      setSelected(null);
      setSelectedEntry(null);
      setNotice(t("settings.memoryCleared"));
      return true;
    } catch (err) {
      if (scope.active && scope.epoch === epoch) setError(formatMemoryError(err));
      return false;
    } finally {
      if (scope.active && scope.epoch === epoch) {
        scope.mutating = false;
        setSaving(false);
      }
    }
  }

  // Watch a queued organizer run: poll while it is pending/running, then do a
  // single reload once it settles. No run being watched ⇒ no polling at all.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload identity changes every render; the watched run id is the trigger
  useEffect(() => {
    if (!organizerWatchRunId) return;
    const watchedRunId = organizerWatchRunId;
    let cancelled = false;

    async function pollRun() {
      try {
        const run = await memoryOrganizeRunRead({ runId: watchedRunId });
        if (cancelled || (run && isOrganizerRunActive(run))) return;
        setOrganizerWatchRunId(null);
        await reload();
      } catch (err) {
        if (cancelled) return;
        setOrganizerWatchRunId(null);
        setError(formatMemoryError(err));
      }
    }

    const interval = window.setInterval(() => void pollRun(), PANEL_RUN_POLL_INTERVAL_MS);
    void pollRun();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [organizerWatchRunId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload identity changes every render; workdir is the trigger
  useEffect(() => {
    setSaving(false);
    setSelected(null);
    setSelectedEntry(null);
    void reload(null);
  }, [workdir]);

  return {
    entries,
    quota,
    selected,
    selectedEntry,
    pathsInfo,
    loading,
    error,
    notice,
    saving,
    editDraft,
    setEditDraft,
    reload,
    openEntry,
    createEntry,
    saveSelected,
    acceptSelected,
    deleteSelected,
    wipeAll,
    watchOrganizerRun: setOrganizerWatchRunId,
  };
}

export function useOrganizeRunHistory(input: { statusFilter: "all" | MemoryOrganizeRunStatus }) {
  const { statusFilter } = input;
  const [runs, setRuns] = useState<MemoryOrganizeRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<MemoryOrganizeRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = useRef({ filter: statusFilter, active: true, generation: 0, selectionId: "" });
  if (history.current.filter !== statusFilter) {
    history.current.active = false;
    history.current = { filter: statusFilter, active: true, generation: 0, selectionId: "" };
  }
  const scope = history.current;
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.generation += 1;
    };
  }, [scope]);

  async function reload(
    selectRunId?: string,
    options?: { quiet?: boolean; keepSelection?: boolean },
  ) {
    if (!scope.active || history.current !== scope) return;
    const quiet = options?.quiet === true;
    const generation = ++scope.generation;
    const current = () =>
      scope.active && history.current === scope && scope.generation === generation;
    if (selectRunId && !quiet) scope.selectionId = selectRunId;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await memoryOrganizeRunList({
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 80,
      });
      if (!current()) return;
      setRuns(response.runs);
      const requestedId =
        options?.keepSelection === false ? undefined : scope.selectionId || selectedRun?.runId;
      const nextId = response.runs.some((run) => run.runId === requestedId)
        ? requestedId
        : response.runs[0]?.runId;
      const next = nextId ? await memoryOrganizeRunRead({ runId: nextId }) : null;
      if (!current()) return;
      scope.selectionId = next?.runId ?? response.runs[0]?.runId ?? "";
      setSelectedRun(next ?? response.runs[0] ?? null);
    } catch (err) {
      if (current()) setError(formatMemoryError(err));
    } finally {
      if (current()) {
        setLoading(false);
      }
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload identity changes every render; statusFilter is the trigger
  useEffect(() => {
    void reload();
  }, [statusFilter]);

  const hasActiveRun = runs.some(isOrganizerRunActive) || isOrganizerRunActive(selectedRun);

  // Poll ONLY while a run is pending/running; a fully settled history never
  // schedules an interval.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload identity changes every render; the poll keys are the triggers
  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = window.setInterval(() => {
      void reload(undefined, { quiet: true });
    }, PANEL_RUN_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [hasActiveRun, selectedRun?.runId, statusFilter]);

  return {
    runs,
    selectedRun,
    setSelectedRun,
    loading,
    error,
    setError,
    reload,
  };
}
