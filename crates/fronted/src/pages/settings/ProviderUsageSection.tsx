import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Grid, GridSpan } from "@astryxdesign/core/Grid";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState } from "react";
import { RefreshCw, Wallet } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  type ProviderUsageResult,
  testProviderUsage,
  useProviderUsage,
} from "../../lib/providers/usageQuery";
import {
  type CustomProvider,
  getDefaultUsageQueryConfig,
  normalizeUsageQueryConfig,
  type UsageQueryConfig,
  type UsageQueryMode,
  updateCustomProviders,
} from "../../lib/settings";
import type { SettingsSectionProps } from "./types";

const MODES: UsageQueryMode[] = ["coding-plan", "balance", "general", "newapi", "custom"];

function formatAmount(value: number | undefined, unit?: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${unit ? ` ${unit}` : ""}`;
}

function UsageResultView({ result }: { result: ProviderUsageResult | null }) {
  if (!result) return null;
  if (result.error) return <Banner status="error" title={result.error} collapsible={false} />;
  return (
    <Grid columns={{ minWidth: 220, max: 2, repeat: "fit" }} gap={2} width="100%">
      {result.data.map((item, index) => (
        <Card key={`${item.planName ?? "usage"}-${index}`} padding={3} variant="muted" width="100%">
          <VStack gap={2}>
            <Heading level={4}>{item.planName || item.extra || "Usage"}</Heading>
            <MetadataList>
              <MetadataListItem label="Remaining">
                <Text type="body" hasTabularNumbers>
                  {formatAmount(item.remaining, item.unit)}
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Used">
                <Text type="body" hasTabularNumbers>
                  {formatAmount(item.used, item.unit)}
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Total">
                <Text type="body" hasTabularNumbers>
                  {formatAmount(item.total, item.unit)}
                </Text>
              </MetadataListItem>
            </MetadataList>
            {item.isValid === false ? (
              <Banner
                status="error"
                title={item.invalidMessage || "Invalid account"}
                collapsible={false}
              />
            ) : null}
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}

export function ProviderUsageSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const usage = useProviderUsage(settings.customProviders);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ProviderUsageResult | null>>({});

  const patchProvider = (providerId: string, patch: Partial<UsageQueryConfig>) => {
    setSettings((prev) =>
      updateCustomProviders(
        prev,
        prev.customProviders.map((provider) =>
          provider.id === providerId
            ? {
                ...provider,
                usageQuery: normalizeUsageQueryConfig({
                  ...(provider.usageQuery ?? getDefaultUsageQueryConfig()),
                  ...patch,
                }),
              }
            : provider,
        ),
      ),
    );
  };

  const runTest = async (provider: CustomProvider) => {
    setTestingId(provider.id);
    try {
      const result = await testProviderUsage(
        provider.id,
        provider.usageQuery ?? getDefaultUsageQueryConfig(),
      );
      setTestResults((current) => ({ ...current, [provider.id]: result }));
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [provider.id]: {
          data: [],
          error: error instanceof Error ? error.message : String(error),
          isStale: false,
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <VStack gap={4}>
      <Section padding={4} width="100%">
        <HStack gap={3} vAlign="start">
          <Wallet />
          <VStack gap={1}>
            <Heading level={2}>{t("settings.usage.title")}</Heading>
            <Text type="supporting" color="secondary">
              {t("settings.usage.desc")}
            </Text>
          </VStack>
        </HStack>
      </Section>

      {settings.customProviders.map((provider) => {
        const config = provider.usageQuery ?? getDefaultUsageQueryConfig();
        const liveState = usage.getState(provider.id);
        const shownResult = testResults[provider.id] ?? liveState.result;
        return (
          <Section key={provider.id} padding={0} width="100%">
            <HStack gap={3} vAlign="center" padding={4}>
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={3} maxLines={1}>
                    {provider.name}
                  </Heading>
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {provider.baseUrl || provider.type} · {t(`settings.usage.mode.${config.mode}`)}
                  </Text>
                </VStack>
              </StackItem>
              {liveState.loading ? (
                <Spinner aria-label={t("settings.usage.refresh")} size="sm" />
              ) : null}
              <Switch
                value={config.enabled}
                label={`${provider.name}: ${t("settings.usage.title")}`}
                isLabelHidden
                onChange={(enabled) => patchProvider(provider.id, { enabled })}
              />
            </HStack>
            <Collapsible
              defaultIsOpen={config.enabled}
              trigger={`${t("settings.usage.mode")}: ${t(`settings.usage.mode.${config.mode}`)}`}
            >
              <Section variant="transparent" dividers={["top"]} padding={4} width="100%">
                <VStack gap={4}>
                  <Grid columns={{ minWidth: 240, max: 2, repeat: "fit" }} gap={3} width="100%">
                    <Selector
                      label={t("settings.usage.mode")}
                      value={config.mode}
                      onChange={(mode) =>
                        patchProvider(provider.id, { mode: mode as UsageQueryMode })
                      }
                      options={MODES.map((mode) => ({
                        value: mode,
                        label: t(`settings.usage.mode.${mode}`),
                      }))}
                      width="100%"
                    />
                    <NumberInput
                      label={t("settings.usage.timeout")}
                      min={2}
                      max={30}
                      value={config.timeoutSecs ?? 10}
                      onChange={(value) => patchProvider(provider.id, { timeoutSecs: value ?? 10 })}
                      width="100%"
                      isWheelEnabled={false}
                    />
                    <GridSpan columns="full">
                      <TextInput
                        label={t("settings.usage.baseUrl")}
                        value={config.baseUrl}
                        onChange={(baseUrl) => patchProvider(provider.id, { baseUrl })}
                        placeholder={provider.baseUrl}
                        width="100%"
                      />
                    </GridSpan>
                    <TextInput
                      label="API Key"
                      type="password"
                      value={config.apiKey}
                      onChange={(apiKey) => patchProvider(provider.id, { apiKey })}
                      placeholder={
                        config.apiKeyConfigured
                          ? t("settings.usage.secretSaved")
                          : t("settings.usage.providerCredential")
                      }
                      width="100%"
                    />
                    {config.mode === "newapi" ? (
                      <>
                        <TextInput
                          label="Access Token"
                          type="password"
                          value={config.accessToken}
                          onChange={(accessToken) => patchProvider(provider.id, { accessToken })}
                          width="100%"
                        />
                        <TextInput
                          label="User ID"
                          value={config.userId}
                          onChange={(userId) => patchProvider(provider.id, { userId })}
                          width="100%"
                        />
                      </>
                    ) : null}
                    {config.mode === "coding-plan" ? (
                      <>
                        <TextInput
                          label="Plan Provider"
                          value={config.codingPlanProvider}
                          onChange={(codingPlanProvider) =>
                            patchProvider(provider.id, { codingPlanProvider })
                          }
                          placeholder="auto / zhipu_team / zenmux"
                          width="100%"
                        />
                        <TextInput
                          label="Organization ID"
                          value={config.teamOrganizationId}
                          onChange={(teamOrganizationId) =>
                            patchProvider(provider.id, { teamOrganizationId })
                          }
                          width="100%"
                        />
                        <TextInput
                          label="Project ID"
                          value={config.teamProjectId}
                          onChange={(teamProjectId) =>
                            patchProvider(provider.id, { teamProjectId })
                          }
                          width="100%"
                        />
                        <TextInput
                          label="Access Key ID"
                          value={config.accessKeyId}
                          onChange={(accessKeyId) => patchProvider(provider.id, { accessKeyId })}
                          width="100%"
                        />
                        <TextInput
                          label="Secret Access Key"
                          type="password"
                          value={config.secretAccessKey}
                          onChange={(secretAccessKey) =>
                            patchProvider(provider.id, { secretAccessKey })
                          }
                          width="100%"
                        />
                      </>
                    ) : null}
                    {config.mode === "general" ||
                    config.mode === "newapi" ||
                    config.mode === "custom" ? (
                      <GridSpan columns="full">
                        <TextArea
                          label={t("settings.usage.script")}
                          value={config.script}
                          onChange={(script) => patchProvider(provider.id, { script })}
                          rows={8}
                          placeholder={
                            config.mode === "custom"
                              ? t("settings.usage.scriptRequired")
                              : t("settings.usage.scriptPreset")
                          }
                          width="100%"
                          hasSpellCheck={false}
                        />
                      </GridSpan>
                    ) : null}
                  </Grid>

                  <HStack gap={2} wrap="wrap">
                    <Button
                      type="button"
                      label={t("settings.usage.test")}
                      icon={<RefreshCw />}
                      variant="primary"
                      isLoading={testingId === provider.id}
                      isDisabled={testingId === provider.id}
                      onClick={() => void runTest(provider)}
                    />
                    {config.enabled ? (
                      <Button
                        type="button"
                        label={t("settings.usage.refresh")}
                        variant="secondary"
                        isLoading={liveState.loading}
                        onClick={() => void usage.refresh(provider.id)}
                      />
                    ) : null}
                  </HStack>
                  <UsageResultView result={shownResult} />
                </VStack>
              </Section>
            </Collapsible>
          </Section>
        );
      })}
    </VStack>
  );
}
