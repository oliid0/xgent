import { invokeNative } from "@xgent/runtime";
import { useEffect, useRef, useState } from "react";
import { writeClipboardText } from "../system/clipboardText";
import {
  type GitHubAuthorizationStatus,
  parseGitHubAuthorizationStatus,
} from "./githubAuthorization";

export function useGitHubAuthorization(enabled: boolean, onConnected?: () => Promise<void>) {
  const [status, setStatus] = useState<GitHubAuthorizationStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const changed = useRef(onConnected);
  changed.current = onConnected;
  const [owner] = useState(() => ({
    active: enabled,
    revision: 0,
    busy: "",
    readRevision: 0,
    observationSerial: 0,
    observing: false,
    actionError: false,
    clientId: "",
    status: null as GitHubAuthorizationStatus | null,
    account: "",
  }));
  owner.active = enabled;
  const receive = (next: GitHubAuthorizationStatus) => {
    owner.status = next;
    setStatus(next);
    if (next.account?.accountId && next.account.accountId !== owner.account) {
      owner.account = next.account.accountId;
      owner.actionError = false;
      setError(null);
      void changed.current?.().catch(() => {});
    }
  };
  const changeClient = (value: string) => {
    if (owner.active) {
      owner.clientId = value;
      setClientId(value);
    }
  };
  async function run(
    action: "refresh" | "start" | "open" | "copy" | "cancel",
    flowId = owner.status?.flowId,
  ) {
    if (!owner.active || owner.busy) return false;
    if (["open", "copy", "cancel"].includes(action) && (!flowId || owner.status?.flowId !== flowId))
      return false;
    const revision = owner.revision;
    owner.readRevision++;
    const current = () => owner.active && owner.revision === revision;
    owner.busy = action;
    setBusy(action);
    owner.actionError = false;
    setError(null);
    try {
      if (action === "copy") {
        if (!owner.status?.userCode || !(await writeClipboardText(owner.status.userCode)))
          throw new Error("github-oauth-open");
      } else if (action === "open") {
        await invokeNative("github_oauth_open", { flowId });
      } else {
        const next = parseGitHubAuthorizationStatus(
          await invokeNative(
            action === "start"
              ? "github_oauth_start"
              : action === "cancel"
                ? "github_oauth_cancel"
                : "github_oauth_status",
            action === "start"
              ? { clientId: owner.clientId.trim() }
              : action === "cancel"
                ? { flowId }
                : undefined,
          ),
        );
        if (!current()) return false;
        receive(next);
        if (current() && action === "start" && next.phase === "pending" && next.flowId) {
          await invokeNative("github_oauth_open", { flowId: next.flowId });
        }
      }
      return current();
    } catch (cause) {
      if (current()) {
        owner.actionError = true;
        setError(cause);
      }
      return false;
    } finally {
      if (current()) {
        owner.busy = "";
        setBusy("");
      }
    }
  }
  async function observe() {
    if (!owner.active || owner.busy || owner.observing) return;
    const revision = owner.revision;
    const read = owner.readRevision;
    const serial = ++owner.observationSerial;
    owner.observing = true;
    const current = () =>
      owner.active && owner.revision === revision && owner.readRevision === read;
    try {
      const next = parseGitHubAuthorizationStatus(await invokeNative("github_oauth_status"));
      if (current()) {
        receive(next);
        if (!owner.actionError) setError(null);
      }
    } catch (cause) {
      if (current() && !owner.actionError) setError(cause);
    } finally {
      if (owner.revision === revision && owner.observationSerial === serial)
        owner.observing = false;
    }
  }
  useEffect(() => {
    owner.active = enabled;
    owner.revision++;
    owner.busy = "";
    owner.readRevision++;
    owner.observationSerial++;
    owner.observing = false;
    owner.actionError = false;
    owner.status = null;
    owner.account = "";
    setBusy("");
    setError(null);
    setStatus(null);
    if (!enabled) return;
    void observe();
    const timer = setInterval(() => void observe(), 3000);
    return () => {
      clearInterval(timer);
      owner.active = false;
      owner.revision++;
    };
  }, [enabled, owner]);
  const flow = status?.flowId;
  return {
    status,
    clientId,
    setClientId: changeClient,
    busy,
    error: error ?? status?.error,
    canStart:
      enabled &&
      !!status &&
      !busy &&
      !["starting", "pending", "verifying"].includes(status.phase) &&
      /^[a-zA-Z0-9_-]{1,256}$/.test(clientId.trim()),
    start: () => run("start"),
    refresh: () => run("refresh"),
    open: () => run("open", flow),
    copy: () => run("copy", flow),
    cancel: () => run("cancel", flow),
  };
}
