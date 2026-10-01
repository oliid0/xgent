import { useEffect, useRef, useState } from "react";
import { useConfirmDialog } from "../../components/astryx/useConfirmDialog";
import { useLocale } from "../../i18n";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { type ProviderId, RETRYABLE_PRESET_HTTP_STATUS_CODES } from "../../lib/settings";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { providerRuntimeActions, runtimeModelOptions } from "./providerRuntimeSettings";
import type { SettingsSectionProps } from "./types";

const vendors: { value: ProviderId; label: string }[] = [
  { value: "claude_code", label: "Anthropic" },
  { value: "codex", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "xai", label: "Grok" },
  { value: "deepseek", label: "DeepSeek" },
];

export function NativeProviderRuntimeSettings(
  props: SettingsSectionProps & { providerType: ProviderId; onBack: () => void },
) {
  const { settings } = props,
    { t } = useLocale();
  const [providerType, setProviderType] = useState<ProviderId>(props.providerType);
  const [draft, setDraftState] = useState("");
  const draftRef = useRef(draft);
  const setDraft = (value: string) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const [failure, setFailure] = useState<unknown>(null);
  const [resetting, setResetting] = useState(false);
  const resetLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const { confirm, dialog } = useConfirmDialog();
  if (failure) throw failure;
  const actions = providerRuntimeActions(props.setSettings),
    c = presentationControls();
  const title = runtimeModelOptions(settings, "conversationTitleModel");
  const commit = runtimeModelOptions(settings, "commitMessageModel");
  const config = settings.modelFailover[providerType];
  const providers = settings.customProviders.filter((provider) => provider.type === providerType);
  const queue = config.queue
    .map((id) => providers.find((provider) => provider.id === id))
    .filter((provider) => provider !== undefined);
  const reset = async () => {
    if (!alive.current || resetLock.current) return;
    resetLock.current = true;
    setResetting(true);
    try {
      const approved = await confirm({
        title: t("settings.providerRuntimeResetTitle"),
        description: t("settings.providerRuntimeResetDescription"),
        confirmLabel: t("settings.providerRuntimeResetConfirm"),
        cancelLabel: t("settings.cancel"),
        tone: "warning",
      });
      if (approved && alive.current) actions.resetRuntimeConfiguration();
    } finally {
      resetLock.current = false;
      if (alive.current) setResetting(false);
    }
  };
  const selectOptions = (options: typeof title.options) => [
    { value: "", label: t("settings.conversationTitleModelFollowCurrent") },
    ...options.map((option) => ({
      value: option.value,
      label: `${option.providerName} · ${option.label}`,
    })),
  ];
  const nodes: PresentationNode[] = [
    c.action("runtime-back", t("settings.closeCustomSettings"), () => {
      alive.current = false;
      props.onBack();
    }),
    c.group("runtime-models", t("settings.customSettings"), [
      c.select(
        "runtime-title-model",
        t("settings.conversationTitleModel"),
        title.value,
        selectOptions(title.options),
        (value) => actions.setModel("conversationTitleModel", value),
        !resetting,
      ),
      {
        id: "runtime-title-hint",
        kind: "Text",
        text: t("settings.conversationTitleModelHint"),
        secondary: true,
      },
      c.select(
        "runtime-commit-model",
        t("settings.commitMessageModel"),
        commit.value,
        selectOptions(commit.options),
        (value) => actions.setModel("commitMessageModel", value),
        !resetting,
      ),
      ...(!title.available.length
        ? [
            {
              id: "runtime-models-empty",
              kind: "Banner" as const,
              label: t("settings.customSettingsModelEmpty"),
              status: "paused" as const,
            },
          ]
        : []),
    ]),
    c.group("runtime-failover", t("settings.failover.title"), [
      {
        id: "runtime-failover-hint",
        kind: "Text",
        text: t("settings.failover.desc"),
        secondary: true,
      },
      c.select(
        "runtime-vendor",
        t("settings.native.api"),
        providerType,
        vendors,
        (value) => setProviderType(value as ProviderId),
        !resetting,
      ),
      c.toggle(
        `runtime-failover-enabled:${providerType}`,
        t("settings.failover.enabled"),
        config.enabled,
        (enabled) => actions.updateProvider(providerType, { enabled }),
        !resetting,
      ),
      c.number(
        `runtime-switches:${providerType}`,
        t("settings.failover.maxSwitches"),
        config.maxSwitches,
        1,
        10,
        1,
        (maxSwitches) => actions.updateProvider(providerType, { maxSwitches }),
        !resetting,
        Math.trunc,
      ),
      c.number(
        `runtime-threshold:${providerType}`,
        t("settings.failover.failureThreshold"),
        config.failureThreshold,
        1,
        10,
        1,
        (failureThreshold) => actions.updateProvider(providerType, { failureThreshold }),
        !resetting,
        Math.trunc,
      ),
      c.number(
        `runtime-cooldown:${providerType}`,
        t("settings.failover.cooldown"),
        config.cooldownSeconds,
        5,
        3600,
        1,
        (cooldownSeconds) => actions.updateProvider(providerType, { cooldownSeconds }),
        !resetting,
        Math.trunc,
      ),
    ]),
    c.group(
      "runtime-failover-queue",
      t("settings.failover.queue"),
      providers.length < 2
        ? [
            {
              id: "runtime-queue-empty",
              kind: "Banner",
              label: t("settings.failover.needProviders"),
              status: "paused",
            },
          ]
        : [
            ...queue.map(
              (provider, index): PresentationNode => ({
                id: `runtime-queue:${provider.id}`,
                kind: "VStack",
                children: [
                  {
                    id: `runtime-queue-label:${provider.id}`,
                    kind: "Text",
                    text: `${index + 1}. ${provider.name}`,
                  },
                  {
                    id: `runtime-queue-actions:${provider.id}`,
                    kind: "HStack",
                    children: [
                      c.action(
                        `runtime-up:${provider.id}`,
                        t("settings.failover.moveUp"),
                        () => actions.moveQueueProvider(providerType, provider.id, -1),
                        !resetting && index > 0,
                      ),
                      c.action(
                        `runtime-down:${provider.id}`,
                        t("settings.failover.moveDown"),
                        () => actions.moveQueueProvider(providerType, provider.id, 1),
                        !resetting && index < queue.length - 1,
                      ),
                      c.action(
                        `runtime-remove:${provider.id}`,
                        t("settings.failover.remove"),
                        () => actions.toggleQueueProvider(providerType, provider.id),
                        !resetting,
                      ),
                    ],
                  },
                ],
              }),
            ),
            ...providers
              .filter((provider) => !config.queue.includes(provider.id))
              .map((provider) =>
                c.action(
                  `runtime-add:${provider.id}`,
                  `+ ${provider.name}`,
                  () => actions.toggleQueueProvider(providerType, provider.id),
                  !resetting,
                ),
              ),
          ],
    ),
    c.group("runtime-retry-codes", t("settings.retryErrorPresets"), [
      {
        id: "runtime-retry-hint",
        kind: "Text",
        text: t("settings.retryErrorDesc"),
        secondary: true,
      },
      {
        id: "runtime-retry-builtin",
        kind: "Text",
        text: t("settings.retryErrorBuiltinNote"),
        secondary: true,
      },
      ...RETRYABLE_PRESET_HTTP_STATUS_CODES.map((code) =>
        c.toggle(
          `runtime-retry:${code}`,
          `${code} · ${t(`settings.retryError.presetShort.${code}`)}`,
          settings.retryErrorSettings.presetStatusCodes.includes(code),
          (enabled) => actions.togglePresetCode(code, enabled),
          !resetting,
        ),
      ),
    ]),
    c.group("runtime-patterns", t("settings.retryErrorCustomPatterns"), [
      {
        id: "runtime-pattern-hint",
        kind: "Text",
        text: t("settings.retryErrorCustomPatternsDesc"),
        secondary: true,
      },
      c.input(
        "runtime-pattern",
        t("settings.retryErrorCustomPatternPlaceholder"),
        draft,
        setDraft,
        false,
        !resetting,
      ),
      c.action(
        "runtime-pattern-add",
        t("settings.retryErrorAddPattern"),
        () => {
          actions.addPattern(draftRef.current);
          setDraft("");
        },
        !resetting && !!draft.trim(),
      ),
      ...settings.retryErrorSettings.customPatterns.map((pattern, index) =>
        c.action(
          `runtime-pattern-remove:${index}`,
          `${t("settings.retryErrorRemovePattern")} ${pattern}`,
          () => actions.removePattern(pattern),
          !resetting,
        ),
      ),
    ]),
    {
      ...c.action("runtime-reset", t("settings.providerRuntimeReset"), reset, !resetting),
      destructive: true,
    },
  ];
  const compact = isNativeMobileRuntime();
  return (
    <>
      <NativeSurface
        sessionSurface={props.nativeSettingsSurfaceId}
        document={{
          mode: "sheet",
          title: t("settings.customSettings"),
          appearance: settings.theme,
          formFactor: compact ? "mobile" : "desktop",
          theme: createNativePresentationTheme(settings, compact),
          dismissAction: "runtime-back",
          nodes,
        }}
        handlers={c.handlers}
        onError={setFailure}
      />
      {dialog}
    </>
  );
}
