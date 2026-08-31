import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import type { ReactNode } from "react";

export {
  ConfirmActionPopover,
  ConfirmDeletePopover,
} from "../../components/astryx/ConfirmActionPopover";

export function SettingsRowGroup(props: {
  title: string;
  children: ReactNode;
  tone?: "default" | "danger";
  hideTitle?: boolean;
}) {
  return (
    <VStack as="section" gap={2} width="100%">
      {props.hideTitle ? null : (
        <Heading
          level={3}
          color="secondary"
          style={props.tone === "danger" ? { color: "var(--color-error)" } : undefined}
        >
          {props.title}
        </Heading>
      )}
      <List density="spacious" hasDividers>
        {props.children}
      </List>
    </VStack>
  );
}

export function SettingsRow(props: {
  label: string;
  description?: string;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <ListItem
      label={props.label}
      description={props.description}
      endContent={
        <HStack hAlign="end" vAlign={props.align === "start" ? "start" : "center"} wrap="wrap">
          {props.children}
        </HStack>
      }
    />
  );
}

export function PromptTag({ label, muted = false }: { label: string; muted?: boolean }) {
  return <Token label={label} color={muted ? "gray" : "blue"} size="sm" />;
}

export function AgentActivationSwitch(props: {
  checked: boolean;
  title: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const { checked, title, disabled = false, onToggle } = props;

  return (
    <Switch
      label={title}
      isLabelHidden
      value={checked}
      isDisabled={disabled}
      disabledMessage={disabled ? title : undefined}
      onChange={() => onToggle()}
    />
  );
}
