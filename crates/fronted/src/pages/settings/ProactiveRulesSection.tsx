import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Section, VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import {
  eligibleProactivePeers,
  eligibleProactiveTargets,
  HEALTH_UPDATE_METRICS,
  type ProactiveRuleConfig,
  parseQuietTime,
  proactiveDeliveryStatus,
  validateProactiveConfig,
} from "../../lib/automation/proactive";
import { useProactiveRules } from "../../lib/automation/useProactiveRules";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { presentationControls } from "../../presentation/controls";
import { NativeSettingsContent } from "../../presentation/NativeSettingsContent";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import type { SettingsSectionProps } from "./types";

export function ProactiveRulesSection(
  props: SettingsSectionProps & { onBack: () => void; nativePresentationMode?: "root" | "sheet" },
) {
  const rules = useProactiveRules();
  return <ProactiveRulesContent {...props} rules={rules} />;
}

export function ProactiveRulesContent(
  props: SettingsSectionProps & {
    onBack: () => void;
    nativePresentationMode?: "root" | "sheet";
    rules: ReturnType<typeof useProactiveRules>;
  },
) {
  const { t } = useLocale();
  const { rules } = props;
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [source, setSource] = useState("");
  const [kind, setKind] = useState<ProactiveRuleConfig["eventKind"]>("run_succeeded");
  const [healthMetric, setHealthMetric] = useState("heart_rate");
  const [homeId, setHomeId] = useState("");
  const [healthReads, setHealthReads] = useState("manual");
  const [executionPeer, setExecutionPeer] = useState("");
  const [executionProvider, setExecutionProvider] = useState("");
  const [executionModel, setExecutionModel] = useState("");
  const [cooldown, setCooldown] = useState("5");
  const [maxAge, setMaxAge] = useState("60");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const snapshot = rules.snapshot;
  const ownerId = snapshot?.hostId;
  const formOwner = useRef(ownerId);
  useEffect(() => {
    if (formOwner.current === ownerId) return;
    formOwner.current = ownerId;
    setName("");
    setTarget("");
    setSource("");
    setKind("run_succeeded");
    setHealthMetric("heart_rate");
    setHomeId("");
    setHealthReads("manual");
    setExecutionPeer("");
    setExecutionProvider("");
    setExecutionModel("");
    setDeleteId(null);
    setFormError(null);
  }, [ownerId]);
  const busy = rules.busy;
  const enabled = !busy && !!snapshot && !rules.ownerChanged;
  const targets = eligibleProactiveTargets(snapshot?.targets ?? []);
  const targetOptions = targets.map((task) => ({ value: task.id, label: task.name }));
  const peers = eligibleProactivePeers(snapshot, kind === "health_updated");
  const selectedPeer = peers.find((peer) => peer.peerId === executionPeer);
  const selectedProvider = selectedPeer?.host.providers.find(
    (provider) => provider.id === executionProvider,
  );
  const executionOptions = [
    { value: "", label: t("proactive.thisDevice") },
    ...peers.map((peer) => ({
      value: peer.peerId,
      label: `${peer.host.platform} · ${peer.peerId.slice(0, 8)}`,
    })),
  ];
  const executionProviderOptions = (selectedPeer?.host.providers ?? [])
    .filter((provider) => provider.models.length > 0)
    .map((provider) => ({ value: provider.id, label: provider.name }));
  const executionModelOptions = (selectedProvider?.models ?? []).map((model) => ({
    value: model,
    label: model,
  }));
  const executionReady =
    !executionPeer ||
    (!!selectedPeer &&
      !!selectedProvider &&
      !!executionModel &&
      selectedProvider.models.includes(executionModel));
  function selectExecutionPeer(value: string) {
    setExecutionPeer(value);
    setHealthReads("manual");
    setExecutionProvider("");
    setExecutionModel("");
  }
  function selectExecutionProvider(value: string) {
    setExecutionProvider(value);
    setHealthReads("manual");
    setExecutionModel("");
  }
  function selectExecutionModel(value: string) {
    setExecutionModel(value);
    setHealthReads("manual");
  }
  function selectHealthMetric(value: string) {
    setHealthMetric(value);
    setHealthReads("manual");
  }
  function selectEventKind(value: string) {
    setKind(value as ProactiveRuleConfig["eventKind"]);
    setHealthReads("manual");
  }
  const sourceOptions = [
    { value: "", label: t("proactive.anyTask") },
    ...(snapshot?.targets ?? [])
      .filter((task) => task.id !== target)
      .map((task) => ({ value: task.id, label: task.name })),
  ];
  const kindOptions = [
    { value: "run_succeeded", label: t("proactive.run_succeeded") },
    { value: "run_failed", label: t("proactive.run_failed") },
    ...((snapshot?.healthEventMetrics?.length ?? 0) > 0
      ? [{ value: "health_updated", label: t("proactive.health_updated") }]
      : []),
    ...((snapshot?.homeEventHomes?.length ?? 0) > 0
      ? [{ value: "home_power_changed", label: t("proactive.home_power_changed") }]
      : []),
  ];
  const healthOptions = HEALTH_UPDATE_METRICS.filter((metric) =>
    snapshot?.healthEventMetrics?.includes(metric),
  ).map((metric) => ({ value: metric, label: t(`proactive.metric.${metric}`) }));
  const homeOptions = (snapshot?.homeEventHomes ?? []).map((home) => ({
    value: home.id,
    label: home.name,
  }));
  const textError = formError ?? rules.error;
  const displayError = textError?.startsWith("proactive.") ? t(textError) : textError;
  const taskName = (id: string) =>
    id.startsWith("health:") && HEALTH_UPDATE_METRICS.some((metric) => `health:${metric}` === id)
      ? t(`proactive.metric.${id.slice(7)}`)
      : id.startsWith("home:")
        ? (snapshot?.homeEventHomes?.find((home) => home.id === id.slice(5))?.name ?? id)
        : (snapshot?.targets.find((task) => task.id === id)?.name ?? id);
  const ruleName = (id: string) =>
    snapshot?.rules.find((rule) => rule.id === id)?.config.name ?? id;
  const describe = (config: ProactiveRuleConfig) =>
    `${t(`proactive.${config.eventKind}`)} · ${config.homeId ? taskName(`home:${config.homeId}`) : config.healthMetric ? t(`proactive.metric.${config.healthMetric}`) : config.sourceTaskId ? taskName(config.sourceTaskId) : t("proactive.anyTask")} → ${taskName(config.targetTaskId)} · ${t("proactive.cooldown")}: ${config.cooldownMinutes} · ${t("proactive.maxAge")}: ${config.maxAgeMinutes}`;
  const formatTime = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  function selectTarget(value: string) {
    setTarget(value);
    if (source === value) setSource("");
  }
  async function create() {
    setFormError(null);
    try {
      if (!executionReady) throw new Error("proactive.invalidExecutor");
      if (
        kind === "health_updated" &&
        !healthOptions.some((option) => option.value === healthMetric)
      )
        throw new Error("proactive.invalidHealthMetric");
      if (kind === "home_power_changed" && !homeOptions.some((option) => option.value === homeId))
        throw new Error("proactive.invalidHome");
      const config: ProactiveRuleConfig = {
        name: name.trim(),
        targetTaskId: target,
        sourceTaskId:
          kind === "health_updated" || kind === "home_power_changed" ? null : source || null,
        eventKind: kind,
        ...(kind === "health_updated" ? { healthMetric } : {}),
        ...(kind === "home_power_changed" ? { homeId } : {}),
        ...(kind === "health_updated" && executionPeer && healthReads === "background"
          ? { backgroundHealthReads: true }
          : {}),
        ...(executionPeer && selectedPeer
          ? {
              remoteExecution: {
                peerId: selectedPeer.peerId,
                providerId: executionProvider,
                model: executionModel,
                workdir: selectedPeer.host.workdir,
              },
            }
          : {}),
        cooldownMinutes: Number(cooldown),
        maxAgeMinutes: Number(maxAge),
        quietStart: parseQuietTime(quietStart),
        quietEnd: parseQuietTime(quietEnd),
      };
      validateProactiveConfig(config);
      if (await rules.apply({ op: "create", config })) setName("");
    } catch (failure) {
      setFormError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  async function remove() {
    if (deleteId && (await rules.apply({ op: "delete", id: deleteId }))) setDeleteId(null);
  }

  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    const nodes: PresentationNode[] = [
      ...(snapshot
        ? [
            {
              id: "host",
              kind: "Text" as const,
              text: `${t("proactive.host")}: ${snapshot.hostId} · ${snapshot.hostTime}`,
              secondary: true,
            },
          ]
        : []),
      c.action(
        "refresh",
        busy ? t("proactive.loading") : t("proactive.refresh"),
        rules.refresh,
        !busy,
      ),
      ...(displayError
        ? [{ id: "error", kind: "Banner" as const, status: "error" as const, label: displayError }]
        : []),
      ...(snapshot?.healthEventError
        ? [
            {
              id: "health-event-error",
              kind: "Banner" as const,
              status: "error" as const,
              label: snapshot.healthEventError,
            },
          ]
        : []),
      ...(snapshot?.homeEventError
        ? [
            {
              id: "home-event-error",
              kind: "Banner" as const,
              status: "error" as const,
              label: snapshot.homeEventError,
            },
          ]
        : []),
      ...(snapshot
        ? [
            c.group("create", t("proactive.create"), [
              ...(targets.length
                ? []
                : [{ id: "no-target", kind: "Text" as const, text: t("proactive.noTarget") }]),
              c.input("name", t("proactive.name"), name, setName, false, enabled),
              c.select(
                "target",
                t("proactive.target"),
                target,
                targetOptions,
                selectTarget,
                enabled,
              ),
              ...((snapshot.executionPeers?.length ?? 0) > 0
                ? [
                    c.select(
                      "execution-peer",
                      t("proactive.executor"),
                      executionPeer,
                      executionOptions,
                      selectExecutionPeer,
                      enabled,
                    ),
                    ...(executionPeer
                      ? [
                          c.select(
                            "execution-provider",
                            t("proactive.provider"),
                            executionProvider,
                            executionProviderOptions,
                            selectExecutionProvider,
                            enabled && !!selectedPeer,
                          ),
                          c.select(
                            "execution-model",
                            t("proactive.model"),
                            executionModel,
                            executionModelOptions,
                            selectExecutionModel,
                            enabled && !!selectedProvider,
                          ),
                        ]
                      : []),
                  ]
                : []),
              ...(kind === "health_updated"
                ? [
                    c.select(
                      "health-metric",
                      t("proactive.healthMetric"),
                      healthMetric,
                      healthOptions,
                      selectHealthMetric,
                      enabled,
                    ),
                    ...(executionPeer
                      ? [
                          c.select(
                            "health-reads",
                            t("proactive.healthReads"),
                            healthReads,
                            [
                              { value: "manual", label: t("proactive.healthReads.manual") },
                              { value: "background", label: t("proactive.healthReads.background") },
                            ],
                            setHealthReads,
                            enabled && executionReady,
                          ),
                        ]
                      : []),
                  ]
                : kind === "home_power_changed"
                  ? [
                      c.select(
                        "home-source",
                        t("proactive.home"),
                        homeId,
                        homeOptions,
                        setHomeId,
                        enabled,
                      ),
                    ]
                  : [
                      c.select(
                        "source",
                        t("proactive.source"),
                        source,
                        sourceOptions,
                        setSource,
                        enabled,
                      ),
                    ]),
              c.select("kind", t("proactive.event"), kind, kindOptions, selectEventKind, enabled),
              c.input("cooldown", t("proactive.cooldown"), cooldown, setCooldown, false, enabled),
              c.input("max-age", t("proactive.maxAge"), maxAge, setMaxAge, false, enabled),
              c.input(
                "quiet-start",
                t("proactive.quietStart"),
                quietStart,
                setQuietStart,
                false,
                enabled,
              ),
              c.input("quiet-end", t("proactive.quietEnd"), quietEnd, setQuietEnd, false, enabled),
              c.action(
                "save",
                t("proactive.create"),
                create,
                enabled &&
                  targets.some((task) => task.id === target) &&
                  executionReady &&
                  (kind !== "health_updated" ||
                    healthOptions.some((option) => option.value === healthMetric)) &&
                  (kind !== "home_power_changed" ||
                    homeOptions.some((option) => option.value === homeId)) &&
                  !!name.trim() &&
                  snapshot.rules.length < 20,
              ),
            ]),
            ...snapshot.rules.map((rule) =>
              c.group(rule.id, rule.config.name, [
                {
                  id: `${rule.id}:details`,
                  kind: "Text",
                  text: describe(rule.config),
                  secondary: true,
                },
                ...(rule.config.quietStart !== null && rule.config.quietEnd !== null
                  ? [
                      {
                        id: `${rule.id}:quiet`,
                        kind: "Text" as const,
                        text: `${t("proactive.quiet")}: ${formatTime(rule.config.quietStart)}–${formatTime(rule.config.quietEnd)}`,
                      },
                    ]
                  : []),
                c.toggle(
                  `${rule.id}:enabled`,
                  t("proactive.enabled"),
                  rule.enabled,
                  (value) => rules.apply({ op: "set_enabled", id: rule.id, enabled: value }),
                  enabled,
                ),
                ...(rule.lastError
                  ? [
                      {
                        id: `${rule.id}:error`,
                        kind: "Banner" as const,
                        status: "error" as const,
                        label: t(`proactive.reason.${rule.lastError}`),
                      },
                    ]
                  : []),
                {
                  ...c.action(
                    `${rule.id}:delete`,
                    t("proactive.delete"),
                    () => setDeleteId(rule.id),
                    enabled,
                  ),
                  destructive: true,
                },
              ]),
            ),
            ...(snapshot.rules.length
              ? []
              : [{ id: "empty", kind: "Text" as const, text: t("proactive.empty") }]),
            c.group(
              "receipts",
              t("proactive.receipts"),
              snapshot.deliveries.length
                ? snapshot.deliveries.flatMap((delivery) => [
                    {
                      id: `${delivery.ruleId}:${delivery.eventSequence}`,
                      kind: "Text" as const,
                      text: `${t(proactiveDeliveryStatus(delivery))} · ${ruleName(delivery.ruleId)} · ${t(`proactive.reason.${delivery.reason}`)} · ${taskName(delivery.sourceTaskId)} · ${new Date(delivery.updatedAt).toLocaleString()}\n${delivery.sourceExecutionId}${delivery.executionId ? ` → ${delivery.executionId}` : ""}`,
                    },
                    ...(delivery.deliveryError
                      ? [
                          {
                            id: `${delivery.ruleId}:${delivery.eventSequence}:error`,
                            kind: "Banner" as const,
                            status: "error" as const,
                            label: delivery.deliveryError,
                          },
                        ]
                      : []),
                  ])
                : [{ id: "no-receipts", kind: "Text", text: t("proactive.noReceipts") }],
            ),
          ]
        : []),
      ...(deleteId
        ? [
            c.group("confirm-delete", t("proactive.deleteConfirm"), [
              {
                ...c.action("delete-confirm", t("proactive.delete"), remove, enabled),
                destructive: true,
              },
              c.action("delete-cancel", t("settings.cancel"), () => setDeleteId(null), !busy),
            ]),
          ]
        : []),
      c.action("back", t("proactive.back"), props.onBack),
    ];
    const Surface = props.nativeOtherSink ? NativeSettingsContent : NativeSurface;
    return (
      <Surface
        sink={props.nativeOtherSink}
        sessionSurface={props.nativeSettingsSurfaceId}
        document={{
          mode: props.nativePresentationMode ?? "sheet",
          title: t("proactive.title"),
          appearance: props.settings.theme,
          formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
          theme: createNativePresentationTheme(
            props.settings,
            isNativeMobileRuntime(),
            "workspaceTools",
          ),
          nodes,
          dismissAction: "back",
        }}
        handlers={c.handlers}
        onError={(failure) => setFormError(String(failure))}
      />
    );
  }

  return (
    <VStack width="100%" gap={4}>
      <Heading level={2}>{t("proactive.title")}</Heading>
      {snapshot ? (
        <Text type="supporting" wordBreak="break-word">
          {t("proactive.host")}: {snapshot.hostId} · {snapshot.hostTime}
        </Text>
      ) : null}
      <Button
        size="lg"
        label={t("proactive.refresh")}
        onClick={() => void rules.refresh()}
        isLoading={busy}
        isDisabled={busy}
      />
      {displayError ? <Banner status="error" title={displayError} collapsible={false} /> : null}
      {snapshot?.healthEventError ? (
        <Banner status="error" title={snapshot.healthEventError} collapsible={false} />
      ) : null}
      {snapshot?.homeEventError ? (
        <Banner status="error" title={snapshot.homeEventError} collapsible={false} />
      ) : null}
      {snapshot ? (
        <>
          <Section padding={4} width="100%">
            <VStack gap={3} width="100%">
              <Heading level={3}>{t("proactive.create")}</Heading>
              {!targets.length ? (
                <Text wordBreak="break-word">{t("proactive.noTarget")}</Text>
              ) : null}
              <TextInput
                size="lg"
                label={t("proactive.name")}
                value={name}
                onChange={setName}
                isDisabled={!enabled}
                width="100%"
              />
              <Selector
                size="lg"
                label={t("proactive.target")}
                placeholder={t("proactive.chooseTask")}
                value={target}
                options={targetOptions}
                onChange={selectTarget}
                isDisabled={!enabled}
                presentation="adaptive"
                width="100%"
              />
              {(snapshot.executionPeers?.length ?? 0) > 0 ? (
                <>
                  <Selector
                    size="lg"
                    label={t("proactive.executor")}
                    value={executionPeer}
                    options={executionOptions}
                    onChange={selectExecutionPeer}
                    isDisabled={!enabled}
                    presentation="adaptive"
                    width="100%"
                  />
                  {executionPeer ? (
                    <>
                      <Selector
                        size="lg"
                        label={t("proactive.provider")}
                        value={executionProvider}
                        options={executionProviderOptions}
                        onChange={selectExecutionProvider}
                        isDisabled={!enabled || !selectedPeer}
                        presentation="adaptive"
                        width="100%"
                      />
                      <Selector
                        size="lg"
                        label={t("proactive.model")}
                        value={executionModel}
                        options={executionModelOptions}
                        onChange={selectExecutionModel}
                        isDisabled={!enabled || !selectedProvider}
                        presentation="adaptive"
                        width="100%"
                      />
                    </>
                  ) : null}
                </>
              ) : null}
              <Selector
                size="lg"
                label={t(
                  kind === "home_power_changed"
                    ? "proactive.home"
                    : kind === "health_updated"
                      ? "proactive.healthMetric"
                      : "proactive.source",
                )}
                value={
                  kind === "home_power_changed"
                    ? homeId
                    : kind === "health_updated"
                      ? healthMetric
                      : source
                }
                options={
                  kind === "home_power_changed"
                    ? homeOptions
                    : kind === "health_updated"
                      ? healthOptions
                      : sourceOptions
                }
                onChange={
                  kind === "home_power_changed"
                    ? setHomeId
                    : kind === "health_updated"
                      ? selectHealthMetric
                      : setSource
                }
                isDisabled={!enabled}
                presentation="adaptive"
                width="100%"
              />
              {kind === "health_updated" && executionPeer ? (
                <Selector
                  size="lg"
                  label={t("proactive.healthReads")}
                  value={healthReads}
                  options={[
                    { value: "manual", label: t("proactive.healthReads.manual") },
                    { value: "background", label: t("proactive.healthReads.background") },
                  ]}
                  onChange={setHealthReads}
                  isDisabled={!enabled || !executionReady}
                  presentation="adaptive"
                  width="100%"
                />
              ) : null}
              <Selector
                size="lg"
                label={t("proactive.event")}
                value={kind}
                options={kindOptions}
                onChange={selectEventKind}
                isDisabled={!enabled}
                presentation="adaptive"
                width="100%"
              />
              <TextInput
                size="lg"
                label={t("proactive.cooldown")}
                value={cooldown}
                onChange={setCooldown}
                isDisabled={!enabled}
                width="100%"
              />
              <TextInput
                size="lg"
                label={t("proactive.maxAge")}
                value={maxAge}
                onChange={setMaxAge}
                isDisabled={!enabled}
                width="100%"
              />
              <TextInput
                size="lg"
                label={t("proactive.quietStart")}
                value={quietStart}
                onChange={setQuietStart}
                isDisabled={!enabled}
                width="100%"
              />
              <TextInput
                size="lg"
                label={t("proactive.quietEnd")}
                value={quietEnd}
                onChange={setQuietEnd}
                isDisabled={!enabled}
                width="100%"
              />
              <Button
                size="lg"
                label={t("proactive.create")}
                onClick={() => void create()}
                isDisabled={
                  !enabled ||
                  !targets.some((task) => task.id === target) ||
                  !executionReady ||
                  (kind === "health_updated" &&
                    !healthOptions.some((option) => option.value === healthMetric)) ||
                  (kind === "home_power_changed" &&
                    !homeOptions.some((option) => option.value === homeId)) ||
                  !name.trim() ||
                  snapshot.rules.length >= 20
                }
              />
            </VStack>
          </Section>
          <VStack gap={3} aria-live="polite" aria-busy={busy}>
            {!snapshot.rules.length ? <Text>{t("proactive.empty")}</Text> : null}
            {snapshot.rules.map((rule) => (
              <Section key={rule.id} padding={4} width="100%">
                <VStack gap={3} width="100%">
                  <Heading level={3} wordBreak="break-word">
                    {rule.config.name}
                  </Heading>
                  <Text type="supporting" wordBreak="break-word">
                    {describe(rule.config)}
                  </Text>
                  {rule.config.quietStart !== null && rule.config.quietEnd !== null ? (
                    <Text type="supporting">
                      {t("proactive.quiet")}: {formatTime(rule.config.quietStart)}–
                      {formatTime(rule.config.quietEnd)}
                    </Text>
                  ) : null}
                  <Switch
                    label={t("proactive.enabled")}
                    value={rule.enabled}
                    onChange={(value) =>
                      void rules.apply({ op: "set_enabled", id: rule.id, enabled: value })
                    }
                    isDisabled={!enabled}
                  />
                  {rule.lastError ? (
                    <Banner
                      status="error"
                      title={t(`proactive.reason.${rule.lastError}`)}
                      collapsible={false}
                    />
                  ) : null}
                  <Button
                    size="lg"
                    label={t("proactive.delete")}
                    onClick={() => setDeleteId(rule.id)}
                    isDisabled={!enabled}
                  />
                </VStack>
              </Section>
            ))}
          </VStack>
          <Section padding={4} width="100%">
            <VStack gap={3}>
              <Heading level={3}>{t("proactive.receipts")}</Heading>
              {!snapshot.deliveries.length ? <Text>{t("proactive.noReceipts")}</Text> : null}
              {snapshot.deliveries.map((delivery) => (
                <VStack key={`${delivery.ruleId}:${delivery.eventSequence}`} gap={1}>
                  <Text wordBreak="break-word">
                    {t(proactiveDeliveryStatus(delivery))} · {ruleName(delivery.ruleId)} ·{" "}
                    {t(`proactive.reason.${delivery.reason}`)} · {taskName(delivery.sourceTaskId)}
                  </Text>
                  <Text type="supporting" wordBreak="break-word">
                    {new Date(delivery.updatedAt).toLocaleString()} · {delivery.sourceExecutionId}
                    {delivery.executionId ? ` → ${delivery.executionId}` : ""}
                  </Text>
                  {delivery.deliveryError ? (
                    <Banner status="error" title={delivery.deliveryError} collapsible={false} />
                  ) : null}
                </VStack>
              ))}
            </VStack>
          </Section>
        </>
      ) : null}
      {deleteId ? (
        <Section padding={4}>
          <VStack gap={3}>
            <Text wordBreak="break-word">{t("proactive.deleteConfirm")}</Text>
            <Button
              size="lg"
              label={t("proactive.delete")}
              onClick={() => void remove()}
              isDisabled={!enabled}
            />
            <Button
              size="lg"
              label={t("settings.cancel")}
              onClick={() => setDeleteId(null)}
              isDisabled={busy}
            />
          </VStack>
        </Section>
      ) : null}
      <Button size="lg" label={t("proactive.back")} onClick={props.onBack} />
    </VStack>
  );
}
