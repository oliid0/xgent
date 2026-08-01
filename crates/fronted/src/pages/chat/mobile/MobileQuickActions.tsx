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
  const actions = [
    {
      id: "terminal",
      label: t("chat.mobileMenu.terminal"),
      icon: <Terminal className="h-4 w-4" />,
      tone: "bg-foreground/[0.07] text-foreground",
      run: props.onOpenTerminal,
    },
    {
      id: "rootfs",
      label: t("chat.mobileMenu.rootfs"),
      icon: <Package className="h-4 w-4" />,
      tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      run: props.onOpenRootfs,
    },
    {
      id: "browser",
      label: t("chat.mobileMenu.browser"),
      icon: <Globe className="h-4 w-4" />,
      tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      run: props.onOpenBrowser,
    },
    {
      id: "browser-settings",
      label: t("chat.mobileMenu.browserSettings"),
      icon: <Settings className="h-4 w-4" />,
      tone: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
      run: props.onOpenBrowserSettings,
    },
    {
      id: "git",
      label: t("chat.mobileMenu.gitReview"),
      icon: <GitBranch className="h-4 w-4" />,
      tone: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
      run: props.onOpenGitReview,
    },
    {
      id: "ssh",
      label: t("chat.mobileMenu.ssh"),
      icon: <Key className="h-4 w-4" />,
      tone: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
      run: props.onOpenSsh,
    },
    {
      id: "background",
      label: t("chat.mobileMenu.background"),
      icon: <Cpu className="h-4 w-4" />,
      tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
      run: props.onOpenBackgroundTasks,
    },
  ];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="mobile-quick-actions-trigger flex h-10 w-10 touch-manipulation items-center justify-center rounded-full border border-border/60 bg-background/75 text-muted-foreground shadow-sm backdrop-blur-xl transition-colors active:bg-muted active:text-foreground"
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
          <Popover.Popup className="mobile-quick-actions-menu w-[min(18rem,calc(100vw-1.5rem))] origin-top-right rounded-2xl border border-border/70 bg-popover/95 p-2 shadow-2xl backdrop-blur-2xl outline-none">
            <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold tracking-[0.02em] text-muted-foreground">
              {t("chat.mobileMenu.title")}
            </div>
            <div className="grid grid-cols-1 gap-0.5">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    action.run();
                  }}
                  className="flex min-h-11 touch-manipulation items-center gap-3 rounded-xl px-2.5 py-1.5 text-left text-[13.5px] font-medium transition-colors active:bg-foreground/[0.07]"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${action.tone}`}
                  >
                    {action.icon}
                  </span>
                  <span className="min-w-0 flex-1 leading-4">{action.label}</span>
                </button>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
