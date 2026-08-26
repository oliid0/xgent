import { StackItem } from "@astryxdesign/core/Layout";
import { Clock3 } from "../../../components/icons";
import { BackgroundServicesPanel } from "../../../components/workspace-tools/BackgroundServicesPanel";
import { useLocale } from "../../../i18n";
import type { AppSettings } from "../../../lib/settings";
import { MobileFullscreenPanel, MobilePanelHeader } from "./MobilePanelScaffold";

type MobileBackgroundTasksPanelProps = {
  open: boolean;
  settings: AppSettings;
  setSettings: (updater: (previous: AppSettings) => AppSettings) => void;
  managedProcessesAvailable: boolean;
  onClose: () => void;
};

export function MobileBackgroundTasksPanel(props: MobileBackgroundTasksPanelProps) {
  const { t } = useLocale();
  return (
    <MobileFullscreenPanel open={props.open} keepMounted label={t("sidebar.backgroundTasks")}>
      <MobilePanelHeader
        title={t("sidebar.backgroundTasks")}
        backLabel={t("settings.close")}
        onBack={props.onClose}
        leading={<Clock3 className="h-4 w-4 text-muted-foreground" />}
      />
      <StackItem size="fill">
        <BackgroundServicesPanel
          settings={props.settings}
          setSettings={props.setSettings}
          managedProcessesAvailable={props.managedProcessesAvailable}
        />
      </StackItem>
    </MobileFullscreenPanel>
  );
}
