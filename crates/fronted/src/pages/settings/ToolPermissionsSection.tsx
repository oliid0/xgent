import { Button } from "@astryxdesign/core/Button";
import { ButtonGroup } from "@astryxdesign/core/ButtonGroup";
import { Code } from "@astryxdesign/core/CodeBlock";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Shield } from "../../components/icons";
import { useLocale } from "../../i18n";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { type CommandSafetyMode, type ToolPolicy, updateSystem } from "../../lib/settings";
import { BUILTIN_TOOL_CATEGORIES } from "../../lib/tools/builtinToolCatalog";
import { PERSONAL_POLICY_PREFIX } from "../../lib/tools/mobileAssistantPolicy";
import {
  patchToolPolicies,
  resetToolPolicies,
  settingsToolsForCategory,
} from "../../lib/tools/toolPolicySettings";
import { SettingsRow, SettingsRowGroup, SettingsValueSelector } from "./shared";
import type { SettingsSectionProps } from "./types";

const POLICY_OPTIONS: readonly ToolPolicy[] = ["allow", "ask", "deny"];
const COMMAND_SAFETY_OPTIONS: readonly CommandSafetyMode[] = [
  "auto",
  "ask",
  "sandbox",
  "sandboxOffline",
];

export function ToolPermissionsSection({
  settings,
  setSettings,
  compact = false,
}: SettingsSectionProps & { compact?: boolean }) {
  const { t } = useLocale();
  const nativeMobile = isNativeMobileRuntime();
  const policies = Object.fromEntries(
    Object.entries(settings.system.toolPolicies ?? {}).filter(
      ([key]) => !key.startsWith(PERSONAL_POLICY_PREFIX),
    ),
  );

  const setToolPolicy = (toolName: string, policy: ToolPolicy) => {
    setSettings((prev) => patchToolPolicies(prev, [toolName], policy));
  };

  const setCategoryPolicy = (toolNames: readonly string[], policy: ToolPolicy) => {
    setSettings((prev) => patchToolPolicies(prev, toolNames, policy));
  };

  return (
    <VStack gap={5} width="100%" className="settings-tool-permissions">
      <VStack padding={compact ? 0 : 4} width="100%">
        <VStack gap={3} width="100%">
          <HStack gap={3} vAlign="start" wrap="wrap">
            {!compact ? <Icon icon={Shield} size="md" /> : null}
            <StackItem size="fill">
              <VStack gap={1}>
                {!compact ? (
                  <Heading level={2}>{t("settings.toolPermissionsTitle")}</Heading>
                ) : null}
                <Text type="supporting" color="secondary">
                  {t("settings.toolPermissionsDesc")}
                </Text>
              </VStack>
            </StackItem>
            {Object.keys(policies).length > 0 ? (
              <Button
                type="button"
                label={t("settings.toolPermissionsReset")}
                variant="ghost"
                size={compact ? "lg" : "sm"}
                onClick={() => setSettings(resetToolPolicies)}
              />
            ) : null}
          </HStack>
          <Grid columns={{ minWidth: 140, max: 3, repeat: "fit" }} gap={2} width="100%">
            <Text type="supporting" color="secondary">
              {t("settings.toolPolicyAllowDesc")}
            </Text>
            <Text type="supporting" color="secondary">
              {t("settings.toolPolicyAskDesc")}
            </Text>
            <Text type="supporting" color="secondary">
              {t("settings.toolPolicyDenyDesc")}
            </Text>
          </Grid>
        </VStack>
      </VStack>

      {!nativeMobile ? (
        <SettingsRowGroup title={t("settings.commandSafety.title")} hideTitle>
          <SettingsRow
            label={t("settings.commandSafety.title")}
            description={t("settings.commandSafety.desc")}
          >
            <Selector
              label={t("settings.commandSafety.title")}
              isLabelHidden
              size={compact ? "lg" : "md"}
              presentation={compact ? "adaptive" : undefined}
              value={settings.system.commandSafetyMode}
              options={COMMAND_SAFETY_OPTIONS.map((mode) => ({
                value: mode,
                label: t(`settings.commandSafety.${mode}`),
                description: t(`settings.commandSafety.${mode}Desc`),
              }))}
              onChange={(mode) =>
                setSettings((prev) =>
                  updateSystem(prev, { commandSafetyMode: mode as CommandSafetyMode }),
                )
              }
            />
          </SettingsRow>
        </SettingsRowGroup>
      ) : null}

      {BUILTIN_TOOL_CATEGORIES.map((category) => {
        const tools = settingsToolsForCategory(category.id, nativeMobile);
        if (tools.length === 0) return null;
        const toolNames = tools.map((tool) => tool.toolName);
        return (
          <Section key={category.id} padding={0} width="100%">
            <HStack
              gap={3}
              hAlign="between"
              vAlign="center"
              padding={3}
              className="settings-tool-permissions-category-header"
            >
              <Heading level={3}>{t(category.labelKey)}</Heading>
              {compact ? (
                <Grid
                  columns={{ minWidth: 80, max: 3 }}
                  gap={2}
                  width="100%"
                  role="group"
                  aria-label={t("settings.toolPermissionsApplyCategory")}
                  className="compact-policy-actions"
                >
                  {POLICY_OPTIONS.map((policy) => (
                    <Button
                      key={policy}
                      type="button"
                      label={t(`settings.toolPolicy.${policy}`)}
                      variant="ghost"
                      size="lg"
                      width="100%"
                      className="settings-wrapping-action"
                      tooltip={`${t("settings.toolPermissionsApplyCategory")} ${t(`settings.toolPolicy.${policy}`)}`}
                      onClick={() => setCategoryPolicy(toolNames, policy)}
                    />
                  ))}
                </Grid>
              ) : (
                <ButtonGroup label={t("settings.toolPermissionsApplyCategory")} size="sm">
                  {POLICY_OPTIONS.map((policy) => (
                    <Button
                      key={policy}
                      type="button"
                      label={t(`settings.toolPolicy.${policy}`)}
                      variant="ghost"
                      size="sm"
                      tooltip={`${t("settings.toolPermissionsApplyCategory")} ${t(`settings.toolPolicy.${policy}`)}`}
                      onClick={() => setCategoryPolicy(toolNames, policy)}
                    />
                  ))}
                </ButtonGroup>
              )}
            </HStack>
            <List density="balanced" hasDividers>
              {tools.map((tool) => {
                const policy = policies[tool.toolName] ?? "allow";
                const nameKey = `settings.builtinTool.${tool.id}.name`;
                const descKey = `settings.builtinTool.${tool.id}.desc`;
                const translatedName = t(nameKey);
                const translatedDesc = t(descKey);
                return (
                  <ListItem
                    className="settings-control-row settings-tool-policy-row"
                    key={tool.id}
                    label={
                      compact ? (
                        <Text type="body" wordBreak="break-word">
                          {translatedName === nameKey ? tool.toolName : translatedName}
                        </Text>
                      ) : translatedName === nameKey ? (
                        tool.toolName
                      ) : (
                        translatedName
                      )
                    }
                    description={
                      <VStack gap={1}>
                        {compact ? (
                          <Text type="supporting" color="secondary" wordBreak="break-word">
                            {tool.toolName}
                          </Text>
                        ) : null}
                        <Text type="supporting" color="secondary" wordBreak="break-word">
                          {translatedDesc === descKey ? tool.toolName : translatedDesc}
                        </Text>
                      </VStack>
                    }
                    startContent={compact ? undefined : <Code>{tool.toolName}</Code>}
                    endContent={
                      compact ? (
                        <SettingsValueSelector
                          value={policy}
                          onChange={(value) => setToolPolicy(tool.toolName, value as ToolPolicy)}
                          label={translatedName === nameKey ? tool.toolName : translatedName}
                          isLabelHidden
                          options={POLICY_OPTIONS.map((option) => ({
                            value: option,
                            label: t(`settings.toolPolicy.${option}`),
                          }))}
                        />
                      ) : (
                        <Selector
                          value={policy}
                          onChange={(value) => setToolPolicy(tool.toolName, value as ToolPolicy)}
                          label={translatedName === nameKey ? tool.toolName : translatedName}
                          isLabelHidden
                          size="sm"
                          options={POLICY_OPTIONS.map((option) => ({
                            value: option,
                            label: t(`settings.toolPolicy.${option}`),
                          }))}
                        />
                      )
                    }
                  />
                );
              })}
            </List>
          </Section>
        );
      })}
    </VStack>
  );
}
