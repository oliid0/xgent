import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Section } from "@astryxdesign/core/Section";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";

import { ChevronDown, ChevronUp, Waypoints } from "../../components/icons";
import { useLocale } from "../../i18n";
import type { ModelFailoverProviderSettings, ProviderId } from "../../lib/settings";
import type { SettingsSectionProps } from "./types";

const PROVIDER_TYPES: readonly ProviderId[] = ["claude_code", "codex", "gemini", "xai", "deepseek"];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude_code: "Anthropic",
  codex: "OpenAI",
  gemini: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
};

export function ModelFailoverSection({
  settings,
  setSettings,
  providerType: selectedProviderType,
  compact = false,
}: SettingsSectionProps & { providerType?: ProviderId; compact?: boolean }) {
  const { t } = useLocale();
  const providerTypes = selectedProviderType ? [selectedProviderType] : PROVIDER_TYPES;

  const updateProvider = (
    providerType: ProviderId,
    patch: Partial<ModelFailoverProviderSettings>,
  ) => {
    setSettings((previous) => ({
      ...previous,
      modelFailover: {
        ...previous.modelFailover,
        [providerType]: { ...previous.modelFailover[providerType], ...patch },
      },
    }));
  };

  const toggleQueueProvider = (providerType: ProviderId, providerId: string) => {
    const current = settings.modelFailover[providerType];
    updateProvider(providerType, {
      queue: current.queue.includes(providerId)
        ? current.queue.filter((id) => id !== providerId)
        : [...current.queue, providerId],
    });
  };

  const moveQueueProvider = (providerType: ProviderId, providerId: string, offset: -1 | 1) => {
    const current = settings.modelFailover[providerType];
    const index = current.queue.indexOf(providerId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= current.queue.length) return;
    const queue = current.queue.slice();
    [queue[index], queue[target]] = [queue[target], queue[index]];
    updateProvider(providerType, { queue });
  };

  return (
    <VStack gap={5}>
      {!compact ? (
        <Section padding={4} width="100%">
          <HStack gap={3} vAlign="start">
            <Icon icon={Waypoints} size="md" color="warning" />
            <StackItem size="fill">
              <VStack gap={1}>
                <Heading level={2}>{t("settings.failover.title")}</Heading>
                <Text type="supporting" color="secondary">
                  {t("settings.failover.desc")}
                </Text>
              </VStack>
            </StackItem>
          </HStack>
        </Section>
      ) : null}

      {providerTypes.map((providerType) => {
        const config = settings.modelFailover[providerType];
        const providers = settings.customProviders.filter(
          (provider) => provider.type === providerType,
        );
        const queueProviders = config.queue
          .map((id) => providers.find((provider) => provider.id === id))
          .filter((provider): provider is (typeof providers)[number] => Boolean(provider));
        const unqueuedProviders = providers.filter(
          (provider) => !config.queue.includes(provider.id),
        );

        return (
          <Section
            key={providerType}
            padding={compact ? 3 : 4}
            width="100%"
            dividers={compact ? undefined : ["top"]}
          >
            <VStack gap={4}>
              <HStack gap={4} vAlign="start">
                <StackItem size="fill">
                  <VStack gap={1}>
                    <Heading level={3}>{PROVIDER_LABELS[providerType]}</Heading>
                    <Text type="supporting" color="secondary">
                      {t("settings.failover.vendorDesc")}
                    </Text>
                  </VStack>
                </StackItem>
                <Switch
                  label={`${PROVIDER_LABELS[providerType]} ${t("settings.failover.enabled")}`}
                  isLabelHidden
                  value={config.enabled}
                  onChange={(enabled) => updateProvider(providerType, { enabled })}
                />
              </HStack>

              <Grid columns={{ minWidth: 180, max: 3, repeat: "fit" }} gap={3} width="100%">
                <NumberInput
                  label={t("settings.failover.maxSwitches")}
                  min={1}
                  max={10}
                  value={config.maxSwitches}
                  isWheelEnabled={false}
                  width="100%"
                  onChange={(value) =>
                    updateProvider(providerType, {
                      maxSwitches: Math.min(10, Math.max(1, value ?? 1)),
                    })
                  }
                />
                <NumberInput
                  label={t("settings.failover.failureThreshold")}
                  min={1}
                  max={10}
                  value={config.failureThreshold}
                  isWheelEnabled={false}
                  width="100%"
                  onChange={(value) =>
                    updateProvider(providerType, {
                      failureThreshold: Math.min(10, Math.max(1, value ?? 1)),
                    })
                  }
                />
                <NumberInput
                  label={t("settings.failover.cooldown")}
                  min={5}
                  max={3600}
                  value={config.cooldownSeconds}
                  isWheelEnabled={false}
                  width="100%"
                  onChange={(value) =>
                    updateProvider(providerType, {
                      cooldownSeconds: Math.min(3600, Math.max(5, value ?? 5)),
                    })
                  }
                />
              </Grid>

              <VStack gap={2}>
                <Text type="label" weight="medium">
                  {t("settings.failover.queue")}
                </Text>
                {providers.length < 2 ? (
                  <Banner
                    status="info"
                    title={t("settings.failover.needProviders")}
                    collapsible={false}
                  />
                ) : (
                  <>
                    {queueProviders.length > 0 ? (
                      <List density="compact" hasDividers aria-label={t("settings.failover.queue")}>
                        {queueProviders.map((provider, index) => {
                          const moveUpLabel = `${t("settings.failover.moveUp")}: ${provider.name}`;
                          const moveDownLabel = `${t("settings.failover.moveDown")}: ${provider.name}`;
                          return (
                            <ListItem
                              key={provider.id}
                              label={provider.name}
                              startContent={<Badge label={index + 1} variant="neutral" />}
                              endContent={
                                <HStack gap={1} vAlign="center">
                                  <IconButton
                                    label={moveUpLabel}
                                    tooltip={moveUpLabel}
                                    icon={<Icon icon={ChevronUp} size="sm" color="inherit" />}
                                    size="sm"
                                    variant="ghost"
                                    isDisabled={index === 0}
                                    onClick={() => moveQueueProvider(providerType, provider.id, -1)}
                                  />
                                  <IconButton
                                    label={moveDownLabel}
                                    tooltip={moveDownLabel}
                                    icon={<Icon icon={ChevronDown} size="sm" color="inherit" />}
                                    size="sm"
                                    variant="ghost"
                                    isDisabled={index === queueProviders.length - 1}
                                    onClick={() => moveQueueProvider(providerType, provider.id, 1)}
                                  />
                                  <Button
                                    label={t("settings.failover.remove")}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => toggleQueueProvider(providerType, provider.id)}
                                  />
                                </HStack>
                              }
                            />
                          );
                        })}
                      </List>
                    ) : null}
                    {unqueuedProviders.length > 0 ? (
                      <HStack gap={2} wrap="wrap">
                        {unqueuedProviders.map((provider) => (
                          <Button
                            key={provider.id}
                            label={`+ ${provider.name}`}
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleQueueProvider(providerType, provider.id)}
                          />
                        ))}
                      </HStack>
                    ) : null}
                  </>
                )}
              </VStack>
            </VStack>
          </Section>
        );
      })}
    </VStack>
  );
}
