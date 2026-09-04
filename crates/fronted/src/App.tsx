import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { ContextMenu } from "@astryxdesign/core/ContextMenu";
import { Dialog } from "@astryxdesign/core/Dialog";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StackItem, VStack } from "@astryxdesign/core/Stack";
import { ToastViewport } from "@astryxdesign/core/Toast";
import { Theme } from "@astryxdesign/core/theme";
import type { Context } from "@earendil-works/pi-ai";
import {
  configureLanPcCommandHost,
  invoke,
  isBrowserRuntime,
  LAN_PC_SESSION_CHANGED_EVENT,
  listen,
} from "@xgent/runtime";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { useConfirmDialog } from "./components/astryx/useConfirmDialog";
import { CronPromptRunner } from "./components/cron/CronPromptRunner";
import { useNativeInputContextMenu } from "./components/input-context-menu/NativeInputContextMenu";
import { MemoryOrganizerHost } from "./components/memory/useMemoryOrganizer";
import { WindowsTitleBar } from "./components/WindowsTitleBar";
import {
  LocaleContext,
  resolveEffectiveLocale,
  subscribeToSystemLocalePreference,
  t as translate,
} from "./i18n";
import { useAppUpdateController } from "./lib/appUpdates";
import { initAutomation } from "./lib/automation";
import { type MobileStartupStatus, readMobileStartupStatus } from "./lib/mobileStartup";
import { setRetryErrorExtension } from "./lib/providers/runtime/streamRetry";
import {
  inferRuntimePlatform,
  type RuntimePlatform,
  resolveRuntimePlatform,
} from "./lib/runtimePlatform";
import {
  type AppSettings,
  getDefaultSettings,
  getNextTheme,
  normalizeSettings,
  resolveEffectiveTheme,
  resolveWorkspaceProjects,
  subscribeToSystemThemePreference,
} from "./lib/settings";
import { getSettingsErrorMessage, SettingsStorageError } from "./lib/settings/errors";
import {
  loadPersistedSettingsWithDefaults,
  persistSettings,
  type SettingsSaveState,
} from "./lib/settings/storage";
import { applyStoredGlobalShortcuts } from "./lib/shortcuts/globalShortcuts";
import { SoulProvider } from "./lib/soul";
import { applyFontFamilies } from "./lib/system/fontFamily";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { SectionId, SettingsOpenOptions } from "./pages/settings/types";
import { startLocalAccessHostBridge } from "./runtime/localAccessHostBridge";
import { xgentCompactTheme, xgentTheme } from "./theme/xgentTheme";

const MOBILE_SETTINGS_HYDRATION_TIMEOUT_MS = 2_500;

function getDefaultContext(): Context {
  return {
    messages: [],
  };
}

function AppChrome(props: { children: ReactNode; nativeMobile?: boolean }) {
  // Plain inputs get a shared cut/copy/paste menu; everything else keeps the
  // suppressed native menu (surfaces with their own menus opt out upstream).
  const { onRootContextMenu, onRootMouseDownCapture, contextMenuProps } = useNativeInputContextMenu(
    {
      enabled: !props.nativeMobile,
    },
  );
  return (
    <ContextMenu {...contextMenuProps}>
      <VStack
        data-native-mobile={props.nativeMobile ? "true" : undefined}
        height="var(--xgent-viewport-height)"
        width="100%"
        gap={0}
        className="app-safe-area app-chrome"
        onContextMenu={onRootContextMenu}
        onMouseDownCapture={onRootMouseDownCapture}
      >
        <WindowsTitleBar />
        <StackItem size="fill" className="app-chrome-content">
          {props.children}
        </StackItem>
      </VStack>
    </ContextMenu>
  );
}

function applyRuntimeSystemDefaults(settings: AppSettings, defaultWorkdir: string): AppSettings {
  const normalizedDefaultWorkdir = defaultWorkdir.trim();
  const system =
    !normalizedDefaultWorkdir || settings.system.workdir.trim()
      ? settings.system
      : {
          ...settings.system,
          workdir: normalizedDefaultWorkdir,
        };
  return normalizeSettings({
    ...settings,
    system: resolveWorkspaceProjects(system, normalizedDefaultWorkdir),
  });
}

