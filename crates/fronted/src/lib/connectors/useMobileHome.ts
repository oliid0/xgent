import { useEffect, useRef, useState } from "react";
import { createUuid } from "../shared/id";
import {
  type MobileHomeInventory,
  type MobileHomePowerRequest,
  readAuthorizedMobileHomeInventory,
  setAuthorizedMobileHomePower,
} from "./mobileHome";

/** Explicit device actions. Inventory is transient; effects have native receipts. */
export function useMobileHome(enabled: boolean) {
  const [data, setData] = useState<MobileHomeInventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [powerBusy, setPowerBusy] = useState(false);
  const [powerActionId, setPowerActionId] = useState("");
  const lifetime = useRef<{
    active: boolean;
    busy: boolean;
    abort: AbortController;
    scopes: Map<string, string>;
  } | null>(null);
  if (!enabled && lifetime.current) lifetime.current.active = false;
  useEffect(() => {
    const owner = {
      active: enabled,
      busy: false,
      abort: new AbortController(),
      scopes: new Map<string, string>(),
    };
    lifetime.current = owner;
    setData(null);
    setBusy(false);
    setError("");
    setPowerBusy(false);
    setPowerActionId("");
    return () => {
      owner.active = false;
      owner.abort.abort();
    };
  }, [enabled]);
  async function refresh() {
    const owner = lifetime.current;
    if (!enabled || !owner?.active || owner.busy) return;
    owner.busy = true;
    setBusy(true);
    setData(null);
    setError("");
    try {
      const next = await readAuthorizedMobileHomeInventory({}, owner.abort.signal);
      if (owner.active) setData(next);
    } catch (cause) {
      if (owner.active) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      owner.busy = false;
      if (owner.active) setBusy(false);
    }
  }
  async function setPower(request: MobileHomePowerRequest) {
    const owner = lifetime.current;
    if (!enabled || !owner?.active || owner.busy || !data) return;
    const selected = data.records.find(
      (record) =>
        record.kind === "accessory" &&
        record.id === request.accessoryId &&
        record.homeId === request.homeId,
    );
    if (
      typeof request.power !== "boolean" ||
      selected?.reachable !== true ||
      !selected.powerControls?.some(
        (control) =>
          control.id === request.characteristicId && control.serviceId === request.serviceId,
      )
    )
      return;
    owner.busy = true;
    setBusy(true);
    setPowerBusy(true);
    setPowerActionId(`home-power:${request.characteristicId}:${request.power ? "on" : "off"}`);
    setError("");
    const key = JSON.stringify(request);
    const scope = owner.scopes.get(key) ?? `home-control/${createUuid()}`;
    owner.scopes.set(key, scope);
    try {
      await setAuthorizedMobileHomePower(request, scope, owner.abort.signal);
      owner.scopes.delete(key);
    } catch (cause) {
      if (owner.active) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      owner.busy = false;
      if (owner.active) {
        setBusy(false);
        setPowerBusy(false);
        setPowerActionId("");
      }
    }
  }
  return { data, busy, powerBusy, powerActionId, error, refresh, setPower };
}
