import { useEffect, useRef, useState } from "react";
import { useConfirmDialog } from "../../components/astryx/useConfirmDialog";
import { useLocale } from "../../i18n";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
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
        ...fields.flatMap(([field, label]) => [
          ...(field === "costInput"
            ? [{ id: `${prefix}:cost-title`, kind: "Text" as const, text: t("settings.modelCost") }]
            : []),
          c.input(
            `${prefix}:${field}`,
            t(label),
            draft[field],
            (value) => patch(field, value),
            false,
            !deleting,
          ),
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
          nodes,
        }}
        handlers={c.handlers}
        onError={setFailure}
      />
      {dialog}
    </>
  );
}
