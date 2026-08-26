import type { ReactNode } from "react";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";

export {
  ConfirmActionPopover,
  ConfirmDeletePopover,
} from "../../components/ui/confirm-action-popover";

export function SettingsRowGroup(props: {
  title: string;
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <VStack as="section" gap={2} className="settings-row-section mb-7">
      <Heading
        level={3}
        className={`px-1 uppercase tracking-wide ${
          props.tone === "danger" ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {props.title}
      </Heading>
      <Section
        padding={0}
        className={`settings-row-group divide-y overflow-hidden rounded-xl border text-sm ${
          props.tone === "danger" ? "border-destructive/30" : "border-border/70"
        }`}
      >
        {props.children}
      </Section>
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
    <HStack
      gap={4}
      padding={3}
      vAlign={props.align === "start" ? "start" : "center"}
      className="settings-row min-h-14"
    >
      <StackItem size="fill">
        <VStack gap={0.5}>
        <Text type="body" weight="medium">
          {props.label}
        </Text>
        {props.description ? (
          <Text type="supporting" color="secondary">
            {props.description}
          </Text>
        ) : null}
        </VStack>
      </StackItem>
      <HStack hAlign="end" vAlign="center" className="settings-row-control shrink-0">
        {props.children}
      </HStack>
    </HStack>
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
