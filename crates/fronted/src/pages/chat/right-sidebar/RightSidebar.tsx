import { DropdownMenu, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { type ReactNode, useEffect, useRef } from "react";
import { browserSessionController } from "../../../lib/browser/browserSessionController";
import { tabForKey } from "./tabState";
import "./rightSidebar.css";

import {
  Globe,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelRightClose,
  Plus,
  Terminal,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";

export type RightSidebarTab = {
  id: string;
  label: string;
  icon: ReactNode;
};

export type RightSidebarPresentation = "side" | "fullscreen";

export function RightSidebar(props: {
  tabs: readonly RightSidebarTab[];
  activeTabId: string | null;
  presentation: RightSidebarPresentation;
  width: number | string;
  children?: ReactNode;
  onSelectTab: (tabId: string) => void;
  onNewBrowser: () => void;
  onNewTerminal: () => void;
  onNewSideChat: () => void;
  onCloseTab: (tabId: string) => void;
  terminalDisabled?: boolean;
  browserDisabled?: boolean;
  onPresentationChange: (presentation: RightSidebarPresentation) => void;
  onClose: () => void;
  visible?: boolean;
}) {
  const { t } = useLocale();
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = stripRef.current?.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [props.activeTabId, props.visible]);
  const menuItems: DropdownMenuOption[] = [
    {
      label: t("browser.title"),
      isDisabled: props.browserDisabled,
      icon: <Icon icon={Globe} size="sm" color="inherit" />,
      onClick: props.onNewBrowser,
    },
    {
      label: t("sidebar.terminal"),
      isDisabled: props.terminalDisabled,
      icon: <Icon icon={Terminal} size="sm" color="inherit" />,
      onClick: props.onNewTerminal,
    },
    {
      label: t("chat.newConversation"),
      description: t("chat.split.empty"),
      icon: <Icon icon={MessageSquare} size="sm" color="inherit" />,
      onClick: props.onNewSideChat,
    },
  ];

  return (
    <VStack
      as="aside"
      width={props.presentation === "fullscreen" ? "100%" : props.width}
      height="100%"
      minHeight={0}
      gap={0}
      role="complementary"
      aria-label={t("chat.resizeAuxiliaryPanel")}
      style={{
        flex: props.presentation === "fullscreen" ? "1 1 auto" : "0 0 auto",
        minWidth: 0,
        maxWidth: "100%",
        display: props.visible === false ? "none" : undefined,
        borderInlineStart: "var(--border-width) solid var(--color-border)",
        background: "var(--color-background-primary)",
      }}
    >
      <HStack
        width="100%"
        gap={1}
        vAlign="center"
        paddingInline={2}
        style={{
          minHeight: "44px",
          flexShrink: 0,
          borderBlockEnd: "var(--border-width) solid var(--color-border)",
        }}
      >
        <HStack gap={1} vAlign="center" style={{ minWidth: 0, flex: "1 1 auto" }}>
          {props.tabs.length > 0 ? (
            <HStack
              ref={stripRef}
              role="tablist"
              aria-label={t("chat.resizeAuxiliaryPanel")}
              gap={1}
              className="right-sidebar-tab-strip"
            >
              {props.tabs.map((tab) => (
                <HStack
                  key={tab.id}
                  role="presentation"
                  gap={0}
                  vAlign="center"
                  className="right-sidebar-tab"
                  data-active={props.activeTabId === tab.id}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={props.activeTabId === tab.id}
                    aria-controls="xgent-right-tab-panel"
                    tabIndex={props.activeTabId === tab.id ? 0 : -1}
                    title={tab.label}
                    onClick={() => props.onSelectTab(tab.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Delete") {
                        event.preventDefault();
                        props.onCloseTab(tab.id);
                        return;
                      }
                      const next = tabForKey(
                        props.tabs.map((item) => item.id),
                        tab.id,
                        event.key,
                        getComputedStyle(event.currentTarget).direction === "rtl",
                      );
                      if (!next) return;
                      event.preventDefault();
                      props.onSelectTab(next);
                      const index = props.tabs.findIndex((item) => item.id === next);
                      stripRef.current
                        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                        [index]?.focus();
                    }}
                  >
                    {tab.icon}
                    <span className="right-sidebar-tab-label">{tab.label}</span>
                  </button>
                  <IconButton
                    label={`${t("browser.closeTab")}: ${tab.label}`}
                    tooltip={t("browser.closeTab")}
                    icon={<Icon icon={X} size="sm" color="inherit" />}
                    variant="ghost"
                    size="sm"
                    tabIndex={-1}
                    onClick={() => props.onCloseTab(tab.id)}
                  />
                </HStack>
              ))}
            </HStack>
          ) : null}
          <DropdownMenu
            button={{
              label: t("chat.upload.add"),
              tooltip: t("chat.upload.add"),
              icon: <Icon icon={Plus} size="sm" color="inherit" />,
              isIconOnly: true,
              variant: "ghost",
              size: "sm",
            }}
            items={menuItems}
            onOpenChange={browserSessionController.setSurfaceOccluded}
            placement="below"
            alignment="end"
            hasChevron={false}
          />
        </HStack>
        <IconButton
          label={
            props.presentation === "fullscreen"
              ? t("browser.restoreSidePanel")
              : t("browser.maximize")
          }
          tooltip={
            props.presentation === "fullscreen"
              ? t("browser.restoreSidePanel")
              : t("browser.maximize")
          }
          icon={
            <Icon
              icon={props.presentation === "fullscreen" ? Minimize2 : Maximize2}
              size="sm"
              color="inherit"
            />
          }
          variant="ghost"
          size="sm"
          onClick={() =>
            props.onPresentationChange(props.presentation === "fullscreen" ? "side" : "fullscreen")
          }
        />
        <IconButton
          label={t("browser.close")}
          tooltip={t("browser.close")}
          icon={<Icon icon={PanelRightClose} size="sm" color="inherit" />}
          variant="ghost"
          size="sm"
          onClick={props.onClose}
        />
      </HStack>
      <StackItem
        id="xgent-right-tab-panel"
        role="tabpanel"
        aria-label={props.tabs.find((tab) => tab.id === props.activeTabId)?.label}
        size="fill"
        className="right-sidebar-tab-panel"
        style={{ minHeight: 0, minWidth: 0, overflow: "hidden" }}
      >
        {props.children ? (
          props.children
        ) : (
          <EmptyState
            isCompact
            icon={<Icon icon={Plus} size="lg" color="secondary" />}
            title={t("chat.upload.add")}
            description={t("chat.split.empty")}
          />
        )}
      </StackItem>
    </VStack>
  );
}
