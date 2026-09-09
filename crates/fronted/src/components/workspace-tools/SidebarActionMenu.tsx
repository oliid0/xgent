import { DropdownMenu, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { useState } from "react";
import { useLocale } from "../../i18n";
import { useSoul } from "../../lib/soul";
import { Activity, Check, Cpu, GitBranch, Key, MessageSquare, Plus, Settings, Sparkles, Terminal } from "../icons";
import type { WorkspaceToolTarget } from "../project-tools/workspaceToolsModel";

type SidebarActionMenuProps = {
  workspaceToolsAvailable: boolean;
  onSelect: (target: WorkspaceToolTarget, shell?: string) => void;
  onOpenSettings: () => void;
  onCreateSoul: () => void;
  onOpenTrajectory?: () => void;
  trajectoryAvailable?: boolean;
};

export function SidebarActionMenu(props: SidebarActionMenuProps) {
  const { t } = useLocale();
  const soul = useSoul();
  const [soulMenuOpen, setSoulMenuOpen] = useState(false);

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
        isDisabled: soul.saving,
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
      label: t("chat.trajectory.open"),
      icon: <Icon icon={Activity} size="sm" color="inherit" />,
      isDisabled: !props.trajectoryAvailable || !props.onOpenTrajectory,
      onClick: () => {
        setSoulMenuOpen(false);
        props.onOpenTrajectory?.();
      },
    },
    {
      label: t("tooltip.settings"),
      icon: <Icon icon={Settings} size="sm" color="inherit" />,
      onClick: props.onOpenSettings,
    },
  ];

  return (
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
  );
}

