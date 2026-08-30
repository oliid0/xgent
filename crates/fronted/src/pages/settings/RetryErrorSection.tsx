import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState } from "react";

import { RefreshCw, X } from "../../components/icons";
import { useLocale } from "../../i18n";
import { RETRYABLE_PRESET_HTTP_STATUS_CODES } from "../../lib/settings";
import type { SettingsSectionProps } from "./types";

export function RetryErrorSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const [patternDraft, setPatternDraft] = useState("");

  function togglePresetCode(code: number, enabled: boolean) {
    setSettings((previous) => {
      const current = previous.retryErrorSettings.presetStatusCodes;
      return {
        ...previous,
        retryErrorSettings: {
          ...previous.retryErrorSettings,
          presetStatusCodes: enabled
            ? current.includes(code)
              ? current
              : [...current, code]
            : current.filter((item) => item !== code),
        },
      };
    });
  }

  function addPattern() {
    const pattern = patternDraft.trim();
    if (!pattern) return;
    setPatternDraft("");
    setSettings((previous) => {
      const exists = previous.retryErrorSettings.customPatterns.some(
        (item) => item.toLocaleLowerCase() === pattern.toLocaleLowerCase(),
      );
      if (exists) return previous;
      return {
        ...previous,
        retryErrorSettings: {
          ...previous.retryErrorSettings,
          customPatterns: [...previous.retryErrorSettings.customPatterns, pattern],
        },
      };
    });
  }

  function removePattern(pattern: string) {
    setSettings((previous) => ({
      ...previous,
      retryErrorSettings: {
        ...previous.retryErrorSettings,
        customPatterns: previous.retryErrorSettings.customPatterns.filter(
          (item) => item !== pattern,
        ),
      },
    }));
  }

  return (
    <Section width="100%" padding={4} dividers={["top"]}>
      <VStack gap={4}>
        <HStack gap={3} vAlign="start">
          <RefreshCw />
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Heading level={3}>{t("settings.retryError")}</Heading>
              <Text type="supporting" color="secondary">
                {t("settings.retryErrorDesc")}
              </Text>
            </VStack>
          </StackItem>
        </HStack>

        <List
          density="compact"
          hasDividers
          header={
            <VStack gap={0.5}>
              <Text type="label" weight="semibold">
                {t("settings.retryErrorPresets")}
              </Text>
              <Text type="supporting" color="secondary">
                {t("settings.retryErrorBuiltinNote")}
              </Text>
            </VStack>
          }
        >
          {RETRYABLE_PRESET_HTTP_STATUS_CODES.map((code) => {
            const enabled = settings.retryErrorSettings.presetStatusCodes.includes(code);
            return (
              <ListItem
                key={code}
                label={t(`settings.retryError.presetShort.${code}`)}
                description={t(`settings.retryError.preset.${code}`)}
                startContent={<Badge label={code} variant="neutral" />}
                endContent={
                  <Switch
                    label={t(`settings.retryError.preset.${code}`)}
                    isLabelHidden
                    size="sm"
                    value={enabled}
                    onChange={(value) => togglePresetCode(code, value)}
                  />
                }
              />
            );
          })}
        </List>

        <VStack gap={2}>
          <VStack gap={0.5}>
            <Text type="label" weight="semibold">
              {t("settings.retryErrorCustomPatterns")}
            </Text>
            <Text type="supporting" color="secondary">
              {t("settings.retryErrorCustomPatternsDesc")}
            </Text>
          </VStack>
          <HStack gap={2} vAlign="end">
            <StackItem size="fill">
              <TextInput
                label={t("settings.retryErrorCustomPatterns")}
                isLabelHidden
                value={patternDraft}
                placeholder={t("settings.retryErrorCustomPatternPlaceholder")}
                width="100%"
                onChange={setPatternDraft}
              />
            </StackItem>
            <Button
              label={t("settings.retryErrorAddPattern")}
              variant="secondary"
              isDisabled={!patternDraft.trim()}
              onClick={addPattern}
            />
          </HStack>
          {settings.retryErrorSettings.customPatterns.length > 0 ? (
            <List density="compact" hasDividers>
              {settings.retryErrorSettings.customPatterns.map((pattern) => (
                <ListItem
                  key={pattern}
                  label={pattern}
                  endContent={
                    <IconButton
                      label={`${t("settings.retryErrorRemovePattern")} ${pattern}`}
                      tooltip={t("settings.retryErrorRemovePattern")}
                      variant="ghost"
                      size="sm"
                      icon={<X />}
                      onClick={() => removePattern(pattern)}
                    />
                  }
                />
              ))}
            </List>
          ) : null}
        </VStack>
      </VStack>
    </Section>
  );
}
