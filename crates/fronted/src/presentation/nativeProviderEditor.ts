import { useEffect, useState } from "react";
import {
  isReservedCustomHeaderKey,
  isValidCustomHeaderKey,
  isValidCustomHeaderValue,
} from "../lib/providers/customHeaders";
import {
  type CustomProvider,
  normalizeCustomProvider,
  type ProviderId,
  updateCustomProviders,
} from "../lib/settings";
import { createUuid } from "../lib/shared/id";
import { buildProviderModelsFetchKey } from "../pages/settings/providerUtils";
import type { SettingsSectionProps } from "../pages/settings/types";

function configuration(provider: CustomProvider | undefined) {
  return provider
    ? JSON.stringify([
        provider.type,
        buildProviderModelsFetchKey(
          provider.baseUrl,
          provider.apiKey,
          provider.useSystemProxy,
          provider.authMode,
          provider.customHeaders,
          provider.oauthAccountId,
          provider.isFullUrl,
          provider.modelsUrl,
        ),
      ])
    : "";
}

/** One unsaved provider shared by its native general, model and request pages. */
export function useNativeProviderEditor(
  { settings, setSettings }: SettingsSectionProps,
  providerId: string,
  enabled: boolean,
  t: (key: string) => string,
) {
  const active = enabled && !!providerId;
  const [scope] = useState(() => ({
    mounted: true,
    active: false,
    id: "",
    revision: 0,
    draft: undefined as CustomProvider | undefined,
    isNew: false,
    deleteRevision: 0,
    deletePending: false,
    error: "",
  }));
  const [, publish] = useState(0);
  if (scope.id !== providerId || scope.active !== active) {
    scope.id = providerId;
    scope.active = active;
    scope.revision++;
    const saved = active
      ? settings.customProviders.find((item) => item.id === providerId)
      : undefined;
    scope.draft = saved ? structuredClone(saved) : undefined;
    scope.isNew = false;
    scope.deleteRevision++;
    scope.deletePending = false;
    scope.error = "";
  }
  useEffect(() => {
    scope.mounted = true;
    publish((value) => value + 1);
    return () => {
      scope.mounted = false;
      scope.revision++;
    };
  }, [scope]);
  const revision = scope.revision;
  const deleteRevision = scope.deleteRevision;
  const current = () =>
    scope.mounted && scope.active && scope.revision === revision && !!scope.draft;
  const draft = scope.draft;
  const requestConfiguration = configuration(draft);
  const viewSettings = (item: CustomProvider) => ({
    ...settings,
    customProviders: scope.isNew
      ? [...settings.customProviders, item]
      : settings.customProviders.map((saved) => (saved.id === item.id ? item : saved)),
  });
  const cancel = () => {
    if (!current()) return false;
    scope.revision++;
    scope.active = false;
    scope.id = "";
    scope.draft = undefined;
    scope.deletePending = false;
    scope.deleteRevision++;
    scope.error = "";
    publish((value) => value + 1);
    return true;
  };
  return {
    provider: draft,
    isNew: scope.isNew,
    revision,
    deleteRevision,
    deletePending: scope.deletePending,
    error: scope.error,
    settings: draft ? viewSettings(draft) : settings,
    setSettings: ((update) => {
      if (!current() || configuration(scope.draft) !== requestConfiguration || !scope.draft) return;
      const next = update(viewSettings(scope.draft)).customProviders.find(
        (item) => item.id === scope.id,
      );
      if (!next) return;
      // Model/request reducers normalize providers. A deliberately empty name
      // must remain invalid rather than turning into a normalized placeholder.
      scope.draft = { ...next, name: scope.draft.name };
      scope.error = "";
      publish((value) => value + 1);
    }) satisfies SettingsSectionProps["setSettings"],
    patch(patch: Partial<CustomProvider>) {
      if (!current() || !scope.draft) return;
      scope.draft = {
        ...normalizeCustomProvider({ ...scope.draft, ...patch }),
        name: patch.name ?? scope.draft.name,
      };
      scope.error = "";
      publish((value) => value + 1);
    },
    add(type: ProviderId) {
      if (!scope.mounted || scope.active || scope.revision !== revision) return "";
      const id = createUuid();
      scope.revision++;
      scope.id = id;
      scope.active = true;
      scope.isNew = true;
      scope.error = "";
      scope.draft = { ...normalizeCustomProvider({ id, type }), name: "" };
      publish((value) => value + 1);
      return id;
    },
    cancel,
    requestRemove() {
      if (!current() || scope.isNew || scope.deletePending) return false;
      scope.deleteRevision++;
      scope.deletePending = true;
      publish((value) => value + 1);
      return true;
    },
    cancelRemove() {
      if (!current() || !scope.deletePending || scope.deleteRevision !== deleteRevision)
        return false;
      scope.deletePending = false;
      scope.deleteRevision++;
      publish((value) => value + 1);
      return true;
    },
    remove() {
      if (
        !current() ||
        scope.isNew ||
        !scope.draft ||
        !scope.deletePending ||
        scope.deleteRevision !== deleteRevision
      )
        return false;
      const id = scope.draft.id;
      setSettings((previous) =>
        updateCustomProviders(
          previous,
          previous.customProviders.filter((item) => item.id !== id),
        ),
      );
      return cancel();
    },
    save() {
      if (!current() || !scope.draft) return false;
      const item = structuredClone(scope.draft);
      let issue = !item.name.trim() ? t("settings.providerNameRequired") : "";
      if (!issue && item.authMode === "oauth-managed" && !item.oauthAccountId?.trim())
        issue = t("settings.providerOAuthManagedHintCodex");
      for (const header of item.customHeaders ?? []) {
        if (issue) break;
        if (!header.key.trim() || !isValidCustomHeaderKey(header.key.trim()))
          issue = t("settings.invalidCustomHeaderKey");
        else if (isReservedCustomHeaderKey(header.key.trim()))
          issue = t("settings.customHeaderReservedTitle");
        else if (!isValidCustomHeaderValue(header.value))
          issue = t("settings.invalidCustomHeaderValue");
      }
      if (!issue && !scope.isNew && !settings.customProviders.some((saved) => saved.id === item.id))
        issue = t("settings.providerNoLongerAvailable");
      if (issue) {
        scope.error = issue;
        publish((value) => value + 1);
        return false;
      }
      const isNew = scope.isNew;
      try {
        setSettings((previous) => {
          const exists = previous.customProviders.some((saved) => saved.id === item.id);
          if (isNew === exists) return previous;
          return updateCustomProviders(
            previous,
            isNew
              ? [...previous.customProviders, item]
              : previous.customProviders.map((saved) => (saved.id === item.id ? item : saved)),
          );
        });
      } catch (cause) {
        scope.error = cause instanceof Error ? cause.message : String(cause);
        publish((value) => value + 1);
        return false;
      }
      cancel();
      return true;
    },
  };
}
