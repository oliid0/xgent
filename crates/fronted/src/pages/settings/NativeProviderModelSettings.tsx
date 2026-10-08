import { useEffect, useRef, useState } from "react";
import { useConfirmDialog } from "../../components/astryx/useConfirmDialog";
import { useLocale } from "../../i18n";
import {
  MODEL_INPUT_OPTIONS,
  type ModelInputMode,
  modelInputMode,
  supportsModelInputOverride,
  withModelInputMode,
} from "../../lib/models/modelInput";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import type { PromptCacheHintMode } from "../../lib/settings";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { compactExtensionPreview } from "../../presentation/nativeExtensionPreview";
import { withNativeSettingsIcons } from "../../presentation/nativeSettingsIcons";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { PROVIDER_CACHE_HINT_OPTIONS } from "./providerCacheSettings";
import {
  applyModelEdit,
  createModelEditDraft,
  editedProviderModel,
  type ModelEditDraft,
  removeProviderModel,
} from "./providerModelSettings";
import type { SettingsSectionProps } from "./types";

export function NativeProviderModelSettings(
  props: SettingsSectionProps & { providerId: string; modelId: string; onBack: () => void },
) {
  const { settings } = props,
    { t } = useLocale();
  const provider = settings.customProviders.find((item) => item.id === props.providerId);
  const model = provider?.models.find((item) => item.id === props.modelId);
  const [draft, setDraftState] = useState<ModelEditDraft | null>(() =>
    model ? createModelEditDraft(model) : null,
  );
  const draftRef = useRef(draft);
  const [failure, setFailure] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const alive = useRef(true),
    deleteLock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const { confirm, dialog } = useConfirmDialog();
  if (failure) throw failure;
  const c = presentationControls(),
    prefix = `model-settings:${props.providerId}:${props.modelId}`;
  const back = () => {
    if (!alive.current) return;
    alive.current = false;
    props.onBack();
  };
  const patch = (field: Exclude<keyof ModelEditDraft, "model">, value: string) => {
    if (!alive.current || !draftRef.current || deleteLock.current) return;
    draftRef.current = { ...draftRef.current, [field]: value };
    setDraftState(draftRef.current);
  };
  const nodes: PresentationNode[] = [c.action(`${prefix}:back`, t("settings.native.back"), back)];
  if (!model || !draft) {
    nodes.push({
      id: `${prefix}:missing`,
      kind: "Banner",
      status: "error",
      label: t("settings.modelUnavailable"),
    });
  } else {
    const valid = editedProviderModel(draft) !== null;
    const fields: [Exclude<keyof ModelEditDraft, "model">, string][] = [
      ["contextWindow", "settings.contextWindow"],
      ["maxOutputToken", "settings.maxOutputToken"],
      ["costInput", "settings.modelCostInput"],
      ["costOutput", "settings.modelCostOutput"],
      ["costCacheRead", "settings.modelCostCacheRead"],
      ["costCacheWrite", "settings.modelCostCacheWrite"],
    ];
    nodes.push(
      c.group(`${prefix}:fields`, `${t("settings.modelSettings")} · ${model.id}`, [
        ...(provider && supportsModelInputOverride(provider.type)
          ? [
              c.select(
                `${prefix}:inputMode`,
                t("settings.modelInput"),
                modelInputMode(draft.model),
                MODEL_INPUT_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                })),
                (value) => {
                  if (!alive.current || !draftRef.current || deleteLock.current) return;
                  draftRef.current = {
                    ...draftRef.current,
                    model: withModelInputMode(draftRef.current.model, value as ModelInputMode),
                  };
                  setDraftState(draftRef.current);
                },
                !deleting,
              ),
            ]
          : []),
        ...(provider?.type === "codex"
          ? [
              c.select(
                `${prefix}:cacheHint`,
                t("settings.promptCacheHintModelOverride"),
                draft.model.promptCacheHintMode ?? "inherit",
                [
                  { value: "inherit", label: t("settings.promptCacheHintMode.inherit") },
                  ...PROVIDER_CACHE_HINT_OPTIONS.map((option) => ({
                    value: option.value,
                    label: t(option.labelKey),
                  })),
                ],
                (value) => {
                  if (!alive.current || !draftRef.current || deleteLock.current) return;
                  draftRef.current = {
                    ...draftRef.current,
                    model: {
                      ...draftRef.current.model,
                      promptCacheHintMode:
                        value === "inherit" ? undefined : (value as PromptCacheHintMode),
                    },
                  };
                  setDraftState(draftRef.current);
                },
                !deleting,
              ),
            ]
          : []),
        ...fields.flatMap(([field, label]) => [
          ...(field === "costInput"
            ? [{ id: `${prefix}:cost-title`, kind: "Text" as const, text: t("settings.modelCost") }]
            : []),
          {
            ...c.input(
              `${prefix}:${field}`,
              t(label),
              draft[field],
              (value) => patch(field, value),
              false,
              !deleting,
            ),
            variant:
              field === "contextWindow" || field === "maxOutputToken"
                ? "integer-input"
                : "decimal-input",
          },
        ]),
        {
          id: `${prefix}:cost-hint`,
          kind: "Text",
          secondary: true,
          text: t("settings.modelCostHint"),
        },
        ...(!valid
          ? [
              {
                id: `${prefix}:invalid`,
                kind: "Banner" as const,
                status: "error" as const,
                label: t("settings.modelParametersInvalid"),
              },
            ]
          : []),
        c.action(
          `${prefix}:save`,
          t("settings.save"),
          () => {
            if (!alive.current || deleteLock.current) return;
            const current = draftRef.current;
            if (!current || !editedProviderModel(current))
              throw new Error(t("settings.modelParametersInvalid"));
            props.setSettings((previous) => applyModelEdit(previous, props.providerId, current));
            back();
          },
          valid && !deleting,
        ),
      ]),
    );
    nodes.push({
      ...c.action(
        `${prefix}:delete`,
        t("settings.delete"),
        async () => {
          if (!alive.current || deleteLock.current) return;
          deleteLock.current = true;
          setDeleting(true);
          try {
            const approved = await confirm({
              title: t("settings.delete"),
              description: model.id,
              confirmLabel: t("settings.delete"),
              cancelLabel: t("settings.cancel"),
              tone: "destructive",
            });
            if (!approved || !alive.current) return;
            props.setSettings((previous) =>
              removeProviderModel(previous, props.providerId, props.modelId),
            );
            back();
          } finally {
            deleteLock.current = false;
            if (alive.current) setDeleting(false);
          }
        },
        !deleting,
      ),
      destructive: true,
    });
  }
  const compact = isNativeMobileRuntime();
  const group = nodes.find((node) => node.kind === "SettingsGroup");
  const save = group?.children?.find((node) => node.id === `${prefix}:save`);
  const deleteAction = nodes.find((node) => node.id === `${prefix}:delete`);
  const preview = compactExtensionPreview(
    {
      id: `${prefix}:dialog`,
      kind: "VStack",
      variant: "provider-model-settings",
      children: [
        {
          ...nodes[0],
          kind: "IconButton",
          label: t("settings.close"),
          icon: "xmark",
          variant: "ghost",
        },
        { id: `${prefix}:title`, kind: "Heading", text: model?.id ?? props.modelId },
        ...nodes
          .slice(1)
          .filter((node) => node !== deleteAction)
          .map((node) =>
            node === group
              ? {
                  ...node,
                  label: t("settings.modelSettings"),
                  children: node.children?.filter((child) => child !== save),
                }
              : node,
          ),
        ...(deleteAction ? [deleteAction] : []),
        c.action(`${prefix}:cancel`, t("settings.cancel"), back, !deleting),
        ...(save ? [save] : []),
      ],
    },
    {
      detailsLabel: "",
      metadata: () => false,
      footer: (node) => [deleteAction?.id, `${prefix}:cancel`, save?.id].includes(node.id),
    },
  );
  return (
    <>
      <NativeSurface
        sessionSurface={props.nativeSettingsSurfaceId}
        document={{
          mode: "sheet",
          title: t("settings.modelSettings"),
          appearance: settings.theme,
          formFactor: compact ? "mobile" : "desktop",
          theme: createNativePresentationTheme(settings, compact),
          dismissAction: `${prefix}:back`,
          nodes: [compact ? withNativeSettingsIcons(preview) : preview],
        }}
        handlers={c.handlers}
        onError={setFailure}
      />
      {dialog}
    </>
  );
}
