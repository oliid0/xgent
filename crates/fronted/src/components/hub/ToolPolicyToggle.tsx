import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { useLocale } from "../../i18n";
import type { ToolPolicy } from "../../lib/settings";

const POLICY_ORDER: readonly ToolPolicy[] = ["allow", "ask", "deny"];
export function ToolPolicyToggle(props: {
  value: ToolPolicy;
  ariaLabel: string;
  onChange: (next: ToolPolicy) => void;
  size?: "sm" | "md";
}) {
  const { t } = useLocale();
  return (
    <SegmentedControl
      value={props.value}
      onChange={(value) => props.onChange(value as ToolPolicy)}
      label={props.ariaLabel}
      size={props.size ?? "md"}
    >
      {POLICY_ORDER.map((option) => (
        <SegmentedControlItem
          key={option}
          value={option}
          label={t(`settings.toolPolicy.${option}`)}
        />
      ))}
    </SegmentedControl>
  );
}
