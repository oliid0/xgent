import { Clock3 } from "../../../components/icons";
import { BackgroundServicesPanel } from "../../../components/workspace-tools/BackgroundServicesPanel";
import { useLocale } from "../../../i18n";
import type { AppSettings } from "../../../lib/settings";
import { cn } from "../../../lib/shared/utils";
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
    <MobileFullscreenPanel
      open={props.open}
      keepMounted
      label={t("sidebar.backgroundTasks")}
      className={cn("transition-[opacity,transform] duration-150", props.open && "opacity-100")}
    >
      <MobilePanelHeader
        title={t("sidebar.backgroundTasks")}
        backLabel={t("settings.close")}
        onBack={props.onClose}
        leading={<Clock3 className="h-4 w-4 text-muted-foreground" />}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <BackgroundServicesPanel
          settings={props.settings}
          setSettings={props.setSettings}
          managedProcessesAvailable={props.managedProcessesAvailable}
        />
      </div>
    </MobileFullscreenPanel>
  );
}
