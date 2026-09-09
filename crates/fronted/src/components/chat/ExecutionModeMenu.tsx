import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { useLocale } from "../../i18n";
import type { ExecutionMode } from "../../lib/settings";
import { Check, MessageSquare, Wrench } from "../icons";

export function ExecutionModeMenu(props: {
  value: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
}) {
  const { t } = useLocale();
  const mode = props.value === "text" ? "text" : "tools";
  return (
    <DropdownMenu
      button={{
        label: mode === "text" ? "XChat" : "XGent",
        variant: "ghost",
        size: "lg",
        className: "chat-brand-menu",
      }}
      placement="below"
      alignment="start"
      menuWidth={220}
      items={[
        {
          id: "text",
          label: "XChat",
          description: t("chat.mode.chat"),
          icon: <MessageSquare />,
          endContent: mode === "text" ? <Check /> : undefined,
          onClick: () => props.onChange("text"),
        },
        {
          id: "tools",
          label: "XGent",
          description: t("chat.mode.agent"),
          icon: <Wrench />,
          endContent: mode === "tools" ? <Check /> : undefined,
          onClick: () => props.onChange("tools"),
        },
      ]}
    />
  );
}
