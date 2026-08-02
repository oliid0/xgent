import { Popover } from "@base-ui/react";
import { useState } from "react";
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
  const [open, setOpen] = useState(false);
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

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="mobile-quick-actions-trigger flex h-11 w-11 touch-manipulation items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground shadow-sm backdrop-blur-xl transition-[background-color,color,box-shadow] duration-150 active:bg-muted"
        aria-label={t("chat.mobileMenu.title")}
      >
        <MoreHorizontal className="h-5 w-5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-[100]"
        >
          <Popover.Popup className="mobile-quick-actions-menu w-[min(19rem,calc(100vw-1.5rem))] origin-top-right rounded-[1.35rem] border border-border/70 bg-popover/95 p-2 shadow-2xl backdrop-blur-2xl outline-none">
            {actionGroups.map((actions, groupIndex) => (
              <div
                key={actions[0].id}
                className={groupIndex > 0 ? "mt-1 border-t border-border/55 pt-1" : undefined}
              >
                {actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      action.run();
                    }}
                    className="flex min-h-12 w-full touch-manipulation items-center gap-3 rounded-xl px-2.5 py-1.5 text-left text-[15px] font-medium transition-colors duration-150 active:bg-foreground/[0.07]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/75 text-foreground">
                      {action.icon}
                    </span>
                    <span className="min-w-0 flex-1 leading-5">{action.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
