import { useEffect, useState } from "react";
import type { TailscaleStatus } from "./localAccess";
import { type TailscaleAuthMode, tailscaleAuthInput, tailscaleSetup } from "./tailscaleSetup";

export function useTailscaleSetup(enabled: boolean, mobile: boolean) {
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [mode, setMode] = useState<TailscaleAuthMode>("auth-key");
  const [credential, setCredential] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [operation] = useState(() => ({ active: enabled, generation: 0, serial: 0, busy: "" }));
  operation.active = enabled;
  const renderedGeneration = operation.generation;
  const canConnect = status?.engine === "embedded-rust" && status.canAuthenticate === true;
  const canLogout = status?.engine === "embedded-rust" && status.canLogout === true;

  async function perform(
    action: "refresh" | "connect" | "logout",
    generation = operation.generation,
  ) {
    if (
      !operation.active ||
      operation.busy ||
      generation !== operation.generation ||
      (action === "connect" && !canConnect) ||
      (action === "logout" && !canLogout)
    )
      return false;
    const serial = ++operation.serial;
    const current = () =>
      operation.active && operation.generation === generation && operation.serial === serial;
    operation.busy = action;
    setBusy(action);
    setError(null);
    try {
      if (action === "connect") {
        const value = credential;
        setCredential("");
        const input = tailscaleAuthInput(mode, value, tags);
        const next = await tailscaleSetup.authenticate(input);
        if (current()) setStatus(next);
      } else {
        const next = await (action === "logout"
          ? tailscaleSetup.logout()
          : tailscaleSetup.status());
        if (current()) setStatus(next);
      }
      return current();
    } catch (cause) {
      if (current()) setError(cause);
      if (action !== "refresh") {
        try {
          const observed = await tailscaleSetup.status();
          if (current()) setStatus(observed);
        } catch {
          /* Keep the original native error and last actual observation. */
        }
      }
      return false;
    } finally {
      if (current()) {
        operation.busy = "";
        setBusy("");
      }
    }
  }

  useEffect(() => {
    operation.active = enabled;
    operation.generation++;
    operation.busy = "";
    setBusy("");
    setError(null);
    setStatus(null);
    setCredential("");
    if (enabled) void perform("refresh");
    return () => {
      operation.active = false;
      operation.generation++;
      operation.serial++;
    };
  }, [enabled, mobile, operation]);

  useEffect(() => {
    if (!enabled || !mobile || typeof window === "undefined" || typeof document === "undefined")
      return;
    const generation = operation.generation;
    const refresh = () => {
      if (document.visibilityState !== "hidden") void perform("refresh", generation);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, mobile, operation]);

  useEffect(() => {
    if (!enabled || status?.engine !== "embedded-rust") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const generation = operation.generation;
    const poll = async () => {
      if (!active || generation !== operation.generation) return;
      await perform("refresh", generation);
      if (active) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled, mobile, status?.engine, operation]);

  return {
    canConnect,
    canLogout,
    status,
    mode,
    setMode,
    credential,
    setCredential,
    tags,
    setTags,
    busy,
    error,
    refresh: () => perform("refresh", renderedGeneration),
    connect: () => perform("connect", renderedGeneration),
    logout: () => perform("logout", renderedGeneration),
  };
}
