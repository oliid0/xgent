import { useEffect, useRef, useState } from "react";
import {
  checkMobileAssistantPermissions,
  listMobileContacts,
  type MobileContactList,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  requestMobileAssistantPermission,
} from "../mobileAssistant";

/** Explicit user search; records are neither cached in settings nor sent to a model. */
export function useMobileContacts(enabled: boolean) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<MobileContactList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lifetime = useRef<{ active: boolean; busy: boolean; abort: AbortController } | null>(null);
  if (!enabled && lifetime.current) lifetime.current.active = false;
  useEffect(() => {
    const owner = { active: enabled, busy: false, abort: new AbortController() };
    lifetime.current = owner;
    setData(null);
    setBusy(false);
    setError("");
    return () => {
      owner.active = false;
      owner.abort.abort();
    };
  }, [enabled]);
  async function search() {
    const owner = lifetime.current;
    if (!enabled || !owner?.active || owner.busy) return;
    const input = query.trim();
    owner.busy = true;
    setBusy(true);
    setError("");
    setData(null);
    try {
      if (new TextEncoder().encode(input).length > 1024)
        throw new Error("Contact query exceeds 1024 bytes");
      const status = await mobileAssistantStatus();
      if (!owner.active) return;
      const alias = status.permissionAliases.contacts;
      if (!status.available || !alias)
        throw new Error("The device did not provide a contacts adapter");
      let permissions = normalizeMobileAssistantPermissions(
        status,
        await checkMobileAssistantPermissions(),
      );
      if (!owner.active) return;
      if (permissions.contacts === "denied")
        throw new Error(
          "Contacts access was denied. Enable it in system settings before searching.",
        );
      if (permissions.contacts !== "granted") {
        permissions = normalizeMobileAssistantPermissions(
          status,
          await requestMobileAssistantPermission(alias, owner.abort.signal),
        );
        if (!owner.active) return;
      }
      if (permissions.contacts !== "granted")
        throw new Error("Contacts permission was not granted");
      const result = await listMobileContacts(input, 25);
      if (!owner.active) return;
      if (
        !result ||
        !Array.isArray(result.contacts) ||
        result.contacts.length > 25 ||
        typeof result.truncated !== "boolean" ||
        typeof result.accessLimited !== "boolean" ||
        result.contacts.some(
          (contact) =>
            !contact ||
            typeof contact.id !== "string" ||
            typeof contact.name !== "string" ||
            !Array.isArray(contact.phones) ||
            !Array.isArray(contact.emails) ||
            [...contact.phones, ...contact.emails].some((value) => typeof value !== "string"),
        )
      )
        throw new Error("The device returned an invalid contacts result");
      setData(result);
    } catch (cause) {
      if (owner.active) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      owner.busy = false;
      if (owner.active) setBusy(false);
    }
  }
  return { query, setQuery, data, busy, error, search };
}
