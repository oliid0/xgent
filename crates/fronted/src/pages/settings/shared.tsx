import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
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
}) {
  return (
    <VStack as="section" gap={2} width="100%">
      <Heading
        level={3}
        color="secondary"
        style={props.tone === "danger" ? { color: "var(--color-error)" } : undefined}
      >
        {props.title}
      </Heading>
      <Section padding={0} variant="transparent" width="100%">
        <VStack width="100%" gap={2}>
          {props.children}
        </VStack>
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
    <Section variant="transparent" padding={0} dividers={["bottom"]} width="100%">
      <HStack
        width="100%"
        gap={4}
        padding={3}
        wrap="wrap"
        vAlign={props.align === "start" ? "start" : "center"}
      >
        <StackItem size="fill">
          <VStack gap={0.5}>
            <Text type="body" weight="medium" wordBreak="break-word">
              {props.label}
            </Text>
            {props.description ? (
              <Text type="supporting" color="secondary" wordBreak="break-word">
                {props.description}
              </Text>
            ) : null}
          </VStack>
        </StackItem>
        <HStack hAlign="end" vAlign="center" wrap="wrap">
          {props.children}
        </HStack>
      </HStack>
    </Section>
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
