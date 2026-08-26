import type { ReactNode } from "react";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ArrowLeft } from "../../../components/icons";
import { cn } from "../../../lib/shared/utils";

type MobileFullscreenPanelProps = {
  open: boolean;
  children: ReactNode;
  label: string;
  keepMounted?: boolean;
};

/**
 * A viewport-owned mobile destination. It deliberately uses `fixed` positioning so parent chat
 * transforms, overflow and desktop split panes can never reduce a tool to a responsive drawer.
 */
export function MobileFullscreenPanel(props: MobileFullscreenPanelProps) {
  if (!props.open && !props.keepMounted) return null;
  return (
    <VStack
      as="section"
      gap={0}
      width="100vw"
      height="100dvh"
      data-edge-swipe-ignore
      aria-label={props.label}
      aria-hidden={!props.open}
      className={cn(
        "mobile-fullscreen-panel app-safe-area fixed inset-0 z-[var(--xagent-z-mobile-panel)] min-h-0 overflow-hidden bg-background text-foreground transition-[opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none",
        !props.open &&
          "pointer-events-none translate-x-[var(--xagent-mobile-panel-hidden-offset)] opacity-0",
      )}
    >
      {props.children}
    </VStack>
  );
}

export function MobilePanelHeader(props: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <HStack
      as="header"
      gap={3}
      vAlign="center"
      paddingInline={3}
      className="mobile-panel-header shrink-0 border-b border-border/55 bg-background/90 backdrop-blur-xl"
    >
      <IconButton
        label={props.backLabel}
        tooltip={props.backLabel}
        icon={<ArrowLeft size={20} />}
        variant="ghost"
        size="lg"
        onClick={props.onBack}
      />
      {props.leading}
      <StackItem size="fill">
        <VStack gap={0.5}>
          <Heading level={2} maxLines={1}>
            {props.title}
          </Heading>
          {props.subtitle ? (
            <Text type="supporting" color="secondary" maxLines={1}>
              {props.subtitle}
            </Text>
          ) : null}
        </VStack>
      </StackItem>
      {props.actions}
    </HStack>
  );
}
