import {
  type AppSettings,
  type ProviderModelConfig,
  updateCustomProviders,
} from "../../lib/settings";

export type ModelEditDraft = {
  model: ProviderModelConfig;
  contextWindow: string;
  maxOutputToken: string;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
};

// These are the provider dialog's existing parsing rules, shared by both renderers.
export function parsePositiveInteger(input: string): number | null {
  const value = Number(input.trim());
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

export function parseCostRate(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatCostRate(value: number | undefined): string {
  return typeof value === "number" && value > 0 ? String(value) : "";
}

export function createModelEditDraft(model: ProviderModelConfig): ModelEditDraft {
  return {
    model,
    contextWindow: String(model.contextWindow),
    maxOutputToken: String(model.maxOutputToken),
    costInput: formatCostRate(model.cost?.input),
    costOutput: formatCostRate(model.cost?.output),
    costCacheRead: formatCostRate(model.cost?.cacheRead),
    costCacheWrite: formatCostRate(model.cost?.cacheWrite),
  };
}

export function editedProviderModel(draft: ModelEditDraft | null): ProviderModelConfig | null {
  if (!draft) return null;
  const contextWindow = parsePositiveInteger(draft.contextWindow);
  const maxOutputToken = parsePositiveInteger(draft.maxOutputToken);
  const input = parseCostRate(draft.costInput),
    output = parseCostRate(draft.costOutput);
  const cacheRead = parseCostRate(draft.costCacheRead),
    cacheWrite = parseCostRate(draft.costCacheWrite);
  if (
    contextWindow === null ||
    maxOutputToken === null ||
    input === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null
  )
    return null;
  return {
    ...draft.model,
    contextWindow,
    maxOutputToken,
    limitsSource: "user",
    cost:
      input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0
        ? { input, output, cacheRead, cacheWrite }
        : undefined,
  };
}

/** Only edited fields replace the current model; discovery metadata stays current. */
export function applyModelEdit(
  settings: AppSettings,
  providerId: string,
  draft: ModelEditDraft,
): AppSettings {
  const edited = editedProviderModel(draft);
  if (
    !edited ||
    !settings.customProviders.some(
      (provider) =>
        provider.id === providerId && provider.models.some((model) => model.id === edited.id),
    )
  )
    return settings;
  return updateCustomProviders(
    settings,
    settings.customProviders.map((provider) =>
      provider.id !== providerId
        ? provider
        : {
            ...provider,
            models: provider.models.map((model) =>
              model.id !== edited.id
                ? model
                : {
                    ...model,
                    contextWindow: edited.contextWindow,
                    maxOutputToken: edited.maxOutputToken,
                    limitsSource: "user",
                    cost: edited.cost,
                  },
            ),
          },
    ),
  );
}

export function removeProviderModel(
  settings: AppSettings,
  providerId: string,
  modelId: string,
): AppSettings {
  return updateCustomProviders(
    settings,
    settings.customProviders.map((provider) =>
      provider.id !== providerId
        ? provider
        : {
            ...provider,
            models: provider.models.filter((model) => model.id !== modelId),
            activeModels: provider.activeModels.filter((id) => id !== modelId),
          },
    ),
  );
}
