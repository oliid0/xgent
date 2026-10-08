import { DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import type { ReactNode } from "react";

/** Explicit header insets and a touch-sized close control for zero-padding detail dialogs. */
export function CompactDialogHeader(props: {
  title: string;
  subtitle?: string;
  startContent?: ReactNode;
  endContent?: ReactNode;
  compact: boolean;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <VStack padding={4} width="100%" gap={0}>
      <DialogHeader
        title={props.title}
        subtitle={props.subtitle}
        startContent={props.startContent}
        endContent={
          <HStack gap={2} vAlign="center">
            {props.endContent}
            <IconButton
              label={props.closeLabel}
              variant="ghost"
              size={props.compact ? "lg" : "md"}
              icon={<Icon icon="close" size="sm" color="inherit" />}
              onClick={props.onClose}
            />
          </HStack>
        }
      />
    </VStack>
  );
}
