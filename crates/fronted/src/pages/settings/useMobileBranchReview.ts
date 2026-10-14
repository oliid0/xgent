import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../../lib/automation/backend";
import {
  type MobileBranchReview,
  type MobileReadDestination,
  type MobileReadKind,
  mobileReadChoiceKey,
} from "../../lib/automation/mobileBranchActions";
import {
  notifyMobileBranchRecovery,
  notifyMobileBranchRevocation,
} from "../../lib/automation/mobileBranchEvents";
import { ensureMobilePersonalReadPermission } from "../../lib/tools/mobilePersonalAssistantTools";

const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
type ReadChoicesDraft = {
  contextHash: string;
  revision: number;
  generation: number;
  choices: MobileReadDestination[];
  selected: MobileReadDestination[];
  page: number;
  truncated: boolean;
};

/** Retired views cannot act on or overwrite another task. Reads reserve no model attempts. */
export function useMobileBranchReview(
  entryId: string | null,
  requestId: string,
  sourceHostId: string,
) {
  const key = JSON.stringify([entryId, requestId, sourceHostId]);
  const current = useRef(key);
  current.current = key;
  const revision = useRef(0);
  const lock = useRef<string | null>(null);
  const readSerial = useRef(0);
  const discoveryAbort = useRef<AbortController | null>(null);
  const [readChoices, setReadChoices] = useState<Record<string, ReadChoicesDraft>>({});
  const latestReadChoices = useRef(readChoices);
  latestReadChoices.current = readChoices;
  const readGenerations = useRef<Record<string, number>>({});
  const [state, setState] = useState<{
    key: string;
    review: MobileBranchReview | null;
    loading: boolean;
    busy: boolean;
    error: string | null;
  }>({ key, review: null, loading: false, busy: false, error: null });
  const refresh = useCallback(async () => {
    if (!entryId || current.current !== key) return;
    const version = ++revision.current;
    setState((old) => ({ ...old, key, loading: true, error: null }));
    try {
      const review = await backend.inspectMobileBranches(entryId);
      if (review.requestId !== requestId || review.sourceHostId !== sourceHostId)
        throw new Error("Phone review changed its original task/controller");
      if (current.current === key && version === revision.current)
        setState((old) => ({ ...old, key, review, loading: false, error: null }));
    } catch (error) {
      if (current.current === key && version === revision.current)
        setState((old) => ({
          ...old,
          key,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
    }
  }, [entryId, key, requestId, sourceHostId]);
  useEffect(() => {
    current.current = key;
    setState({ key, review: null, loading: !!entryId, busy: false, error: null });
    setReadChoices({});
    readGenerations.current = {};
    if (!entryId) return;
    void refresh();
    // Poll only a real visible app view. Test/server environments own no timer.
    const timer =
      typeof document === "undefined"
        ? null
        : setInterval(() => {
            if (visible() && lock.current !== key) void refresh();
          }, 10_000);
    return () => {
      revision.current++;
      discoveryAbort.current?.abort();
      if (current.current === key) current.current = "retired";
      if (timer !== null) clearInterval(timer);
    };
  }, [entryId, key, refresh]);
  const mutate = async (work: (entry: string) => Promise<void>, revoke = false, notify = true) => {
    if (
      !entryId ||
      current.current !== key ||
      lock.current !== null ||
      state.key !== key ||
      state.loading ||
      state.error
    )
      return;
    lock.current = key;
    setState((old) => ({ ...old, busy: true, error: null }));
    try {
      await work(entryId);
      // This hint cannot grant native authority; the worker rereads all fences.
      if (notify) {
        if (revoke) notifyMobileBranchRevocation(entryId);
        else notifyMobileBranchRecovery(entryId);
      }
      if (current.current === key) await refresh();
    } catch (error) {
      if (current.current === key)
        setState((old) => ({
          ...old,
          error: error instanceof Error ? error.message : String(error),
        }));
    } finally {
      lock.current = null;
      if (current.current === key) setState((old) => ({ ...old, busy: false }));
    }
  };
  const loadReadChoices = async (
    branchId: string,
    kind: MobileReadKind,
    expectedHash: string,
    expectedRevision: number,
  ) => {
    const auth = state.review?.branches.find(
      (branch) => branch.source.id === branchId,
    )?.readAuthorization;
    if (
      !auth ||
      auth.contextHash !== expectedHash ||
      auth.revision !== expectedRevision ||
      !auth.canDiscoverKinds.includes(kind)
    )
      return;
    await mutate(
      async (entry) => {
        const currentAuth = await backend.getMobileBranchReadAuthorization(entry, branchId);
        if (
          currentAuth.contextHash !== expectedHash ||
          currentAuth.revision !== expectedRevision ||
          !currentAuth.canDiscoverKinds.includes(kind)
        )
          throw new Error("Refresh the changed native task read scope before account discovery");
        const abort = new AbortController();
        discoveryAbort.current = abort;
        try {
          if (current.current !== key) return;
          // Health discovery is metadata only. Its selected metric OS request
          // belongs to the explicit native approval, never a generic grant.
          if (kind !== "health") await ensureMobilePersonalReadPermission(kind, abort.signal);
          abort.signal.throwIfAborted();
          if (current.current !== key) return;
          const choices = await backend.getMobileBranchReadChoices(entry, branchId, kind);
          abort.signal.throwIfAborted();
          if (
            choices.kind !== kind ||
            choices.authorization.contextHash !== expectedHash ||
            choices.authorization.revision !== expectedRevision
          )
            throw new Error("SDK account discovery changed its original task/read scope");
          if (
            choices.calendars.length > 200 ||
            choices.calendars.some((choice) => !choice.id || !choice.sourceId)
          )
            throw new Error(
              "SDK account discovery returned no bounded real list/account identities",
            );
          if (current.current !== key) return;
          const generation = ++readSerial.current;
          readGenerations.current[branchId] = generation;
          setReadChoices((old) => {
            const saved = old[branchId];
            const retained =
              saved?.contextHash === expectedHash && saved.revision === expectedRevision
                ? saved
                : undefined;
            return {
              ...old,
              [branchId]: {
                contextHash: expectedHash,
                revision: expectedRevision,
                generation,
                page: 0,
                choices: [
                  ...(retained?.choices.filter((choice) => choice.kind !== kind) ?? []),
                  ...choices.calendars.map((choice) => ({ ...choice, kind })),
                ],
                selected: retained?.selected ?? auth.selections,
                truncated: choices.truncated || retained?.truncated === true,
              },
            };
          });
        } finally {
          if (discoveryAbort.current === abort) discoveryAbort.current = null;
        }
      },
      false,
      false,
    );
  };
  const editReadChoices = (
    branchId: string,
    expectedGeneration: number,
    choiceKey: string | null,
    page?: number,
  ) => {
    if (
      current.current !== key ||
      lock.current ||
      state.loading ||
      state.error ||
      state.review?.cancelRequested
    )
      return;
    const auth = state.review?.branches.find(
      (branch) => branch.source.id === branchId,
    )?.readAuthorization;
    if (readGenerations.current[branchId] !== expectedGeneration) return;
    const generation = ++readSerial.current;
    setReadChoices((old) => {
      const draft = old[branchId];
      if (
        !auth ||
        !draft ||
        draft.generation !== expectedGeneration ||
        draft.contextHash !== auth.contextHash ||
        draft.revision !== auth.revision
      )
        return old;
      if (page !== undefined) {
        if (!Number.isSafeInteger(page) || page < 0 || page >= Math.ceil(draft.choices.length / 20))
          return old;
        readGenerations.current[branchId] = generation;
        return { ...old, [branchId]: { ...draft, page, generation } };
      }
      const choice = draft.choices.find((choice) => mobileReadChoiceKey(choice) === choiceKey);
      if (!choice) return old;
      const included = draft.selected.some((value) => mobileReadChoiceKey(value) === choiceKey);
      if (!included && draft.selected.length >= 16) return old;
      readGenerations.current[branchId] = generation;
      return {
        ...old,
        [branchId]: {
          ...draft,
          generation,
          selected: included
            ? draft.selected.filter((value) => mobileReadChoiceKey(value) !== choiceKey)
            : [...draft.selected, choice],
        },
      };
    });
  };
  const decideReadAuthorization = async (
    branchId: string,
    expectedHash: string,
    expectedRevision: number,
    expectedGeneration: number | null,
    approve: boolean,
  ) => {
    const auth = state.review?.branches.find(
      (branch) => branch.source.id === branchId,
    )?.readAuthorization;
    const draft = latestReadChoices.current[branchId];
    if (
      !auth ||
      auth.contextHash !== expectedHash ||
      auth.revision !== expectedRevision ||
      !(approve ? auth.canApprove : auth.canRevoke)
    )
      return;
    if (
      approve &&
      (state.review?.cancelRequested ||
        !draft ||
        draft.generation !== expectedGeneration ||
        readGenerations.current[branchId] !== expectedGeneration ||
        draft.contextHash !== expectedHash ||
        draft.revision !== expectedRevision ||
        !draft.selected.length ||
        draft.selected.length > 16)
    )
      return;
    const selected = approve
      ? draft.selected.map(({ kind, id, sourceId, startMs, endMs }) =>
          kind === "health" ? { kind, id, sourceId, startMs, endMs } : { kind, id, sourceId },
        )
      : [];
    await mutate(async (entry) => {
      await backend.decideMobileBranchReadAuthorization(
        entry,
        branchId,
        expectedHash,
        expectedRevision,
        selected,
        approve,
      );
      if (current.current === key)
        setReadChoices((old) => {
          delete readGenerations.current[branchId];
          const next = { ...old };
          delete next[branchId];
          return next;
        });
    }, !approve);
  };
  const retryPlanning = async (branchId: string, expectedRecovery: number) => {
    const branch = state.review?.branches.find((branch) => branch.source.id === branchId);
    if (
      !branch?.canRetryPlanning ||
      branch.recovery !== expectedRecovery ||
      state.review?.cancelRequested
    )
      return;
    await mutate((entry) => backend.retryMobileBranchPlanning(entry, branchId, expectedRecovery));
  };
  const decideAuthorization = async (
    branchId: string,
    expectedHash: string,
    expectedRevision: number,
    approve: boolean,
  ) => {
    const status = state.review?.branches.find(
      (branch) => branch.source.id === branchId,
    )?.authorization;
    if (
      !status ||
      status.planHash !== expectedHash ||
      status.revision !== expectedRevision ||
      (approve && state.review?.cancelRequested) ||
      !(approve ? status.canApprove : status.canRevoke)
    )
      return;
    await mutate(
      (entry) =>
        backend.decideMobileBranchAuthorization(
          entry,
          branchId,
          expectedHash,
          expectedRevision,
          approve,
        ),
      !approve,
    );
  };
  const view =
    state.key === key ? state : { review: null, loading: !!entryId, busy: false, error: null };
  return {
    ...view,
    refresh,
    retryPlanning,
    decideAuthorization,
    readChoices: state.key === key ? readChoices : {},
    loadReadChoices,
    editReadChoices,
    decideReadAuthorization,
  };
}
