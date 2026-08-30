import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid, GridSpan } from "@astryxdesign/core/Grid";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState } from "react";
import { Mic } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  normalizeSettings,
  STT_PROVIDER_IDS,
  type SttProviderId,
  type SttProviderSettings,
} from "../../lib/settings";
import { desktopSttSettingsService } from "../../lib/stt/desktopSttSettingsService";
import type { SttSecretField } from "../../lib/stt/types";
import type { SettingsSectionProps } from "./types";

const PROVIDER_LABELS: Record<SttProviderId, string> = {
  aliyun_dashscope: "阿里云 DashScope",
  tencent_cloud: "腾讯云 ASR",
  volcengine_v2: "火山引擎 ASR v2",
  volcengine_seed_v3: "火山引擎 Seed ASR v3",
  baidu_cloud: "百度智能云 ASR",
};

type Field = {
  key: keyof SttProviderSettings;
  label: string;
  secret?: SttSecretField;
  placeholder?: string;
};

const PROVIDER_FIELDS: Record<SttProviderId, Field[]> = {
  aliyun_dashscope: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "model", label: "Model" },
    { key: "apiKey", label: "API Key", secret: "apiKey" },
  ],
  tencent_cloud: [
    { key: "appId", label: "AppId" },
    { key: "engineModelType", label: "Engine Model Type" },
    { key: "secretId", label: "SecretId", secret: "secretId" },
    { key: "secretKey", label: "SecretKey", secret: "secretKey" },
  ],
  volcengine_v2: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "appId", label: "App ID" },
    { key: "cluster", label: "Cluster" },
    { key: "accessToken", label: "Access Token", secret: "accessToken" },
  ],
  volcengine_seed_v3: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "appId", label: "App ID" },
    { key: "resourceId", label: "Resource ID" },
    { key: "accessToken", label: "Access Token", secret: "accessToken" },
  ],
  baidu_cloud: [
    { key: "websocketUrl", label: "WebSocket URL" },
    { key: "baiduAppId", label: "App ID" },
    { key: "devPid", label: "dev_pid" },
    { key: "baiduApiKey", label: "API Key", secret: "baiduApiKey" },
  ],
};

export function SttSettingsSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const providerId = settings.stt.provider;
  const provider = settings.stt.providers[providerId];

  const patchProvider = (patch: Partial<SttProviderSettings>) => {
    setTestResult(null);
    setSettings((prev) =>
      normalizeSettings({
        ...prev,
        stt: {
          ...prev.stt,
          providers: {
            ...prev.stt.providers,
            [providerId]: { ...prev.stt.providers[providerId], ...patch },
          },
        },
      }),
    );
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await desktopSttSettingsService.update(settings.stt);
      const result = await desktopSttSettingsService.test(providerId);
      const ok = result.result === "connected" || result.result === "connected_no_speech";
      setTestResult({
        ok,
        message: result.message || t(`settings.stt.test.${result.result}`),
      });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <VStack gap={5}>
      <Section padding={4} width="100%">
        <HStack gap={3} vAlign="start">
          <Mic />
          <StackItem size="fill">
            <VStack gap={1}>
              <Heading level={2}>{t("settings.stt.title")}</Heading>
              <Text type="supporting" color="secondary">
                {t("settings.stt.desc")}
              </Text>
            </VStack>
          </StackItem>
          <Switch
            value={settings.stt.enabled}
            label={t("settings.stt.title")}
            isLabelHidden
            onChange={(enabled) =>
              setSettings((prev) => normalizeSettings({ ...prev, stt: { ...prev.stt, enabled } }))
            }
          />
        </HStack>
      </Section>

      <Section padding={4} width="100%">
        <VStack gap={4}>
          <Selector
            label={t("settings.stt.provider")}
            value={providerId}
            onChange={(value) => {
              const next = value as SttProviderId;
              if (!STT_PROVIDER_IDS.includes(next)) return;
              setTestResult(null);
              setSettings((prev) =>
                normalizeSettings({ ...prev, stt: { ...prev.stt, provider: next } }),
              );
            }}
            options={STT_PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDER_LABELS[id] }))}
            width="100%"
          />

          <Grid columns={{ minWidth: 240, max: 2, repeat: "fit" }} gap={3} width="100%">
            {PROVIDER_FIELDS[providerId].map((field) => (
              <GridSpan key={field.key} columns={field.key === "websocketUrl" ? "full" : 1}>
                <TextInput
                  label={field.label}
                  type={field.secret ? "password" : "text"}
                  value={typeof provider[field.key] === "string" ? String(provider[field.key]) : ""}
                  placeholder={
                    field.secret && provider.configured
                      ? t("settings.stt.secretSaved")
                      : field.placeholder
                  }
                  onChange={(value) => patchProvider({ [field.key]: value })}
                  width="100%"
                />
              </GridSpan>
            ))}
          </Grid>

          <HStack gap={3} vAlign="center" wrap="wrap">
            <Button
              type="button"
              label={t("settings.stt.test")}
              isLoading={testing}
              isDisabled={testing}
              onClick={() => void testConnection()}
            />
            {testResult ? (
              <Banner
                status={testResult.ok ? "success" : "error"}
                title={testResult.message}
                collapsible={false}
              />
            ) : null}
          </HStack>
        </VStack>
      </Section>
    </VStack>
  );
}
