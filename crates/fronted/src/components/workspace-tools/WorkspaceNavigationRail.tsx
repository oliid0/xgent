import { DropdownMenu, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { type ReactNode, useState } from "react";

import { useLocale } from "../../i18n";
import type { AppUpdateController } from "../../lib/appUpdates";
import { useSoul } from "../../lib/soul";
import { AppUpdateButton } from "../AppUpdateButton";
import {
  Cable,
  Check,
  Cpu,
  FolderTree,
  GitBranch,
  Key,
  MessageSquare,
  PanelLeft,
  Plus,
  Settings,
  SkillIcon,
  Sparkles,
  SquarePen,
  Terminal,
} from "../icons";
import { MacOsTitleBarSpacer } from "../MacOsTitleBarSpacer";
import type {
  WorkspaceNavigationTarget,
  WorkspaceToolTarget,
} from "../project-tools/workspaceToolsModel";

type WorkspaceNavigationRailProps = {
  activeTarget: WorkspaceNavigationTarget;
  panelOpen: boolean;
  workspaceToolsAvailable: boolean;
  fileTreeAvailable: boolean;
  appUpdate?: AppUpdateController;
  onTogglePanel: () => void;
  onNewConversation: () => void;
  onSelect: (target: WorkspaceNavigationTarget, shell?: string) => void;
  onOpenSettings: () => void;
  onCreateSoul: () => void;
};

type RailItem = {
  target: WorkspaceNavigationTarget;
  label: string;
  icon: typeof MessageSquare;
  enabled?: boolean;
};

export function WorkspaceNavigationRail(props: WorkspaceNavigationRailProps) {
  const { t } = useLocale();
  const soul = useSoul();
  const [soulMenuOpen, setSoulMenuOpen] = useState(false);

  const items: RailItem[] = [
    { target: "conversations", label: t("chat.recentConversation"), icon: MessageSquare },
    { target: "mcp", label: "MCP", icon: Cable },
    { target: "skills", label: "Skills", icon: SkillIcon },
    {
      target: "fileTree",
      label: t("sidebar.myFiles"),
      icon: FolderTree,
      enabled: props.fileTreeAvailable,
    },
  ];

  const selectFromSoulMenu = (target: WorkspaceToolTarget, shell?: string) => {
    setSoulMenuOpen(false);
    props.onSelect(target, shell);
  };

  const soulMenuItems: DropdownMenuOption[] = [
    {
      type: "section",
      title: t("sidebar.soulPresets"),
      items: soul.presets.map((preset) => ({
        id: preset.id,
        label: preset.metadata.name || "XGent",
        icon: <Icon icon={Sparkles} size="sm" color="inherit" />,
        endContent:
          preset.id === soul.activeId ? <Icon icon={Check} size="sm" color="success" /> : undefined,
        onClick: () => {
          void soul.select(preset.id).catch(() => undefined);
        },
      })),
    },
    {
      label: t("sidebar.addSoul"),
      icon: <Icon icon={Plus} size="sm" color="inherit" />,
      onClick: props.onCreateSoul,
    },
    { type: "divider" },
    {
      label: t("sidebar.terminal"),
      icon: <Icon icon={Terminal} size="sm" color="inherit" />,
      isDisabled: !props.workspaceToolsAvailable,
      onClick: () => selectFromSoulMenu("terminal"),
    },
    ...(
      [
        { target: "gitReview" as const, label: t("sidebar.gitReview"), icon: GitBranch },
        {
          target: "sshConnection" as const,
          label: t("sidebar.sshConnection"),
          icon: Key,
        },
        {
          target: "backgroundTasks" as const,
          label: t("sidebar.backgroundTasks"),
          icon: Cpu,
        },
      ] satisfies Array<{
        target: WorkspaceToolTarget;
        label: string;
        icon: typeof MessageSquare;
      }>
    ).map((item) => ({
      label: item.label,
      icon: <Icon icon={item.icon} size="sm" color="inherit" />,
      isDisabled: !props.workspaceToolsAvailable,
      onClick: () => selectFromSoulMenu(item.target),
    })),
    { type: "divider" },
    {
      label: t("tooltip.settings"),
      icon: <Icon icon={Settings} size="sm" color="inherit" />,
      onClick: props.onOpenSettings,
    },
  ];

  const footerIcons: ReactNode = (
    <>
      {props.appUpdate?.showUpdateButton ? (
        <AppUpdateButton appUpdate={props.appUpdate} iconOnly />
      ) : null}
      <DropdownMenu
        button={{
          label: t("sidebar.soulMenu"),
          icon: <Icon icon={Sparkles} size="sm" color="accent" />,
          isIconOnly: true,
          variant: "ghost",
          size: "sm",
          tooltip: t("sidebar.soulMenu"),
        }}
        items={soulMenuItems}
        isMenuOpen={soulMenuOpen}
        onOpenChange={setSoulMenuOpen}
        menuWidth="var(--xgent-soul-menu-width)"
        placement="end"
        alignment="end"
        hasChevron={false}
      />
    </>
  );

  return (
    <SideNav
      header={<MacOsTitleBarSpacer />}
      topContent={
        <SideNavSection title={t("sidebar.navigation")} isHeaderHidden>
          <SideNavItem
            label={props.panelOpen ? t("sidebar.closeSidebar") : t("sidebar.openSidebar")}
            icon={PanelLeft}
            isSelected={props.panelOpen}
            onClick={props.onTogglePanel}
            size="sm"
          />
          <SideNavItem
            label={t("chat.newConversation")}
            icon={SquarePen}
            onClick={props.onNewConversation}
            size="sm"
          />
        </SideNavSection>
      }
      footerIcons={footerIcons}
      collapsible={{ isCollapsed: true, onCollapsedChange: () => undefined, hasButton: false }}
      style={{
        height: "100%",
        flexShrink: 0,
        zIndex: "var(--xgent-z-workspace-navigation)",
      }}
    >
      <SideNavSection title={t("sidebar.navigation")} isHeaderHidden>
        {items.map((item) => (
          <SideNavItem
            key={item.target}
            label={item.label}
            icon={item.icon}
            size="sm"
            isSelected={props.panelOpen && props.activeTarget === item.target}
            isDisabled={item.enabled === false}
            onClick={() => props.onSelect(item.target)}
          />
        ))}
      </SideNavSection>
    </SideNav>
  );
}
