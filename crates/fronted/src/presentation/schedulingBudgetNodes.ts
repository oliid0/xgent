import { budgetLifetimeOptions } from "../lib/subagents/schedulingBudget";
import type { SchedulingBudgetEditor } from "../pages/settings/useSchedulingBudgetEditor";
import { presentationControls } from "./controls";

export function schedulingBudgetNodes(editor: SchedulingBudgetEditor, t: (key: string) => string) {
  const c = presentationControls(editor.scope);
  return {
    nodes: editor.draft
      ? [
          c.group("budget-form", t("schedulingBudget.title"), [
            c.input("requests", t("schedulingBudget.requests"), editor.draft.requests, (value) =>
              editor.patch("requests", value),
            ),
            c.input("tools", t("schedulingBudget.tools"), editor.draft.tools, (value) =>
              editor.patch("tools", value),
            ),
            c.select(
              "lifetime",
              t("schedulingBudget.lifetime"),
              editor.draft.minutes,
              budgetLifetimeOptions(t, editor.draft.minutes),
              (value) => editor.patch("minutes", value),
            ),
            ...(editor.error
              ? [
                  {
                    id: "budget-error",
                    kind: "Banner" as const,
                    label: t(editor.error),
                    status: "error" as const,
                  },
                ]
              : []),
            c.action("save", t("settings.save"), editor.save, !editor.error),
            c.action("cancel", t("settings.cancel"), editor.cancel),
          ]),
        ]
      : [
          {
            ...c.action("budget-open", t("schedulingBudget.title"), editor.open),
            kind: "NavigationRow" as const,
            text: `${editor.config.maxModelRequests} / ${editor.config.maxToolCalls} · ${editor.config.lifetimeMinutes === 0 ? t("schedulingBudget.unlimited") : `${editor.config.lifetimeMinutes} ${t("schedulingBudget.minutes")}`}`,
            icon: "chart.bar",
          },
        ],
    handlers: c.handlers,
  };
}
