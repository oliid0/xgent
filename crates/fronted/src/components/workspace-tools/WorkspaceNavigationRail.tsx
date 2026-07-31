import { useState } from "react";
import { useLocale } from "../../i18n";
import type { AppUpdateController } from "../../lib/appUpdates";
import { cn } from "../../lib/shared/utils";
import { useSoul } from "../../lib/soul";
import type { TerminalShellOption } from "../../lib/terminal/types";
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
  terminalShellOptions: TerminalShellOption[];
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

function RailButton(props: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  icon: typeof MessageSquare;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground disabled:pointer-events-none disabled:opacity-35",
        props.active && "bg-foreground/[0.08] text-foreground",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

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
    {
      target: "terminal",
      label: t("sidebar.terminal"),
      icon: Terminal,
      enabled: props.workspaceToolsAvailable,
    },
    {
      target: "gitReview",
      label: t("sidebar.gitReview"),
      icon: GitBranch,
      enabled: props.workspaceToolsAvailable,
    },
    {
      target: "sshConnection",
      label: t("sidebar.sshConnection"),
      icon: Key,
      enabled: props.workspaceToolsAvailable,
    },
    {
      target: "backgroundTasks",
      label: t("sidebar.backgroundTasks"),
      icon: Cpu,
      enabled: props.workspaceToolsAvailable,
    },
  ];

  const selectFromSoulMenu = (target: WorkspaceToolTarget, shell?: string) => {
    setSoulMenuOpen(false);
    props.onSelect(target, shell);
  };

  return (
    <aside className="relative z-30 flex h-full w-[52px] shrink-0 flex-col items-center border-r border-border/55 bg-[hsl(var(--sidebar-bg))] px-1.5 pb-2">
      <MacOsTitleBarSpacer className="w-full bg-transparent" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 pt-2">
        <RailButton
          label={props.panelOpen ? t("sidebar.closeSidebar") : t("sidebar.openSidebar")}
          icon={PanelLeft}
          active={props.panelOpen}
          onClick={props.onTogglePanel}
        />
        <RailButton
          label={t("chat.newConversation")}
          icon={SquarePen}
          onClick={props.onNewConversation}
        />
        <div className="my-0.5 w-6 border-t border-border/55" />
        <div className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto py-0.5">
          {items.map((item) => (
            <RailButton
              key={item.target}
              label={item.label}
              icon={item.icon}
              active={props.panelOpen && props.activeTarget === item.target}
              disabled={item.enabled === false}
              onClick={() => props.onSelect(item.target)}
            />
          ))}
        </div>
      </div>

      <div className="relative mt-auto flex flex-col items-center gap-1.5">
        {props.appUpdate?.showUpdateButton ? (
          <AppUpdateButton appUpdate={props.appUpdate} iconOnly />
        ) : null}
        {soulMenuOpen ? (
          <div className="absolute bottom-0 left-[46px] z-50 w-64 rounded-xl border border-border/60 bg-popover p-1.5 text-popover-foreground shadow-xl">
            <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("sidebar.soulPresets")}
            </div>
            <div className="max-h-40 overflow-y-auto">
              {soul.presets.map((preset) => {
                const active = preset.id === soul.activeId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      void soul.select(preset.id).catch(() => undefined);
                      setSoulMenuOpen(false);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-foreground/[0.07]"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/10 text-violet-500">
                      {active ? <Check className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {preset.metadata.name || "XGent"}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                setSoulMenuOpen(false);
                props.onCreateSoul();
              }}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-foreground/[0.07]"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
              {t("sidebar.addSoul")}
            </button>
            <div className="mx-1 my-1 border-t border-border/55" />
            <button
              type="button"
              disabled={!props.workspaceToolsAvailable}
              onClick={() => selectFromSoulMenu("terminal")}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-foreground/[0.07] disabled:opacity-40"
            >
              <Terminal className="h-4 w-4 text-muted-foreground" />
              {t("sidebar.terminal")}
            </button>
            {props.terminalShellOptions.slice(0, 4).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => selectFromSoulMenu("terminal", option.id)}
                className="flex h-7 w-full items-center rounded-lg pl-8 pr-2 text-left text-xs text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
              >
                <span className="truncate">{option.label}</span>
              </button>
            ))}
            {[
              { target: "gitReview" as const, label: t("sidebar.gitReview"), icon: GitBranch },
              { target: "sshConnection" as const, label: t("sidebar.sshConnection"), icon: Key },
              { target: "backgroundTasks" as const, label: t("sidebar.backgroundTasks"), icon: Cpu },
            ].map((item) => (
              <button
                key={item.target}
                type="button"
                disabled={!props.workspaceToolsAvailable}
                onClick={() => selectFromSoulMenu(item.target)}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-foreground/[0.07] disabled:opacity-40"
              >
                <item.icon className="h-4 w-4 text-muted-foreground" />
                {item.label}
              </button>
            ))}
            <div className="mx-1 my-1 border-t border-border/55" />
            <button
              type="button"
              onClick={() => {
                setSoulMenuOpen(false);
                props.onOpenSettings();
              }}
              className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-foreground/[0.07]"
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
              {t("tooltip.settings")}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          title={t("sidebar.soulMenu")}
          aria-label={t("sidebar.soulMenu")}
          aria-expanded={soulMenuOpen}
          onClick={() => setSoulMenuOpen((open) => !open)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/25 via-sky-500/20 to-amber-500/25 text-violet-500 ring-1 ring-border/70 transition-transform hover:scale-[1.03]"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
