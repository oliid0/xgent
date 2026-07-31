import { ArrowLeft, Clock3 } from "../../../components/icons";
import { BackgroundServicesPanel } from "../../../components/workspace-tools/BackgroundServicesPanel";
import { useLocale } from "../../../i18n";
import type { AppSettings } from "../../../lib/settings";
import { cn } from "../../../lib/shared/utils";

type MobileBackgroundTasksPanelProps = {
  open: boolean;
  settings: AppSettings;
  setSettings: (updater: (previous: AppSettings) => AppSettings) => void;
  onClose: () => void;
};

export function MobileBackgroundTasksPanel(props: MobileBackgroundTasksPanelProps) {
  const { t } = useLocale();
  return (
    <section
      aria-hidden={!props.open}
      className={cn(
        "fixed inset-0 z-[72] flex min-h-0 flex-col bg-background pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)] transition-[opacity,transform] duration-150",
        props.open
          ? "translate-x-0 opacity-100"
          : "pointer-events-none translate-x-[8%] opacity-0",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <button
          type="button"
          onClick={props.onClose}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
          aria-label={t("settings.close")}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Clock3 className="h-4 w-4 text-muted-foreground" />
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">
          {t("sidebar.backgroundTasks")}
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <BackgroundServicesPanel settings={props.settings} setSettings={props.setSettings} />
      </div>
    </section>
  );
}
