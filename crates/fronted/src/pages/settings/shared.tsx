import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import type { ComponentProps, ReactNode } from "react";

export {
  ConfirmActionPopover,
  ConfirmDeletePopover,
} from "../../components/astryx/ConfirmActionPopover";

export function SettingsRowGroup(props: {
  title: string;
  children: ReactNode;
  tone?: "default" | "danger";
  hideTitle?: boolean;
  titleEndContent?: ReactNode;
}) {
  return (
    <VStack as="section" className="settings-row-group" gap={2} width="100%">
      {props.hideTitle ? null : (
        <HStack className="settings-row-group-heading" width="100%" gap={3}>
          <Heading
            level={3}
            color="secondary"
            style={props.tone === "danger" ? { color: "var(--color-error)" } : undefined}
          >
            {props.title}
          </Heading>
          {props.titleEndContent}
        </HStack>
      )}
      <List density="spacious" hasDividers>
        {props.children}
      </List>
    </VStack>
  );
}

export function SettingsRow(props: {
  label: string;
  icon?: ReactNode;
  description?: string;
  children: ReactNode;
  align?: "center" | "start";
  controlLayout?: "value";
}) {
  return (
    <ListItem
      className="settings-control-row"
      data-control-layout={props.controlLayout}
      label={
        <Text type="body" wordBreak="break-word">
          {props.label}
        </Text>
      }
      startContent={props.icon}
      description={
        props.description ? (
          <Text type="supporting" color="secondary" wordBreak="break-word">
            {props.description}
          </Text>
        ) : undefined
      }
      endContent={
        <HStack hAlign="end" vAlign={props.align === "start" ? "start" : "center"} wrap="wrap">
          {props.children}
        </HStack>
      }
    />
  );
}

/** A current value beside its label, with the same adaptive picker as a form field. */
export function SettingsValueSelector(props: ComponentProps<typeof Selector>) {
  return (
    <Selector
      {...props}
      variant="ghost"
      size="lg"
      width="auto"
      presentation="adaptive"
      renderValue={(option) => (
        <Text type="body" color="secondary" wordBreak="break-word">
          {option.label}
        </Text>
      )}
    />
  );
}

export function SettingsNavigationRow(props: {
  label: string;
  icon: ReactNode;
  status?: string;
  chevron: ReactNode;
  onClick: () => void;
}) {
  return (
    <ListItem
      className="settings-navigation-row"
      label={
        <Text type="body" wordBreak="break-word">
          {props.label}
        </Text>
      }
      startContent={props.icon}
      endContent={
        <HStack gap={2} vAlign="center" style={{ minWidth: 0 }}>
          {props.status ? (
            <Text
              type="body"
              color="secondary"
              wordBreak="break-word"
              className="settings-navigation-status"
            >
              {props.status}
            </Text>
          ) : null}
          {props.chevron}
        </HStack>
      }
      onClick={props.onClick}
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
