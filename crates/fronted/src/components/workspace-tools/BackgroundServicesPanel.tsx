import { useEffect, useState } from "react";
import { StackItem, VStack } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { useLocale } from "../../i18n";
import type { AppSettings } from "../../lib/settings";
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
    <VStack height="100%" className="min-h-0 bg-[var(--color-bg-primary)]">
      <VStack padding={2} className="shrink-0 border-b border-[var(--color-border-subtle)]">
        <SegmentedControl
          value={view}
          onChange={(value) => setView(value as BackgroundServiceView)}
          label={t("sidebar.backgroundTasks")}
          layout="fill"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <SegmentedControlItem
                key={tab.id}
                value={tab.id}
                label={tab.label}
                icon={<Icon />}
              />
            );
          })}
        </SegmentedControl>
      </VStack>
      <StackItem size="fill" isScrollable>
        {view === "processes" ? (
          <BackgroundTasksPanel active />
        ) : view === "hooks" ? (
          <VStack height="100%" padding={3}>
            <HooksSection settings={props.settings} setSettings={props.setSettings} />
          </VStack>
        ) : (
          <VStack height="100%" padding={3}>
            <CronSection settings={props.settings} setSettings={props.setSettings} />
          </VStack>
        )}
      </StackItem>
    </VStack>
  );
}
