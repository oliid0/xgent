import { invoke, openUrl } from "@xgent/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CodexOAuthDeviceCode,
  type CodexOAuthPollResult,
  type CodexOAuthStatus,
  deviceLoginURL,
} from "../../lib/providers/oauthDeviceFlow";
import { writeClipboardText } from "../../lib/system/clipboardText";

type Operation = "load" | "start" | "remove" | "open" | "copy" | null;
type Props = {
  value: string;
  onChange: (accountId: string) => void;
  browserRuntime: boolean;
  enabled?: boolean;
  /** Retires callbacks and pending login when the selected provider changes. */
  scopeKey?: string;
};

/** Both presentations use the same native account store, actions and device polling. */
export function useCodexOAuthAccounts(props: Props, t: (key: string) => string) {
  const enabled = props.enabled !== false && !props.browserRuntime;
  const scopeKey = props.scopeKey ?? "oauth-accounts";
  const latest = useRef({ props, t, scopeKey });
  latest.current = { props, t, scopeKey };
  const [status, setStatus] = useState<CodexOAuthStatus>({ accounts: [] });
  const [deviceCode, setDeviceCode] = useState<CodexOAuthDeviceCode | null>(null);
  const [operation, setOperation] = useState<Operation>(enabled ? "load" : null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const state = useRef({
    active: false,
    generation: 0,
    flowRevision: 0,
    scopeKey,
    operation: null as Operation,
    flow: null as CodexOAuthDeviceCode | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    accounts: [] as CodexOAuthStatus["accounts"],
  }).current;
  const current = useCallback(
    (generation: number) =>
      state.active &&
      state.generation === generation &&
      state.scopeKey === latest.current.scopeKey &&
      latest.current.props.enabled !== false &&
      !latest.current.props.browserRuntime,
    [state],
  );
  const report = useCallback(
    (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    [],
  );
  const cancelBackend = useCallback(async (flowId: string) => {
    await invoke("provider_oauth_cancel_codex", { flowId });
  }, []);
  const retireFlow = useCallback(() => {
    state.flowRevision++;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    const flow = state.flow;
    state.flow = null;
    return flow;
  }, [state]);
  const publishStatus = useCallback(
    (next: CodexOAuthStatus, selectDefault = true) => {
      state.accounts = next.accounts;
      setStatus(next);
      setLoaded(true);
      if (selectDefault && !latest.current.props.value && next.defaultAccountId)
        latest.current.props.onChange(next.defaultAccountId);
    },
    [state],
  );
  const run = useCallback(
    async (kind: Exclude<Operation, null>, task: (owns: () => boolean) => Promise<void>) => {
      const generation = state.generation;
      if (!current(generation) || state.operation !== null) return;
      state.operation = kind;
      setOperation(kind);
      setError(null);
      const owns = () => current(generation);
      try {
        await task(owns);
      } catch (reason) {
        if (owns()) report(reason);
      } finally {
        if (owns()) {
          state.operation = null;
          setOperation(null);
        }
      }
    },
    [state, current, report],
  );
  const reload = useCallback(
    () =>
      run("load", async (owns) => {
        const next = await invoke<CodexOAuthStatus>("provider_oauth_status_codex");
        if (owns()) publishStatus(next);
      }),
    [run, publishStatus],
  );

  useEffect(() => {
    state.active = enabled;
    state.scopeKey = scopeKey;
    state.generation++;
    state.operation = null;
    state.accounts = [];
    setStatus({ accounts: [] });
    setLoaded(false);
    setDeviceCode(null);
    setError(null);
    setOperation(null);
    if (enabled) void reload();
    return () => {
      state.active = false;
      state.generation++;
      state.operation = null;
      const flow = retireFlow();
      // No UI remains to own feedback; cleanup failures are still diagnosable.
      if (flow) void cancelBackend(flow.flowId).catch(console.error);
    };
  }, [enabled, scopeKey, state, reload, retireFlow, cancelBackend]);

  useEffect(() => {
    if (!enabled || !deviceCode || state.flow !== deviceCode) return;
    const generation = state.generation,
      revision = state.flowRevision;
    let disposed = false;
    const owns = () =>
      !disposed &&
      current(generation) &&
      state.flowRevision === revision &&
      state.flow === deviceCode;
    const stop = () => {
      retireFlow();
      setDeviceCode(null);
    };
    const poll = async () => {
      if (!owns()) return;
      if (Date.now() >= deviceCode.expiresAt * 1000) {
        stop();
        report(new Error(latest.current.t("settings.providerOAuthExpired")));
        void cancelBackend(deviceCode.flowId).catch(console.error);
        return;
      }
      try {
        const result = await invoke<CodexOAuthPollResult>("provider_oauth_poll_codex", {
          flowId: deviceCode.flowId,
        });
        if (!owns()) return;
        if (result.state === "complete") {
          stop();
          if (result.account?.id) latest.current.props.onChange(result.account.id);
          const completedRevision = state.flowRevision;
          try {
            const next = await invoke<CodexOAuthStatus>("provider_oauth_status_codex");
            if (current(generation) && state.flowRevision === completedRevision)
              publishStatus(next, false);
          } catch (reason) {
            if (current(generation) && state.flowRevision === completedRevision) report(reason);
          }
          return;
        }
        schedule();
      } catch (reason) {
        if (!owns()) return;
        stop();
        report(reason);
        void cancelBackend(deviceCode.flowId).catch(console.error);
      }
    };
    const schedule = () => {
      const interval = Math.max(3, Math.min(30, deviceCode.intervalSeconds)) * 1000;
      const remaining = Math.max(0, deviceCode.expiresAt * 1000 - Date.now());
      state.timer = setTimeout(() => void poll(), Math.min(interval, remaining));
    };
    schedule();
    return () => {
      disposed = true;
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = null;
    };
  }, [enabled, deviceCode, state, current, retireFlow, report, publishStatus, cancelBackend]);

  const actionGeneration = state.generation;
  const ownsAction = () => current(actionGeneration);
  const startLogin = () => {
    if (!ownsAction() || state.flow) return Promise.resolve();
    return run("start", async (owns) => {
      const revision = ++state.flowRevision;
      const flow = await invoke<CodexOAuthDeviceCode>("provider_oauth_start_codex");
      if (!owns() || state.flowRevision !== revision) {
        await cancelBackend(flow.flowId);
        return;
      }
      try {
        const url = deviceLoginURL(flow);
        if (
          !Number.isFinite(flow.expiresAt) ||
          flow.expiresAt * 1000 <= Date.now() ||
          !Number.isFinite(flow.intervalSeconds) ||
          !flow.flowId ||
          !flow.userCode
        )
          throw new Error(latest.current.t("settings.providerOAuthExpired"));
        state.flow = flow;
        setDeviceCode(flow);
        await openUrl(url);
      } catch (reason) {
        // A browser-launch error keeps the valid code visible for manual retry.
        if (state.flow !== flow) await cancelBackend(flow.flowId);
        throw reason;
      }
    });
  };
  const cancelLogin = async () => {
    if (!ownsAction()) return;
    const flow = retireFlow();
    setDeviceCode(null);
    setError(null);
    if (flow) {
      try {
        await cancelBackend(flow.flowId);
      } catch (reason) {
        if (ownsAction()) report(reason);
      }
    }
  };
  const reopenLogin = () =>
    !ownsAction()
      ? Promise.resolve()
      : run("open", async (owns) => {
          const flow = state.flow;
          if (!flow || !owns()) return;
          await openUrl(deviceLoginURL(flow));
        });
  const copyCode = () =>
    !ownsAction()
      ? Promise.resolve()
      : run("copy", async (owns) => {
          const flow = state.flow;
          if (!flow || !owns()) return;
          if (!(await writeClipboardText(flow.userCode)))
            throw new Error(latest.current.t("settings.providerOAuthCopyFailed"));
        });
  const selectAccount = (accountId: string) => {
    if (
      !ownsAction() ||
      state.operation ||
      state.flow ||
      !state.accounts.some((account) => account.id === accountId)
    )
      return;
    latest.current.props.onChange(accountId);
  };
  const removeAccount = (accountId: string) =>
    !ownsAction() || state.flow
      ? Promise.resolve()
      : run("remove", async (owns) => {
          if (!state.accounts.some((account) => account.id === accountId)) return;
          const next = await invoke<CodexOAuthStatus>("provider_oauth_remove_codex_account", {
            accountId,
          });
          if (!owns()) return;
          publishStatus(next, false);
          if (latest.current.props.value === accountId)
            latest.current.props.onChange(next.defaultAccountId ?? "");
        });
  return {
    status,
    deviceCode,
    operation,
    error,
    loaded,
    loading: operation === "load",
    starting: operation === "start",
    locked: operation !== null,
    reload: () => (ownsAction() ? reload() : Promise.resolve()),
    startLogin,
    cancelLogin,
    reopenLogin,
    copyCode,
    selectAccount,
    removeAccount,
  };
}
