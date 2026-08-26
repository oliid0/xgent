import { DropdownMenu, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import {
  Cpu,
  GitBranch,
  Globe,
  Key,
  MoreHorizontal,
  Package,
  Settings,
  Terminal,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";

type MobileQuickActionsProps = {
  onOpenTerminal: () => void;
  onOpenRootfs: () => void;
  onOpenBrowser: () => void;
  onOpenBrowserSettings: () => void;
  onOpenGitReview: () => void;
  onOpenSsh: () => void;
  onOpenBackgroundTasks: () => void;
};

export function MobileQuickActions(props: MobileQuickActionsProps) {
  const { t } = useLocale();
  const actionGroups = [
    [
      {
        id: "terminal",
        label: t("chat.mobileMenu.terminal"),
        icon: <Terminal className="h-4 w-4" />,
        run: props.onOpenTerminal,
      },
      {
        id: "rootfs",
        label: t("chat.mobileMenu.rootfs"),
        icon: <Package className="h-4 w-4" />,
        run: props.onOpenRootfs,
      },
    ],
    [
      {
        id: "browser",
        label: t("chat.mobileMenu.browser"),
        icon: <Globe className="h-4 w-4" />,
        run: props.onOpenBrowser,
      },
      {
        id: "browser-settings",
        label: t("chat.mobileMenu.browserSettings"),
        icon: <Settings className="h-4 w-4" />,
        run: props.onOpenBrowserSettings,
      },
    ],
    [
      {
        id: "git",
        label: t("chat.mobileMenu.gitReview"),
        icon: <GitBranch className="h-4 w-4" />,
        run: props.onOpenGitReview,
      },
      {
        id: "ssh",
        label: t("chat.mobileMenu.ssh"),
        icon: <Key className="h-4 w-4" />,
        run: props.onOpenSsh,
      },
      {
        id: "background",
        label: t("chat.mobileMenu.background"),
        icon: <Cpu className="h-4 w-4" />,
        run: props.onOpenBackgroundTasks,
      },
    ],
  ];

  const items: DropdownMenuOption[] = actionGroups.map((actions, groupIndex) => ({
    type: "section",
    id: `mobile-actions-${groupIndex}`,
    items: actions.map((action) => ({
      id: action.id,
      label: action.label,
      icon: action.icon,
      onClick: action.run,
    })),
  }));

  return (
    <DropdownMenu
      button={{
        label: t("chat.mobileMenu.title"),
        tooltip: t("chat.mobileMenu.title"),
        icon: <MoreHorizontal />,
        isIconOnly: true,
        variant: "secondary",
        size: "lg",
        elevation: "low",
      }}
      items={items}
      menuWidth="var(--xagent-mobile-actions-width)"
      placement="below"
      alignment="end"
      hasChevron={false}
    />
  );
}
