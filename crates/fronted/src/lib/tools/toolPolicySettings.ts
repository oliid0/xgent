import { type AppSettings, type ToolPolicy, updateSystem } from "../settings";
import { BUILTIN_TOOL_CATALOG } from "./builtinToolCatalog";
import { PERSONAL_POLICY_PREFIX } from "./mobileAssistantPolicy";
import { resolveRuntimeToolCapabilities } from "./runtimeToolCapabilities";

export function settingsToolsForCategory(categoryId: string, nativeMobile: boolean) {
  const capabilities = resolveRuntimeToolCapabilities(nativeMobile ? "native-mobile" : "desktop");
  return BUILTIN_TOOL_CATALOG.filter(
    (tool) =>
      tool.categoryId === categoryId &&
      (tool.toolName !== "ManagedProcess" || capabilities.managedProcess) &&
      (tool.toolName !== "ReadTerminal" || capabilities.terminal),
  );
}

export function patchToolPolicies(
  settings: AppSettings,
  toolNames: readonly string[],
  policy: ToolPolicy,
) {
  return updateSystem(settings, {
    toolPolicies: {
      ...settings.system.toolPolicies,
      ...Object.fromEntries(toolNames.map((name) => [name, policy])),
    },
  });
}

export function resetToolPolicies(settings: AppSettings) {
  return updateSystem(settings, {
    toolPolicies: Object.fromEntries(
      Object.entries(settings.system.toolPolicies ?? {}).filter(([key]) =>
        key.startsWith(PERSONAL_POLICY_PREFIX),
      ),
    ),
  });
}
