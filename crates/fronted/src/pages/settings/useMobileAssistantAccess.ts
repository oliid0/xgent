import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkMobileAssistantPermissions,
  type MobileAssistantPermission,
  type MobileAssistantStatus,
  type MobilePermissionStates,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  openMobileSystemSettings,
  requestMobileAssistantPermission,
} from "../../lib/mobileAssistant";

type Lifetime = { active: boolean; busy: boolean; refreshPending: boolean; abort: AbortController };

/** Both mobile settings pages observe the same native permission service. */
export function useMobileAssistantAccess(unavailable: string) {
  const [status, setStatus] = useState<MobileAssistantStatus>();
  const [permissions, setPermissions] = useState<MobilePermissionStates>({});
  const [busy, setBusy] = useState<MobileAssistantPermission | "refresh" | "">("");
  const [error, setError] = useState("");
  const lifetime = useRef<Lifetime | null>(null);
  const latest = useRef({ status, permissions, unavailable });
  latest.current = { status, permissions, unavailable };

  const refresh = useCallback(async () => {
    const owner = lifetime.current;
    if (!owner?.active) return;
    if (owner.busy) {
      owner.refreshPending = true;
      return;
    }
    owner.busy = true;
    setBusy("refresh");
    setError("");
    try {
      const nextStatus = await mobileAssistantStatus();
      if (!owner.active) return;
      setStatus(nextStatus);
      const nextPermissions = await checkMobileAssistantPermissions();
      if (!owner.active) return;
      setPermissions(normalizeMobileAssistantPermissions(nextStatus, nextPermissions));
    } catch (cause) {
      if (owner.active) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      owner.busy = false;
      if (owner.active) {
        setBusy("");
        if (owner.refreshPending) {
          owner.refreshPending = false;
          void refresh();
        }
      }
    }
  }, []);

  useEffect(() => {
    const owner: Lifetime = {
      active: true,
      busy: false,
      refreshPending: false,
      abort: new AbortController(),
    };
    lifetime.current = owner;
    void refresh();
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      owner.active = false;
      owner.abort.abort();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);

  const request = useCallback(
    async (permission: MobileAssistantPermission) => {
      const owner = lifetime.current;
      const current = latest.current;
      if (!owner?.active || owner.busy || current.permissions[permission] === "granted") return;
      owner.busy = true;
      setBusy(permission);
      setError("");
      try {
        const alias = current.status?.permissionAliases[permission];
        if (!current.status || alias === undefined) throw new Error(current.unavailable);
        if (
          current.permissions[permission] === "denied" ||
          current.permissions[permission] === "requested"
        ) {
          await openMobileSystemSettings();
        } else {
          const next = await requestMobileAssistantPermission(alias, owner.abort.signal);
          if (owner.active)
            setPermissions(normalizeMobileAssistantPermissions(current.status, next));
        }
      } catch (cause) {
        if (owner.active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        owner.busy = false;
        if (owner.active) {
          setBusy("");
          if (owner.refreshPending) {
            owner.refreshPending = false;
            void refresh();
          }
        }
      }
    },
    [refresh],
  );

  return { status, permissions, busy, error, refresh, request };
}
