import { type FormEvent, useEffect, useState } from "react";
import { Globe, Loader2, Shield, Trash2 } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  browserSessionController,
  normalizeBrowserAddress,
} from "../../../lib/browser/browserSessionController";
import {
  type AppSettings,
  updateAccessSettings,
  updateCustomSettings,
} from "../../../lib/settings";
import { MobileToggle } from "./MobileHubChrome";
import { MobileFullscreenPanel, MobilePanelHeader } from "./MobilePanelScaffold";

type MobileBrowserSettingsPanelProps = {
  open: boolean;
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onClose: () => void;
};

export function MobileBrowserSettingsPanel(props: MobileBrowserSettingsPanelProps) {
  const { t } = useLocale();
  const [homePage, setHomePage] = useState(props.settings.customSettings.browser.homePage);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (props.open) setHomePage(props.settings.customSettings.browser.homePage);
  }, [props.open, props.settings.customSettings.browser.homePage]);

  if (!props.open) return null;

  const saveHomePage = (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = normalizeBrowserAddress(homePage);
    setHomePage(normalized);
    browserSessionController.configure({ homePage: normalized });
    props.setSettings((prev) =>
      updateCustomSettings(prev, {
        browser: { ...prev.customSettings.browser, homePage: normalized },
      }),
    );
  };

  return (
    <MobileFullscreenPanel open label={t("chat.mobileMenu.browserSettings")} className="bg-muted">
      <MobilePanelHeader
        title={t("chat.mobileMenu.browserSettings")}
        backLabel={t("settings.close")}
        onBack={props.onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-6">
        <h2 className="px-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("browser.homePage")}
        </h2>
        <form
          onSubmit={saveHomePage}
          className="mt-2 overflow-hidden rounded-[1.5rem] bg-background shadow-sm ring-1 ring-border/40"
        >
          <label className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
              <Globe className="h-4 w-4" />
            </span>
            <input
              value={homePage}
              onChange={(event) => setHomePage(event.currentTarget.value)}
              onBlur={() => saveHomePage()}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              placeholder="https://www.google.com/"
            />
          </label>
        </form>

        <h2 className="mt-7 px-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("browser.automation")}
        </h2>
        <div className="mt-2 overflow-hidden rounded-[1.5rem] bg-background shadow-sm ring-1 ring-border/40">
          <div className="flex min-h-[72px] items-center gap-3 px-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500 text-white">
              <Shield className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">
                {t("settings.accessAllowBrowserAutomation")}
              </div>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {t("settings.accessAllowBrowserAutomationHint")}
              </p>
            </div>
            <MobileToggle
              checked={props.settings.access.allowBrowserAutomation}
              label={t("settings.accessAllowBrowserAutomation")}
              onChange={(allowBrowserAutomation) =>
                props.setSettings((prev) => updateAccessSettings(prev, { allowBrowserAutomation }))
              }
            />
          </div>
        </div>

        <h2 className="mt-7 px-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("browser.privacy")}
        </h2>
        <div className="mt-2 overflow-hidden rounded-[1.5rem] bg-background shadow-sm ring-1 ring-border/40">
          <button
            type="button"
            disabled={clearing}
            onClick={() => {
              setClearing(true);
              void browserSessionController.closeAllSessions().finally(() => setClearing(false));
            }}
            className="flex min-h-[64px] w-full items-center gap-3 px-4 text-left text-destructive active:bg-destructive/5 disabled:opacity-45"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              {clearing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-medium">
              {t("browser.clearSessions")}
            </span>
          </button>
        </div>
      </div>
    </MobileFullscreenPanel>
  );
}
