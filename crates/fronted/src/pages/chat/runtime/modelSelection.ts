import type { AppSettings, ProviderId, SelectedModel } from "../../../lib/settings";

export type EffectiveChatModelSelection = {
  selectedModel: SelectedModel;
  provider: AppSettings["customProviders"][number];
  providerId: ProviderId;
  model: string;
};

export function resolveActiveModelSelection(
  settings: AppSettings,
  conversationSelectedModel: SelectedModel | undefined,
): SelectedModel | undefined {
  return conversationSelectedModel ?? settings.selectedModel;
}

export function resolvePersistedConversationModelSelection(params: {
  runtimeSelectedModel?: SelectedModel;
  turnSelectedModel?: SelectedModel;
}): SelectedModel | undefined {
  return params.runtimeSelectedModel ?? params.turnSelectedModel;
}

export function resolveEffectiveChatModelSelection(params: {
  settings: AppSettings;
  conversationSelectedModel?: SelectedModel;
}): EffectiveChatModelSelection {
  const activeSelectedModel = resolveActiveModelSelection(
    params.settings,
    params.conversationSelectedModel,
  );
  if (!activeSelectedModel) {
    throw new Error("请先选择一个模型，或先在设置中添加模型。");
  }

  const { customProviderId, model } = activeSelectedModel;
  const provider = params.settings.customProviders.find((item) => item.id === customProviderId);
  if (!provider) {
    throw new Error("所选供应商不存在，请重新选择模型。");
  }
  if (!provider.activeModels.includes(model)) {
    throw new Error("所选模型尚未启用，请重新选择模型。");
  }

  return {
    selectedModel: activeSelectedModel,
    provider,
    providerId: provider.type,
    model,
  };
}
