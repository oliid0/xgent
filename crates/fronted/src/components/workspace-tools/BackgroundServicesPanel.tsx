import { useEffect, useState } from "react";
import { useLocale } from "../../i18n";
import type { AppSettings } from "../../lib/settings";
import { cn } from "../../lib/shared/utils";
import { CronSection } from "../../pages/settings/CronSection";
import { HooksSection } from "../../pages/settings/HooksSection";
import { Clock3, Cpu, Zap } from "../icons";
import { BackgroundTasksPanel } from "../project-tools/BackgroundTasksPanel";

type BackgroundServicesPanelProps = {
  settings: AppSettings;
  setSettings: (updater: (current: AppSettings) => AppSettings) => void;
  managedProcessesAvailable?: boolean;
};

type BackgroundServiceView = "processes" | "hooks" | "schedules";

export function BackgroundServicesPanel(props: BackgroundServicesPanelProps) {
  const { t } = useLocale();
  const managedProcessesAvailable = props.managedProcessesAvailable !== false;
  const [view, setView] = useState<BackgroundServiceView>(() =>
    managedProcessesAvailable ? "processes" : "schedules",
  );
  const tabs = [
    ...(managedProcessesAvailable
      ? [
          {
            id: "processes" as const,
            label: t("sidebar.backgroundTasks"),
            icon: Cpu,
          },
        ]
      : []),
    { id: "hooks" as const, label: t("settings.navHooks"), icon: Zap },
    { id: "schedules" as const, label: t("settings.navCron"), icon: Clock3 },
  ];

  useEffect(() => {
    if (!managedProcessesAvailable && view === "processes") {
      setView("schedules");
    }
  }, [managedProcessesAvailable, view]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div
        className={cn(
          "grid shrink-0 gap-1 border-b border-border/55 p-2",
          managedProcessesAvailable ? "grid-cols-3" : "grid-cols-2",
        )}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={cn(
                "flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs transition-colors",
                view === tab.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "processes" ? (
          <BackgroundTasksPanel active />
        ) : view === "hooks" ? (
          <div className="h-full p-3">
            <HooksSection settings={props.settings} setSettings={props.setSettings} />
          </div>
        ) : (
          <div className="h-full p-3">
            <CronSection settings={props.settings} setSettings={props.setSettings} />
          </div>
        )}
      </div>
    </div>
  );
}
