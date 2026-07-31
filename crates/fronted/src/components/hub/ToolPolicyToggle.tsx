import { useLocale } from "../../i18n";
import type { ToolPolicy } from "../../lib/settings";
import { cn } from "../../lib/shared/utils";

const POLICY_ORDER: readonly ToolPolicy[] = ["allow", "ask", "deny"];
const ACTIVE_STYLE: Record<ToolPolicy, string> = {
  allow: "bg-emerald-500 text-white",
  ask: "bg-amber-500 text-white",
  deny: "bg-red-500 text-white",
};

export function ToolPolicyToggle(props: {
  value: ToolPolicy;
  ariaLabel: string;
  onChange: (next: ToolPolicy) => void;
  size?: "sm" | "md";
}) {
  const { t } = useLocale();
  return (
    <div
      role="radiogroup"
      aria-label={props.ariaLabel}
      className="inline-flex shrink-0 items-center rounded-lg border border-border/60 bg-muted/40 p-0.5"
    >
      {POLICY_ORDER.map((option) => {
        const active = props.value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => props.onChange(option)}
            className={cn(
              "rounded-md font-medium leading-none transition-colors",
              props.size === "sm" ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]",
              active ? ACTIVE_STYLE[option] : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`settings.toolPolicy.${option}`)}
          </button>
        );
      })}
    </div>
  );
}