function AppStartupSurface(props: { locale: AppSettings["locale"]; failures: string[] }) {
  const label = translate("app.loading", props.locale);
  return (
    <Center width="100%" height="100%" padding={6}>
      <VStack width="100%" maxWidth="var(--xgent-content-width-md)" gap={4} hAlign="center">
        <Spinner size="lg" label={label} aria-label={label} />
        <MobileStartupWarning failures={props.failures} locale={props.locale} />
      </VStack>
    </Center>
  );
}

function MobileStartupWarning(props: { failures: string[]; locale: AppSettings["locale"] }) {
  if (props.failures.length === 0) return null;
  return (
    <Banner
      status="warning"
      container="section"
      title={translate("app.mobileStartupDegraded", props.locale)}
      description={props.failures.join(" · ")}
      collapsible={false}
      endContent={
        <Button
          size="sm"
          variant="secondary"
          label={translate("app.errorBoundaryReload", props.locale)}
          onClick={() => window.location.reload()}
        />
      }
    />
  );
}

export default function App() {
  const browserRuntime = isBrowserRuntime();

  const [runtimePlatform, setRuntimePlatform] = useState<RuntimePlatform>(inferRuntimePlatform);
  const [platformResolved, setPlatformResolved] = useState(
    () => browserRuntime || ["android", "ios"].includes(inferRuntimePlatform()),
  );
  const nativeMobile =
    !browserRuntime && (runtimePlatform === "android" || runtimePlatform === "ios");
  const compactSettingsDialog = useMediaQuery("(max-width: 768px)") || nativeMobile;
  const desktopBridgeEnabled = browserRuntime || (platformResolved && !nativeMobile);
  const [mobileStartup, setMobileStartup] = useState<MobileStartupStatus>({
    phase: "starting",
    failures: [],
  });

  useEffect(() => {
    if (!nativeMobile) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    let startupDelayReported = false;
    const deadline = Date.now() + 30_000;

    const poll = async () => {
      try {
        const status = await readMobileStartupStatus();
        if (cancelled) return;
        if (status.phase !== "starting") {
          if (status.failures.length > 0) {
            console.warn("Mobile services started in degraded mode", status.failures);
          }
          setMobileStartup(status);
          return;
        }
        if (Date.now() >= deadline) {
          const failures = ["Native service initialization did not finish within 30 seconds"];
          if (!startupDelayReported) {
            startupDelayReported = true;
            console.warn("Mobile service initialization is taking longer than expected", failures);
            setMobileStartup({ phase: "starting", failures });
          }
          retryTimer = window.setTimeout(() => void poll(), 1_000);
          return;
        }
        retryTimer = window.setTimeout(() => void poll(), 100);
      } catch (error) {
        if (cancelled) return;
        console.warn("Unable to read native mobile startup status", error);
        setMobileStartup({
          phase: "degraded",
          failures: [error instanceof Error ? error.message : String(error)],
        });
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [nativeMobile]);

  useEffect(() => {
    if (browserRuntime || !platformResolved || nativeMobile) return;
    const unlistenPromise = startLocalAccessHostBridge();
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [browserRuntime, nativeMobile, platformResolved]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SectionId>("system");
  const [soulCreateRequestId, setSoulCreateRequestId] = useState(0);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settings, setSettingsState] = useState<AppSettings>(() => getDefaultSettings());
  const [lanPcCommandHostReady, setLanPcCommandHostReady] = useState(false);
  const [lanPcSessionRevision, setLanPcSessionRevision] = useState(0);
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>({
    status: "idle",
  });
  const settingsHydratedRef = useRef(false);
  const [context, setContext] = useState<Context>(() => getDefaultContext());
  const { confirm: requestRestartConfirm, dialog: restartConfirmDialog } = useConfirmDialog();

  const saveSequenceRef = useRef(0);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const defaultWorkdirRef = useRef("");
  // Mirrors `settings` so setSettings/queueSettingsSave can read the latest value
  // synchronously without passing a (side-effecting) function into setSettingsState —
  // React 18 StrictMode double-invokes functional state updaters in development,
  // which would otherwise run those side effects (and any non-idempotent work like
  // crypto.randomUUID() inside caller updaters) twice per call.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [systemThemeVersion, setSystemThemeVersion] = useState(0);
  const [systemLocaleVersion, setSystemLocaleVersion] = useState(0);
  const effectiveTheme = useMemo(
    () => resolveEffectiveTheme(settings.theme),
    [settings.theme, systemThemeVersion],
  );
  const effectiveLocale = useMemo(
    () => resolveEffectiveLocale(settings.locale),
    [settings.locale, systemLocaleVersion],
  );

  useEffect(() => {
    setRetryErrorExtension({
      statusCodes: settings.retryErrorSettings.presetStatusCodes,
      patterns: settings.retryErrorSettings.customPatterns,
    });
  }, [settings.retryErrorSettings]);

  useEffect(() => {
    let cancelled = false;
    void resolveRuntimePlatform().then((platform) => {
      if (!cancelled) {
        setRuntimePlatform(platform);
        setPlatformResolved(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (browserRuntime || !platformResolved || nativeMobile) return;
    void applyStoredGlobalShortcuts().catch((error) => {
      console.warn("Failed to restore global shortcuts", error);
    });
  }, [browserRuntime, nativeMobile, platformResolved]);

  useEffect(() => {
    if (!nativeMobile) return;
    let disposed = false;
    let unlistenSessionChange: (() => void) | undefined;
    void listen(LAN_PC_SESSION_CHANGED_EVENT, () => {
      if (!disposed) setLanPcSessionRevision((revision) => revision + 1);
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlistenSessionChange = dispose;
      }
    });
    return () => {
      disposed = true;
      unlistenSessionChange?.();
    };
  }, [nativeMobile]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let consecutiveFailures = 0;
    configureLanPcCommandHost();
    setLanPcCommandHostReady(false);
    if (
      !settingsReady ||
      !nativeMobile ||
      !settings.access.preferLanPcExecution ||
      !settings.access.lanControlUrl.trim()
    ) {
      return () => {
        cancelled = true;
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      };
    }

    const baseUrl = settings.access.lanControlUrl.trim();
    const scheduleProbe = (delayMs: number) => {
      if (cancelled) return;
      retryTimer = window.setTimeout(() => void probe(), delayMs);
    };
    const probe = async () => {
      try {
        const [snapshot, remoteHomeDir] = await Promise.all([
          invoke<{ defaultWorkdir?: unknown }>("lan_pc_invoke", {
            base_url: baseUrl,
            command: "settings_load_all",
            args: {},
          }),
          invoke<string>("lan_pc_invoke", {
            base_url: baseUrl,
            command: "system_home_dir",
            args: {},
          }),
        ]);
        if (cancelled) return;
        const remoteWorkdir =
          typeof snapshot.defaultWorkdir === "string" ? snapshot.defaultWorkdir.trim() : "";
        if (!remoteWorkdir || !remoteHomeDir.trim()) {
          throw new Error("LAN computer did not return its workspace capabilities");
        }
        consecutiveFailures = 0;
        configureLanPcCommandHost({
          enabled: true,
          baseUrl,
          localWorkdir: settings.system.workdir,
          remoteWorkdir,
          remoteHomeDir: remoteHomeDir.trim(),
        });
        setLanPcCommandHostReady(true);
        scheduleProbe(20_000);
      } catch {
        if (cancelled) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 2) {
          configureLanPcCommandHost();
          setLanPcCommandHostReady(false);
        }
        const retryDelay = Math.min(30_000, 2_000 * 2 ** Math.min(consecutiveFailures - 1, 4));
        scheduleProbe(retryDelay);
      }
    };
    void probe();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      configureLanPcCommandHost();
    };
  }, [
    lanPcSessionRevision,
    nativeMobile,
    settings.access.lanControlUrl,
    settings.access.preferLanPcExecution,
    settings.system.workdir,
    settingsReady,
  ]);

  useEffect(() => {
    if (settings.theme !== "system") return;
    return subscribeToSystemThemePreference(() => {
      setSystemThemeVersion((version) => version + 1);
    });
  }, [settings.theme]);

  useEffect(() => {
    if (settings.locale !== "system") return;
    return subscribeToSystemLocalePreference(() => {
      setSystemLocaleVersion((version) => version + 1);
    });
  }, [settings.locale]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", effectiveTheme === "dark");
    root.style.colorScheme = effectiveTheme;
  }, [effectiveTheme]);

  useEffect(() => {
    applyFontFamilies({
      interfaceFontFamily: settings.customSettings.interfaceFontFamily,
      chatFontFamily: settings.customSettings.chatFontFamily,
      codeFontFamily: settings.customSettings.codeFontFamily,
    });
  }, [
    settings.customSettings.chatFontFamily,
    settings.customSettings.codeFontFamily,
    settings.customSettings.interfaceFontFamily,
  ]);

  useEffect(() => {
    if (!settingsReady || !desktopBridgeEnabled || browserRuntime) return;
    void invoke("app_set_close_window_behavior", {
      behavior: settings.closeWindowBehavior,
    }).catch(() => {
      // Ignore non-Tauri and older desktop shells.
    });
  }, [browserRuntime, desktopBridgeEnabled, settingsReady, settings.closeWindowBehavior]);

  useEffect(() => {
    if (!browserRuntime && !platformResolved) return;
    if (settingsHydratedRef.current) return;
    let cancelled = false;
    let hydrationTimer: number | undefined;

    async function hydrateSettings() {
      try {
        const persistedSettings = loadPersistedSettingsWithDefaults();
        const { settings: loaded, defaultWorkdir } = nativeMobile
          ? await Promise.race([
              persistedSettings,
              new Promise<never>((_resolve, reject) => {
                hydrationTimer = window.setTimeout(
                  () => reject(new Error("Native settings did not respond during mobile startup")),
                  MOBILE_SETTINGS_HYDRATION_TIMEOUT_MS,
                );
              }),
            ])
          : await persistedSettings;
        if (!cancelled) {
          defaultWorkdirRef.current = defaultWorkdir;
          const loadedWithDefaults = applyRuntimeSystemDefaults(loaded, defaultWorkdir);
          settingsHydratedRef.current = true;
          settingsRef.current = loadedWithDefaults;
          setSettingsState(loadedWithDefaults);
          setSettingsSaveState({ status: "saved" });
        }
      } catch (error) {
        if (!cancelled) {
          const fallback = getDefaultSettings();
          settingsRef.current = fallback;
          setSettingsState(fallback);
          setSettingsSaveState({
            status: "error",
            message: getSettingsErrorMessage(
              error,
              translate("app.settingsLoadFailed", fallback.locale),
              fallback.locale,
              translate,
            ),
          });
        }
      } finally {
        if (hydrationTimer !== undefined) window.clearTimeout(hydrationTimer);
        if (!cancelled) {
          setSettingsReady(true);
        }
      }
    }

    void hydrateSettings();
    return () => {
      cancelled = true;
      if (hydrationTimer !== undefined) window.clearTimeout(hydrationTimer);
    };
  }, [browserRuntime, mobileStartup.phase, nativeMobile, platformResolved]);

  const queueSettingsSave = useCallback(
    (prev: AppSettings, next: AppSettings, fallback: string) => {
      const saveSequence = ++saveSequenceRef.current;
      setSettingsSaveState({ status: "saving" });

      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(() => persistSettings(prev, next))
        .then((persistResult) => {
          if (persistResult.ssh && saveSequenceRef.current === saveSequence) {
            const merged = normalizeSettings({
              ...settingsRef.current,
              ssh: persistResult.ssh,
            });
            settingsRef.current = merged;
            setSettingsState(merged);
          }
          if (persistResult.conflict) {
            throw new SettingsStorageError(persistResult.conflict);
          }
        })
        .then(() => {
          if (saveSequenceRef.current === saveSequence) {
            setSettingsSaveState({ status: "saved" });
          }
        })
        .catch((error) => {
          if (saveSequenceRef.current === saveSequence) {
            setSettingsSaveState({
              status: "error",
              message: getSettingsErrorMessage(error, fallback, next.locale, translate),
            });
          }
        });
    },
    [],
  );

  const setSettings = useCallback(
    (updater: (prev: AppSettings) => AppSettings) => {
      const prev = settingsRef.current;
      const updated = updater(prev);
      if (updated === prev) return;
      const next = applyRuntimeSystemDefaults(
        normalizeSettings(updated),
        defaultWorkdirRef.current,
      );
      settingsRef.current = next;
      setSettingsState(next);
      queueSettingsSave(prev, next, translate("app.settingsSaveFailed", next.locale));
    },
    [queueSettingsSave],
  );

  // Authoritative live read for tool write paths: settingsRef is updated
  // synchronously by setSettings, so read-modify-write sequences that stay in
  // one synchronous segment can never observe a stale snapshot.
  const getMcpSettings = useCallback(() => settingsRef.current.mcp, []);
  const getToolPolicies = useCallback(() => settingsRef.current.system.toolPolicies, []);

  const reloadPersistedSettings = useCallback(async () => {
    await saveChainRef.current.catch(() => undefined);
    const { settings: loaded, defaultWorkdir } = await loadPersistedSettingsWithDefaults();
    defaultWorkdirRef.current = defaultWorkdir;
    const loadedWithDefaults = applyRuntimeSystemDefaults(loaded, defaultWorkdir);
    settingsRef.current = loadedWithDefaults;
    setSettingsState(loadedWithDefaults);
    setSettingsSaveState({ status: "saved" });
  }, []);

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: getNextTheme(prev.theme),
    }));
  }, [setSettings]);

  const openSettings = useCallback(
    (section: SectionId = "system", options?: SettingsOpenOptions) => {
      setSettingsSection(section);
      if (section === "soul" && options?.createSoul) {
        setSoulCreateRequestId((current) => current + 1);
      } else {
        setSoulCreateRequestId(0);
      }
      setSettingsOpen(true);
      void reloadPersistedSettings().catch((error) => {
        setSettingsSaveState({
          status: "error",
          message: getSettingsErrorMessage(
            error,
            translate("app.settingsReloadFailed", settingsRef.current.locale),
            settingsRef.current.locale,
            translate,
          ),
        });
      });
    },
    [reloadPersistedSettings],
  );

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const localeContextValue = useMemo(
    () => ({
      locale: effectiveLocale,
      t: (key: string) => translate(key, effectiveLocale),
    }),
    [effectiveLocale],
  );

  const appUpdateMessages = useMemo(
    () => ({
      checkFailed: translate("settings.aboutUpdateCheckFailed", settings.locale),
      installFailed: translate("settings.aboutUpdateInstallFailed", settings.locale),
      restartFailed: translate("settings.aboutRestartFailed", settings.locale),
    }),
    [settings.locale],
  );

  const runningConversationCountRef = useRef(0);
  const handleRunningConversationCountChange = useCallback((count: number) => {
    runningConversationCountRef.current = count;
  }, []);
  const beforeAppRestart = useCallback(async () => {
    const count = runningConversationCountRef.current;
    if (count === 0) return true;
    return requestRestartConfirm({
      title: translate("appUpdate.runningTasksTitle", settings.locale),
      description: translate("appUpdate.runningTasksDescription", settings.locale).replace(
        "{count}",
        String(count),
      ),
      cancelLabel: translate("appUpdate.restartLater", settings.locale),
      confirmLabel: translate("appUpdate.restartAnyway", settings.locale),
      closeLabel: translate("appUpdate.restartLater", settings.locale),
      tone: "warning",
    });
  }, [requestRestartConfirm, settings.locale]);

  const appUpdate = useAppUpdateController({
    enabled: settingsReady && desktopBridgeEnabled && !browserRuntime,
    includePrereleases: settings.updates.includePrereleases,
    messages: appUpdateMessages,
    beforeRestart: beforeAppRestart,
  });
  // Native command state is registered during setup. Mounting ChatPage or the
  // closed settings sheet before that work finishes lets their effects race
  // history/settings commands and can replace the entire mobile UI with an
  // error boundary. Keep the native component tree inert until both the
  // platform and persisted settings are ready.
  const appContentReady = platformResolved && (!nativeMobile || settingsReady);
  useEffect(() => {
    if (!desktopBridgeEnabled || nativeMobile || browserRuntime) return;
    let disposed = false;
    let unlistenAction: (() => void) | undefined;
    void listen<{ action?: string; value?: string }>("app:action", (event) => {
      if (disposed) return;
      switch (event.payload?.action) {
        case "set-theme": {
          const theme = event.payload.value;
          if (theme === "light" || theme === "dark" || theme === "system") {
            setSettings((previous) => ({ ...previous, theme }));
          }
          break;
        }
        case "open-settings":
          openSettings("system");
          break;
        case "check-updates":
          void appUpdate.runCheck().catch(() => undefined);
          break;
        default:
          break;
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenAction = unlisten;
    });
    return () => {
      disposed = true;
      unlistenAction?.();
    };
  }, [
    appUpdate.runCheck,
    browserRuntime,
    desktopBridgeEnabled,
    nativeMobile,
    openSettings,
    setSettings,
  ]);

  useEffect(() => {
    if (!settingsReady || (!desktopBridgeEnabled && !lanPcCommandHostReady && !nativeMobile))
      return;
    void initAutomation().catch((error) => {
      console.warn("Failed to initialize automation store", error);
    });
  }, [desktopBridgeEnabled, lanPcCommandHostReady, nativeMobile, settingsReady]);

  return (
    <Theme theme={compactSettingsDialog ? xgentCompactTheme : xgentTheme} mode={effectiveTheme}>
      <ToastViewport position="topEnd" maxVisible={4}>
        <LocaleContext.Provider value={localeContextValue}>
          <AppChrome nativeMobile={nativeMobile}>
            <SoulProvider>
              {appContentReady ? (
                <>
                  {settingsReady ? <CronPromptRunner settings={settings} /> : null}
                  {settingsReady ? (
                    <MemoryOrganizerHost settings={settings} setSettings={setSettings} />
                  ) : null}
                  <AppErrorBoundary>
                    <VStack width="100%" height="100%" gap={0}>
                      {nativeMobile && mobileStartup.failures.length > 0 ? (
                        <MobileStartupWarning
                          failures={mobileStartup.failures}
                          locale={settings.locale}
                        />
                      ) : null}
                      <StackItem size="fill">
                        <ChatPage
                          settings={settings}
                          setSettings={setSettings}
                          getMcpSettings={getMcpSettings}
                          getToolPolicies={getToolPolicies}
                          context={context}
                          setContext={setContext}
                          onOpenSettings={openSettings}
                          onToggleTheme={toggleTheme}
                          appUpdate={appUpdate}
                          desktopBridgeEnabled={desktopBridgeEnabled}
                          lanPcCommandHostReady={lanPcCommandHostReady}
                          nativeMobile={nativeMobile}
                          onRunningConversationCountChange={handleRunningConversationCountChange}
                        />
                      </StackItem>
                    </VStack>
                  </AppErrorBoundary>
                  {compactSettingsDialog ? (
                    <BottomSheet
                      isOpen={settingsOpen}
                      onOpenChange={(isOpen) => {
                        if (!isOpen) closeSettings();
                      }}
                      label={translate("settings.title", settings.locale)}
                      purpose="info"
                      height="tall"
                    >
                      <AppErrorBoundary>
                        <VStack
                          width="100%"
                          height="100%"
                          minHeight={0}
                          gap={0}
                          paddingBlockStart={5}
                        >
                          <SettingsPage
                            settings={settings}
                            setSettings={setSettings}
                            reloadSettings={reloadPersistedSettings}
                            saveState={settingsSaveState}
                            onBack={closeSettings}
                            initialSection={settingsSection}
                            soulCreateRequestId={soulCreateRequestId}
                            nativeMobile={nativeMobile}
                            appUpdate={appUpdate}
                          />
                        </VStack>
                      </AppErrorBoundary>
                    </BottomSheet>
                  ) : (
                    <Dialog
                      isOpen={settingsOpen}
                      onOpenChange={(isOpen) => {
                        if (!isOpen) closeSettings();
                      }}
                      purpose="info"
                      variant="standard"
                      width="var(--xgent-settings-dialog-width)"
                      maxHeight="var(--xgent-settings-dialog-height)"
                      padding={0}
                      aria-label={translate("settings.title", settings.locale)}
                    >
                      <AppErrorBoundary>
                        <SettingsPage
                          settings={settings}
                          setSettings={setSettings}
                          reloadSettings={reloadPersistedSettings}
                          saveState={settingsSaveState}
                          onBack={closeSettings}
                          initialSection={settingsSection}
                          soulCreateRequestId={soulCreateRequestId}
                          nativeMobile={nativeMobile}
                          appUpdate={appUpdate}
                        />
                      </AppErrorBoundary>
                    </Dialog>
                  )}
                  {restartConfirmDialog}
                </>
              ) : (
                <AppStartupSurface locale={settings.locale} failures={mobileStartup.failures} />
              )}
            </SoulProvider>
          </AppChrome>
        </LocaleContext.Provider>
      </ToastViewport>
    </Theme>
  );
}
