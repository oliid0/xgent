import { Shield } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  type CommandSafetyMode,
  type ToolPolicy,
  updateSystem,
} from "../../lib/settings";
import {
  BUILTIN_TOOL_CATALOG,
  BUILTIN_TOOL_CATEGORIES,
} from "../../lib/tools/builtinToolCatalog";
import { cn } from "../../lib/shared/utils";
import type { SettingsSectionProps } from "./types";

const POLICY_OPTIONS: readonly ToolPolicy[] = ["allow", "ask", "deny"];
const COMMAND_SAFETY_OPTIONS: readonly CommandSafetyMode[] = [
  "auto",
  "ask",
  "sandbox",
  "sandboxOffline",
];

function policyTone(policy: ToolPolicy, selected: boolean) {
  if (!selected) return "text-muted-foreground hover:bg-muted/60 hover:text-foreground";
  if (policy === "allow") {
    return "bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300";
  }
  if (policy === "ask") {
    return "bg-amber-500/12 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300";
  }
  return "bg-rose-500/12 text-rose-700 ring-1 ring-rose-500/25 dark:text-rose-300";
}

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
    <div className="settings-tool-permissions space-y-5">
      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
            <Shield className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              {t("settings.toolPermissionsTitle")}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.toolPermissionsDesc")}
            </p>
          </div>
          {Object.keys(policies).length > 0 ? (
            <button
              type="button"
              onClick={() => setToolPolicies({})}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t("settings.toolPermissionsReset")}
            </button>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-2 text-center text-[11px] text-muted-foreground">
          <span>{t("settings.toolPolicyAllowDesc")}</span>
          <span>{t("settings.toolPolicyAskDesc")}</span>
          <span>{t("settings.toolPolicyDenyDesc")}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("settings.commandSafety.title")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("settings.commandSafety.desc")}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {COMMAND_SAFETY_OPTIONS.map((mode) => {
            const selected = settings.system.commandSafetyMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() =>
                  setSettings((prev) => updateSystem(prev, { commandSafetyMode: mode }))
                }
                className={cn(
                  "rounded-xl border px-3 py-2 text-left transition-colors",
                  selected
                    ? "border-indigo-500/35 bg-indigo-500/8 ring-1 ring-indigo-500/15"
                    : "border-border/55 hover:bg-muted/50",
                )}
              >
                <span className="block text-xs font-medium text-foreground">
                  {t(`settings.commandSafety.${mode}`)}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  {t(`settings.commandSafety.${mode}Desc`)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {BUILTIN_TOOL_CATEGORIES.map((category) => {
        const tools = BUILTIN_TOOL_CATALOG.filter((tool) => tool.categoryId === category.id);
        if (tools.length === 0) return null;
        const toolNames = tools.map((tool) => tool.toolName);
        return (
          <section
            key={category.id}
            className="overflow-hidden rounded-2xl border border-border/60 bg-card"
          >
            <div className="settings-tool-permissions-category-header flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">{t(category.labelKey)}</h3>
              <div className="settings-tool-permissions-category-actions flex shrink-0 items-center rounded-lg bg-muted/45 p-0.5">
                {POLICY_OPTIONS.map((policy) => (
                  <button
                    key={policy}
                    type="button"
                    onClick={() => setCategoryPolicy(toolNames, policy)}
                    className="rounded-md px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    title={`${t("settings.toolPermissionsApplyCategory")} ${t(`settings.toolPolicy.${policy}`)}`}
                  >
                    {t(`settings.toolPolicy.${policy}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-border/40">
              {tools.map((tool) => {
                const policy = policies[tool.toolName] ?? "allow";
                const nameKey = `settings.builtinTool.${tool.id}.name`;
                const descKey = `settings.builtinTool.${tool.id}.desc`;
                const translatedName = t(nameKey);
                const translatedDesc = t(descKey);
                return (
                  <div
                    key={tool.id}
                    className="settings-tool-permissions-row flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {translatedName === nameKey ? tool.toolName : translatedName}
                        </span>
                        <code className="truncate text-[10px] text-muted-foreground/70">
                          {tool.toolName}
                        </code>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {translatedDesc === descKey ? tool.toolName : translatedDesc}
                      </p>
                    </div>
                    <div
                      className="settings-tool-permissions-policies grid shrink-0 grid-cols-3 rounded-xl bg-muted/45 p-1"
                      role="radiogroup"
                      aria-label={tool.toolName}
                    >
                      {POLICY_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={policy === option}
                          onClick={() => setToolPolicy(tool.toolName, option)}
                          className={cn(
                            "min-w-[3.25rem] rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                            policyTone(option, policy === option),
                          )}
                        >
                          {t(`settings.toolPolicy.${option}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
