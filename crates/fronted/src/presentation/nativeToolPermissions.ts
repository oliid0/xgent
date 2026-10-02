import { type CommandSafetyMode, type ToolPolicy, updateSystem } from "../lib/settings";
import { BUILTIN_TOOL_CATALOG, BUILTIN_TOOL_CATEGORIES } from "../lib/tools/builtinToolCatalog";
import { PERSONAL_POLICY_PREFIX } from "../lib/tools/mobileAssistantPolicy";
import { resolveRuntimeToolCapabilities } from "../lib/tools/runtimeToolCapabilities";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

/** Same tool catalog, scope filters and policy operations as ToolPermissionsSection. */
export function createNativeToolPermissions(
  { settings, setSettings }: SettingsSectionProps,
  nativeMobile: boolean,
  t: (key: string) => string,
) {
  const c = presentationControls();
  const capabilities = resolveRuntimeToolCapabilities(nativeMobile ? "native-mobile" : "desktop");
  const policies = settings.system.toolPolicies ?? {};
  const options = (["allow", "ask", "deny"] as const).map((value) => ({
    value,
    label: t(`settings.toolPolicy.${value}`),
  }));
  const patch = (toolNames: string[], policy: ToolPolicy) =>
    setSettings((previous) =>
      updateSystem(previous, {
        toolPolicies: {
          ...previous.system.toolPolicies,
          ...Object.fromEntries(toolNames.map((name) => [name, policy])),
        },
      }),
    );
  const nodes: PresentationNode[] = [
    c.group("tool-policy-summary", t("settings.toolPermissionsTitle"), [
      {
        id: "tool-policy-description",
        kind: "Text",
        text: t("settings.toolPermissionsDesc"),
        secondary: true,
      },
      ...(["allow", "ask", "deny"] as const).map((policy) => ({
        id: `tool-policy-help:${policy}`,
        kind: "Text" as const,
        text: t(
          `settings.toolPolicy${policy === "allow" ? "Allow" : policy === "ask" ? "Ask" : "Deny"}Desc`,
        ),
        secondary: true,
      })),
      ...(Object.keys(policies).some((key) => !key.startsWith(PERSONAL_POLICY_PREFIX))
        ? [
            c.action("tool-policy-reset", t("settings.toolPermissionsReset"), () =>
              setSettings((previous) =>
                updateSystem(previous, {
                  toolPolicies: Object.fromEntries(
                    Object.entries(previous.system.toolPolicies ?? {}).filter(([key]) =>
                      key.startsWith(PERSONAL_POLICY_PREFIX),
                    ),
                  ),
                }),
              ),
            ),
          ]
        : []),
    ]),
  ];
  if (!nativeMobile) {
    const mode = settings.system.commandSafetyMode;
    nodes.push(
      c.group("command-safety", t("settings.commandSafety.title"), [
        c.select(
          "command-safety-mode",
          t("settings.commandSafety.title"),
          mode,
          (["auto", "ask", "sandbox", "sandboxOffline"] as const).map((value) => ({
            value,
            label: t(`settings.commandSafety.${value}`),
          })),
          (value) =>
            setSettings((previous) =>
              updateSystem(previous, { commandSafetyMode: value as CommandSafetyMode }),
            ),
        ),
        {
          id: "command-safety-description",
          kind: "Text",
          text: t("settings.commandSafety.desc"),
          secondary: true,
        },
        {
          id: "command-safety-mode-description",
          kind: "Text",
          text: t(`settings.commandSafety.${mode}Desc`),
          secondary: true,
        },
      ]),
    );
  }
  for (const category of BUILTIN_TOOL_CATEGORIES) {
    const tools = BUILTIN_TOOL_CATALOG.filter(
      (tool) =>
        tool.categoryId === category.id &&
        (tool.toolName !== "ManagedProcess" || capabilities.managedProcess) &&
        (tool.toolName !== "ReadTerminal" || capabilities.terminal),
    );
    if (!tools.length) continue;
    nodes.push(
      c.group(category.id, t(category.labelKey), [
        {
          id: `category:${category.id}:actions`,
          kind: "HStack",
          wrap: true,
          accessibilityLabel: t("settings.toolPermissionsApplyCategory"),
          children: options.map(({ value, label }) =>
            c.action(`category:${category.id}:${value}`, label, () =>
              patch(
                tools.map((tool) => tool.toolName),
                value,
              ),
            ),
          ),
        },
        ...tools.flatMap((tool): PresentationNode[] => {
          const nameKey = `settings.builtinTool.${tool.id}.name`;
          const descKey = `settings.builtinTool.${tool.id}.desc`;
          const name = t(nameKey);
          const description = t(descKey);
          return [
            {
              ...c.select(
                `policy:${tool.toolName}`,
                name === nameKey ? tool.toolName : name,
                policies[tool.toolName] ?? "allow",
                options,
                (value) => patch([tool.toolName], value as ToolPolicy),
              ),
              accessibilityLabel: `${name === nameKey ? tool.toolName : name} (${tool.toolName})`,
            },
            {
              id: `policy:${tool.toolName}:description`,
              kind: "Text",
              text: description === descKey ? tool.toolName : description,
              secondary: true,
            },
          ];
        }),
      ]),
    );
  }
  return { nodes, handlers: c.handlers };
}
