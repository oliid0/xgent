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
      tone: "bg-zinc-700 text-white",
      run: props.onOpenTerminal,
    },
    {
      id: "rootfs",
      label: t("chat.mobileMenu.rootfs"),
      icon: <Package className="h-4 w-4" />,
      tone: "bg-emerald-500 text-white",
      run: props.onOpenRootfs,
    },
    {
      id: "browser",
      label: t("chat.mobileMenu.browser"),
      icon: <Globe className="h-4 w-4" />,
      tone: "bg-blue-500 text-white",
      run: props.onOpenBrowser,
    },
    {
      id: "browser-settings",
      label: t("chat.mobileMenu.browserSettings"),
      icon: <Settings className="h-4 w-4" />,
      tone: "bg-indigo-500 text-white",
      run: props.onOpenBrowserSettings,
    },
    {
      id: "git",
      label: t("chat.mobileMenu.gitReview"),
      icon: <GitBranch className="h-4 w-4" />,
      tone: "bg-orange-500 text-white",
      run: props.onOpenGitReview,
    },
    {
      id: "ssh",
      label: t("chat.mobileMenu.ssh"),
      icon: <Key className="h-4 w-4" />,
      tone: "bg-teal-500 text-white",
      run: props.onOpenSsh,
    },
    {
      id: "background",
      label: t("chat.mobileMenu.background"),
      icon: <Cpu className="h-4 w-4" />,
      tone: "bg-violet-500 text-white",
      run: props.onOpenBackgroundTasks,
    },
  ];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-background/70 text-muted-foreground shadow-sm transition-colors active:bg-muted active:text-foreground"
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
          <Popover.Popup className="w-[min(20rem,calc(100vw-1.5rem))] rounded-3xl border border-white/40 bg-background/88 p-2.5 shadow-2xl outline-none backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.09] dark:bg-background/84">
            <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("chat.mobileMenu.title")}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    action.run();
                  }}
                  className="flex min-h-12 items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left text-[13px] font-medium transition-colors active:bg-foreground/[0.06]"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${action.tone}`}
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
