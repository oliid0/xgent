import { ListItem } from "@astryxdesign/core/List";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

/** Keep provider details readable while allowing the action group to wrap independently. */
export function ProviderSettingsRow(props: {
  id: string;
  name: string;
  icon: ReactNode;
  description: ReactNode;
  actions: ReactNode;
  isSelected: boolean;
  onEdit: () => void;
}) {
  return (
    <ListItem
      className="settings-provider-row"
      data-provider-reorder-id={props.id}
      isSelected={props.isSelected}
      label={
        <HStack as="span" className="settings-provider-name" gap={2} vAlign="start">
          <StackItem as="span">{props.icon}</StackItem>
          <StackItem as="span" size="fill">
            <Text as="span" type="body" textWrap="wrap">
              {props.name}
            </Text>
          </StackItem>
        </HStack>
      }
      description={
        <VStack as="span" className="settings-provider-description" gap={1}>
          <Text as="span" type="supporting" textWrap="wrap">
            {props.description}
          </Text>
        </VStack>
      }
      endContent={
        <HStack as="span" className="settings-provider-actions" gap={1} wrap="wrap" hAlign="end">
          {props.actions}
        </HStack>
      }
      onClick={props.onEdit}
    />
  );
}
