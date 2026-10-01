import { buildModelOptions } from "../../lib/chat/page/chatPageHelpers";
import { parseModelValue, toModelValue } from "../../lib/providers/llm";
import {
  type AppSettings,
  getDefaultUsageQueryConfig,
  type ModelFailoverProviderSettings,
  normalizeModelFailoverSettings,
  normalizeRetryErrorSettings,
  type ProviderId,
  RETRYABLE_PRESET_HTTP_STATUS_CODES,
  updateCustomProviders,
  updateCustomSettings,
} from "../../lib/settings";
import type { SetSettingsFn } from "./types";

/** Shared runtime settings mutations extracted from the existing Astryx forms. */
export function providerRuntimeActions(setSettings: SetSettingsFn) {
  const changeFailover = (
    type: ProviderId,
    change: (settings: AppSettings) => Partial<ModelFailoverProviderSettings> | null,
  ) => {
    setSettings((previous) => {
      const patch = change(previous);
      if (!patch) return previous;
      return {
        ...previous,
        modelFailover: normalizeModelFailoverSettings(
          { ...previous.modelFailover, [type]: { ...previous.modelFailover[type], ...patch } },
          previous.customProviders,
        ),
      };
    });
  };
  return {
    updateProvider: (type: ProviderId, patch: Partial<ModelFailoverProviderSettings>) =>
      changeFailover(type, () => patch),
    toggleQueueProvider: (type: ProviderId, id: string) =>
      changeFailover(type, (previous) => {
        if (
          !previous.customProviders.some((provider) => provider.id === id && provider.type === type)
        )
          return null;
        const queue = previous.modelFailover[type].queue;
        return {
          queue: queue.includes(id) ? queue.filter((value) => value !== id) : [...queue, id],
        };
      }),
    moveQueueProvider: (type: ProviderId, id: string, offset: -1 | 1) =>
      changeFailover(type, (previous) => {
        const queue = [...previous.modelFailover[type].queue],
          index = queue.indexOf(id),
          target = index + offset;
        if (index < 0 || target < 0 || target >= queue.length) return null;
        [queue[index], queue[target]] = [queue[target], queue[index]];
        return { queue };
      }),
    togglePresetCode: (code: number, enabled: boolean) => {
      if (!(RETRYABLE_PRESET_HTTP_STATUS_CODES as readonly number[]).includes(code)) return;
      setSettings((previous) => {
        const current = previous.retryErrorSettings.presetStatusCodes;
        return {
          ...previous,
          retryErrorSettings: normalizeRetryErrorSettings({
            ...previous.retryErrorSettings,
            presetStatusCodes: enabled
              ? [...new Set([...current, code])]
              : current.filter((value) => value !== code),
          }),
        };
      });
    },
    addPattern: (draft: string) => {
      const pattern = draft.trim();
      if (!pattern) return;
      setSettings((previous) => {
        if (
          previous.retryErrorSettings.customPatterns.some(
            (value) => value.toLocaleLowerCase() === pattern.toLocaleLowerCase(),
          )
        )
          return previous;
        return {
          ...previous,
          retryErrorSettings: normalizeRetryErrorSettings({
            ...previous.retryErrorSettings,
            customPatterns: [...previous.retryErrorSettings.customPatterns, pattern],
          }),
        };
      });
    },
    removePattern: (pattern: string) =>
      setSettings((previous) => ({
        ...previous,
        retryErrorSettings: {
          ...previous.retryErrorSettings,
          customPatterns: previous.retryErrorSettings.customPatterns.filter(
            (value) => value !== pattern,
          ),
        },
      })),
    setModel: (key: "conversationTitleModel" | "commitMessageModel", value: string) =>
      setSettings((previous) =>
        updateCustomSettings(previous, {
          [key]: parseModelValue(value) ?? undefined,
        }),
      ),
    resetRuntimeConfiguration: () =>
      setSettings((previous) => ({
        ...previous,
        modelFailover: normalizeModelFailoverSettings({}, previous.customProviders),
        retryErrorSettings: normalizeRetryErrorSettings({}),
        customProviders: updateCustomProviders(
          previous,
          previous.customProviders.map((provider) => ({
            ...provider,
            retryPolicy: undefined,
            usageQuery: getDefaultUsageQueryConfig(),
          })),
        ).customProviders,
      })),
  };
}

/** Keep stored inactive model references visible, as the existing desktop picker does. */
export function runtimeModelOptions(
  settings: AppSettings,
  key: "conversationTitleModel" | "commitMessageModel",
) {
  const available = buildModelOptions(settings),
    selected = settings.customSettings[key];
  const value = selected ? toModelValue(selected.customProviderId, selected.model) : "";
  const options =
    selected && !available.some((option) => option.value === value)
      ? [...available, { value, label: selected.model, providerName: selected.customProviderId }]
      : available;
  return { available, value, options };
}
