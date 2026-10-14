import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AppSettings } from "../../lib/settings";
import {
  normalizeSchedulingBudget,
  validSchedulingBudget,
} from "../../lib/subagents/schedulingBudget";
import type { SetSettingsFn } from "./types";

export function useSchedulingBudgetEditor(
  props: { settings: AppSettings; setSettings: SetSettingsFn },
  active = true,
) {
  const config = normalizeSchedulingBudget(props.settings.system.schedulingBudget);
  const [draft, setDraft] = useState<{
    original: string;
    requests: string;
    tools: string;
    minutes: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(draft);
  current.current = draft;
  const latest = useRef({ ...props, active, mounted: true });
  Object.assign(latest.current, props, { active });
  const revision = useRef(0);
  useEffect(() => {
    latest.current.mounted = true;
    return () => {
      latest.current.mounted = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    if (!active) {
      current.current = null;
      setDraft(null);
      setError(null);
      revision.current++;
    }
  }, [active]);
  const epoch = revision.current;
  const valid = () => latest.current.mounted && latest.current.active && epoch === revision.current;
  const close = () => {
    current.current = null;
    revision.current++;
    setDraft(null);
    setError(null);
  };
  const parsed = draft
    ? {
        maxModelRequests: Number(draft.requests),
        maxToolCalls: Number(draft.tools),
        lifetimeMinutes: Number(draft.minutes),
      }
    : null;
  const issue =
    draft &&
    (!/^\d+$/.test(draft.requests) ||
      !/^\d+$/.test(draft.tools) ||
      !/^\d+$/.test(draft.minutes) ||
      !validSchedulingBudget(parsed))
      ? "schedulingBudget.invalid"
      : null;
  return {
    config,
    draft,
    error: error ?? issue,
    scope: `scheduling-budget:${epoch}`,
    open() {
      if (!valid() || current.current) return;
      const value = normalizeSchedulingBudget(latest.current.settings.system.schedulingBudget);
      revision.current++;
      const next = {
        original: JSON.stringify(value),
        requests: String(value.maxModelRequests),
        tools: String(value.maxToolCalls),
        minutes: String(value.lifetimeMinutes),
      };
      current.current = next;
      setDraft(next);
      setError(null);
    },
    patch(field: "requests" | "tools" | "minutes", value: string) {
      if (!valid() || !current.current) return;
      const next = { ...current.current, [field]: value };
      current.current = next;
      setDraft(next);
      setError(null);
    },
    cancel() {
      if (valid()) close();
    },
    save() {
      if (!valid() || !current.current) return;
      const captured = current.current;
      const next = {
        maxModelRequests: Number(captured.requests),
        maxToolCalls: Number(captured.tools),
        lifetimeMinutes: Number(captured.minutes),
      };
      if (
        ![captured.requests, captured.tools, captured.minutes].every((value) =>
          /^\d+$/.test(value),
        ) ||
        !validSchedulingBudget(next)
      ) {
        setError("schedulingBudget.invalid");
        return;
      }
      if (
        JSON.stringify(
          normalizeSchedulingBudget(latest.current.settings.system.schedulingBudget),
        ) !== captured.original
      ) {
        setError("schedulingBudget.conflict");
        return;
      }
      let applied = false;
      flushSync(() =>
        latest.current.setSettings((previous) => {
          if (
            JSON.stringify(normalizeSchedulingBudget(previous.system.schedulingBudget)) !==
            captured.original
          )
            return previous;
          applied = true;
          return { ...previous, system: { ...previous.system, schedulingBudget: next } };
        }),
      );
      if (!applied) {
        setError("schedulingBudget.conflict");
        return;
      }
      close();
    },
  };
}

export type SchedulingBudgetEditor = ReturnType<typeof useSchedulingBudgetEditor>;
