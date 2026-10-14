import { invoke, invokeNative } from "@xgent/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { LAN_PC_SESSION_CHANGED_EVENT } from "../../runtime/lanPcCommandHost";
import type { XgentRuntime } from "../../runtime/types";
import { isNativeMobileRuntime } from "../runtimePlatform";
import { captureToolCommandPort } from "../tools/toolCommandPort";
import type { ProactiveOperation, ProactiveSnapshot } from "./proactive";
import { validateProactiveConfig } from "./proactive";

export function useProactiveRules() {
  const [snapshot, setSnapshot] = useState<ProactiveSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerChanged, setOwnerChanged] = useState(false);
  const port = useRef<Pick<XgentRuntime, "invoke"> | null>(null);
  const current = useRef<ProactiveSnapshot | null>(null);
  const mounted = useRef(true),
    running = useRef<number | null>(null),
    generation = useRef(0),
    serial = useRef(0);

  const perform = useCallback(async (operation?: ProactiveOperation) => {
    if (running.current !== null) return false;
    const request = ++serial.current;
    running.current = request;
    const version = generation.current;
    setBusy(true);
    setError(null);
    try {
      let result: ProactiveSnapshot;
      if (operation) {
        if (!port.current || !current.current) throw new Error("proactive.refreshRequired");
        if (operation.op === "create") validateProactiveConfig(operation.config);
        result = await port.current.invoke<ProactiveSnapshot>("automation_proactive_apply", {
          input: { revision: current.current.revision, operation },
        });
        if (result.hostId !== current.current?.hostId) throw new Error("proactive.ownerChanged");
      } else {
        // The phone owns its Health observer, rule ledger and OS permissions.
        // A selected PC supplies an explicit executor, not a replacement owner.
        const captured = isNativeMobileRuntime()
          ? { invoke: invokeNative }
          : ((await captureToolCommandPort()) ?? { invoke });
        result = await captured.invoke<ProactiveSnapshot>("automation_proactive_snapshot");
        if (!mounted.current || version !== generation.current) return false;
        port.current = captured;
        setOwnerChanged(false);
      }
      if (!mounted.current || version !== generation.current) return false;
      current.current = result;
      setSnapshot(result);
      return true;
    } catch (failure) {
      if (mounted.current && version === generation.current)
        setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      if (running.current === request) {
        running.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const changed = () => {
      generation.current++;
      port.current = null;
      current.current = null;
      setSnapshot(null);
      setOwnerChanged(true);
      setError("proactive.ownerChanged");
    };
    window.addEventListener(LAN_PC_SESSION_CHANGED_EVENT, changed);
    void perform();
    return () => {
      mounted.current = false;
      generation.current++;
      running.current = null;
      window.removeEventListener(LAN_PC_SESSION_CHANGED_EVENT, changed);
    };
  }, [perform]);

  return {
    snapshot,
    busy,
    error,
    ownerChanged,
    refresh: () => perform(),
    apply: (operation: ProactiveOperation) => perform(operation),
  };
}
