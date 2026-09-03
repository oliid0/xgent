import { Center } from "@astryxdesign/core/Center";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { ReactNode } from "react";
import { Menu, Search } from "../../../components/icons";

type MobileHubHeaderProps = {
  title: string;
  onOpenSidebar: () => void;
  trailing?: ReactNode;
};

/**
 * Shared navigation chrome for touch-first top-level pages.
 *
 * Keeping the header and search treatment here prevents Skills, MCP and later
 * mobile workspace pages from drifting into separate, desktop-derived layouts.
 */
export function MobileHubHeader(props: MobileHubHeaderProps) {
  return (
    <VStack
      as="header"
      gap={0}
      paddingInline={4}
      paddingBlock={3}
      className="shrink-0 border-b border-border bg-background"
    >
      <HStack
        gap={3}
        vAlign="center"
        minHeight="var(--xgent-mobile-header-action-size)"
        width="100%"
      >
        <IconButton
          label={props.title}
          tooltip={props.title}
          icon={<Menu />}
          size="lg"
          variant="secondary"
          onClick={props.onOpenSidebar}
        />
        <StackItem size="fill">
          <Heading level={1} maxLines={1} justify="center">
            {props.title}
          </Heading>
        </StackItem>
        <Center
          width="var(--xgent-mobile-header-action-size)"
          height="var(--xgent-mobile-header-action-size)"
        >
          {props.trailing}
        </Center>
      </HStack>
    </VStack>
  );
}

export function MobileHubSearch(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <HStack paddingInline={4} paddingBlock={3} className="mobile-hub-floating-search">
      <TextInput
        label={props.placeholder}
        isLabelHidden
        startIcon={Search}
        hasClear
        size="lg"
        width="100%"
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
      />
    </HStack>
  );
}

export function MobileToggle(props: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch
      label={props.label}
      isLabelHidden
      value={props.checked}
      isDisabled={props.disabled}
      onChange={props.onChange}
      size="md"
    />
  );
}
