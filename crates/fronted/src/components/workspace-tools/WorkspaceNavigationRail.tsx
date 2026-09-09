import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import type { ReactNode } from "react";

import { useLocale } from "../../i18n";
import type { AppUpdateController } from "../../lib/appUpdates";
import { AppUpdateButton } from "../AppUpdateButton";
import { Cable, FolderTree, MessageSquare, PanelLeft, SkillIcon, SquarePen } from "../icons";
import { MacOsTitleBarSpacer } from "../MacOsTitleBarSpacer";
import type { WorkspaceNavigationTarget } from "../project-tools/workspaceToolsModel";

import { SidebarActionMenu } from "./SidebarActionMenu";

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
  onOpenTrajectory?: () => void;
  trajectoryAvailable?: boolean;
};

type RailItem = {
  target: WorkspaceNavigationTarget;
  label: string;
  icon: typeof MessageSquare;
  enabled?: boolean;
};

export function WorkspaceNavigationRail(props: WorkspaceNavigationRailProps) {
  const { t } = useLocale();

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

  const footerIcons: ReactNode = (
    <>
      {props.appUpdate?.showUpdateButton ? (
        <AppUpdateButton appUpdate={props.appUpdate} iconOnly />
      ) : null}
      <SidebarActionMenu
        workspaceToolsAvailable={props.workspaceToolsAvailable}
        onSelect={props.onSelect}
        onOpenSettings={props.onOpenSettings}
        onCreateSoul={props.onCreateSoul}
        onOpenTrajectory={props.onOpenTrajectory}
        trajectoryAvailable={props.trajectoryAvailable}
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
        width: "100%",
        minWidth: 0,
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
