import { Button } from "@astryxdesign/core/Button";
import { ButtonGroup } from "@astryxdesign/core/ButtonGroup";
import { Code } from "@astryxdesign/core/CodeBlock";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Shield } from "../../components/icons";
import { useLocale } from "../../i18n";
import { type CommandSafetyMode, type ToolPolicy, updateSystem } from "../../lib/settings";
import { BUILTIN_TOOL_CATALOG, BUILTIN_TOOL_CATEGORIES } from "../../lib/tools/builtinToolCatalog";
import type { SettingsSectionProps } from "./types";

const POLICY_OPTIONS: readonly ToolPolicy[] = ["allow", "ask", "deny"];
const COMMAND_SAFETY_OPTIONS: readonly CommandSafetyMode[] = [
  "auto",
  "ask",
  "sandbox",
  "sandboxOffline",
];

export function ToolPermissionsSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const policies = settings.system.toolPolicies ?? {};

  const setToolPolicies = (nextPolicies: Record<string, ToolPolicy>) => {
    setSettings((prev) =>
      updateSystem(prev, {
        toolPolicies: Object.keys(nextPolicies).length > 0 ? nextPolicies : undefined,
      }),
    );
  };

  const setToolPolicy = (toolName: string, policy: ToolPolicy) => {
    setToolPolicies({ ...policies, [toolName]: policy });
  };

  const setCategoryPolicy = (toolNames: readonly string[], policy: ToolPolicy) => {
    const next = { ...policies };
    for (const toolName of toolNames) next[toolName] = policy;
    setToolPolicies(next);
  };

  return (
    <VStack gap={5} className="settings-tool-permissions">
      <Section padding={4} width="100%">
        <VStack gap={3}>
          <HStack gap={3} vAlign="start">
            <Shield />
            <StackItem size="fill">
              <VStack gap={1}>
                <Heading level={2}>
                  {t("settings.toolPermissionsTitle")}
                </Heading>
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
                size="sm"
                onClick={() => setToolPolicies({})}
              />
            ) : null}
          </HStack>
          <Grid columns={3} gap={2} width="100%">
            <Text type="supporting" color="secondary" justify="center">
              {t("settings.toolPolicyAllowDesc")}
            </Text>
            <Text type="supporting" color="secondary" justify="center">
              {t("settings.toolPolicyAskDesc")}
            </Text>
            <Text type="supporting" color="secondary" justify="center">
              {t("settings.toolPolicyDenyDesc")}
            </Text>
          </Grid>
        </VStack>
      </Section>

      <Section padding={4} width="100%">
        <VStack gap={3}>
          <VStack gap={1}>
            <Heading level={3}>
              {t("settings.commandSafety.title")}
            </Heading>
            <Text type="supporting" color="secondary">
              {t("settings.commandSafety.desc")}
            </Text>
          </VStack>
          <Grid columns={{ minWidth: 220, max: 2, repeat: "fit" }} gap={2} width="100%">
            {COMMAND_SAFETY_OPTIONS.map((mode) => (
              <SelectableCard
                key={mode}
                label={t(`settings.commandSafety.${mode}`)}
                isSelected={settings.system.commandSafetyMode === mode}
                onChange={() =>
                  setSettings((prev) => updateSystem(prev, { commandSafetyMode: mode }))
                }
                padding={3}
                width="100%"
              >
                <VStack gap={1}>
                  <Text type="body" weight="medium">
                    {t(`settings.commandSafety.${mode}`)}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {t(`settings.commandSafety.${mode}Desc`)}
                  </Text>
                </VStack>
              </SelectableCard>
            ))}
          </Grid>
        </VStack>
      </Section>

      {BUILTIN_TOOL_CATEGORIES.map((category) => {
        const tools = BUILTIN_TOOL_CATALOG.filter((tool) => tool.categoryId === category.id);
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
              <Heading level={3}>
                {t(category.labelKey)}
              </Heading>
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
                    key={tool.id}
                    label={translatedName === nameKey ? tool.toolName : translatedName}
                    description={translatedDesc === descKey ? tool.toolName : translatedDesc}
                    startContent={<Code>{tool.toolName}</Code>}
                    endContent={
                      <SegmentedControl
                        value={policy}
                        onChange={(value) => setToolPolicy(tool.toolName, value as ToolPolicy)}
                        label={tool.toolName}
                        size="sm"
                      >
                        {POLICY_OPTIONS.map((option) => (
                          <SegmentedControlItem
                            key={option}
                            value={option}
                            label={t(`settings.toolPolicy.${option}`)}
                          />
                        ))}
                      </SegmentedControl>
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
