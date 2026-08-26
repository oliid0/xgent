import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import type { ReactNode } from "react";

import { useLocale } from "../../i18n";
import { PanelLeft, X } from "../icons";
import { isMacOsTauri, MacOsTitleBarSpacer } from "../MacOsTitleBarSpacer";

type HubTone = "amber" | "violet" | "neutral";

export function HubBackdrop(props: { tone?: HubTone }) {
  return (
    <Center
      aria-hidden="true"
      data-hub-tone={props.tone ?? "neutral"}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        backgroundColor: "var(--color-background-body)",
      }}
    />
  );
}

export function HubHeader(props: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  tone?: HubTone;
  actions?: ReactNode;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onClose?: () => void;
  closeLabel?: string;
}) {
  const {
    icon,
    title,
    subtitle,
    tone = "neutral",
    actions,
    sidebarOpen,
    onOpenSidebar,
    onClose,
    closeLabel,
  } = props;
  const { t } = useLocale();
  const isMacTitleBarOverlay = isMacOsTauri();
  const showSidebarButton = !onClose && !sidebarOpen && !isMacTitleBarOverlay;
  const closeActionLabel = closeLabel ?? t("settings.close");
  const iconBackground =
    tone === "amber"
      ? "var(--color-background-orange)"
      : tone === "violet"
        ? "var(--color-background-purple)"
        : "var(--color-background-muted)";

  return (
    <>
      <MacOsTitleBarSpacer />
      <LayoutHeader
        role="banner"
        label={title}
        hasDivider
        padding={4}
        style={{
          position: "relative",
          zIndex: "var(--xagent-z-hub-header)",
          backgroundColor: "var(--xagent-hub-header-background)",
          backdropFilter: "blur(var(--xagent-hub-header-blur))",
        }}
      >
        {showSidebarButton ? (
          <IconButton
            label={t("tooltip.openSidebar")}
            tooltip={t("tooltip.openSidebar")}
            icon={<Icon icon={PanelLeft} size="sm" color="inherit" />}
            size="md"
            variant="ghost"
            onClick={onOpenSidebar}
            style={{
              position: "absolute",
              insetInlineStart: "var(--spacing-3)",
              insetBlockStart: "var(--spacing-3)",
            }}
          />
        ) : null}
        <HStack
          width="100%"
          maxWidth="var(--xagent-hub-content-max-width)"
          gap={4}
          vAlign="center"
          style={{
            marginInline: "auto",
            paddingInlineStart: showSidebarButton ? "var(--xagent-hub-sidebar-reserve)" : 0,
          }}
        >
          {onClose ? (
            <HStack
              aria-hidden="true"
              width="var(--xagent-hub-header-control-size)"
              height="var(--xagent-hub-header-control-size)"
            />
          ) : (
            <Center
              data-hub-tone={tone}
              style={{
                width: "var(--xagent-hub-header-icon-size)",
                height: "var(--xagent-hub-header-icon-size)",
                flexShrink: 0,
                color: "var(--color-icon-primary)",
                backgroundColor: iconBackground,
                borderRadius: "var(--radius-container)",
              }}
            >
              {icon}
            </Center>
          )}
          <StackItem size="fill">
            <VStack gap={0.5} hAlign={onClose ? "center" : "start"}>
              <Heading level={1}>{title}</Heading>
              {subtitle && !onClose ? (
                <Text
                  type="supporting"
                  color="secondary"
                  maxLines={1}
                  hasTruncateTooltip="below"
                >
                  {subtitle}
                </Text>
              ) : null}
            </VStack>
          </StackItem>
          {actions ? (
            <HStack gap={2} vAlign="center">
              {actions}
            </HStack>
          ) : null}
          {onClose ? (
            <IconButton
              label={closeActionLabel}
              tooltip={closeActionLabel}
              icon={<Icon icon={X} size="md" color="inherit" />}
              size="lg"
              variant="secondary"
              onClick={onClose}
            />
          ) : null}
        </HStack>
      </LayoutHeader>
    </>
  );
}

/** A discrete information surface shared by Skills and MCP hubs. */
export function HubPanel(props: {
  children: ReactNode;
  tone?: "default" | "muted" | "error" | HubTone;
  active?: boolean;
  className?: string;
}) {
  const { children, tone = "default", active = false, className } = props;
  const variant =
    tone === "muted"
      ? "muted"
      : tone === "error"
        ? "red"
        : tone === "amber"
          ? "orange"
          : tone === "violet"
            ? "purple"
            : "default";

  return (
    <Card
      padding={4}
      variant={variant}
      elevation={active ? "low" : "none"}
      className={className}
    >
      {children}
    </Card>
  );
}

export const GlassPanel = HubPanel;

export function HubSegmentedControl(props: { children: ReactNode; className?: string }) {
  return (
    <HStack
      gap={1}
      padding={1}
      vAlign="center"
      wrap="nowrap"
      role="group"
      className={props.className}
      style={{
        minWidth: 0,
        borderRadius: "var(--radius-container)",
        backgroundColor: "var(--color-background-muted)",
        overflowX: "auto",
      }}
    >
      {props.children}
    </HStack>
  );
}

export function HubSegmentedButton(props: {
  active: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <ToggleButton
      label={props.title ?? "View"}
      isPressed={props.active}
      isDisabled={props.disabled}
      size="sm"
      onPressedChange={(_isPressed, event) => {
        event.preventDefault();
        props.onClick();
      }}
      style={{ flexShrink: 0 }}
    >
      {props.children}
    </ToggleButton>
  );
}
