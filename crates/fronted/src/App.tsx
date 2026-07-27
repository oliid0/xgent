import type { Context } from "@earendil-works/pi-ai";
import { invoke, isBrowserRuntime } from "@xagent/runtime";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { CronPromptRunner } from "./components/cron/CronPromptRunner";
import { useNativeInputContextMenu } from "./components/input-context-menu/NativeInputContextMenu";
import { MemoryOrganizerHost } from "./components/memory/useMemoryOrganizer";
import { WindowsTitleBar } from "./components/WindowsTitleBar";
import { LocaleContext, t as translate } from "./i18n";
import { useAppUpdateController } from "./lib/appUpdates";
import { initAutomation } from "./lib/automation";
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
import {
  loadPersistedSettingsWithDefaults,
  persistSettings,
  type SettingsSaveState,
} from "./lib/settings/storage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { SectionId } from "./pages/settings/types";
import { startLocalAccessHostBridge } from "./runtime/localAccessHostBridge";

function getDefaultContext(): Context {
  return {
    messages: [],
  };
}

function asErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error ?? "").trim();
  return text || fallback;
}

function AppChrome(props: { children: ReactNode }) {
  // Plain inputs get a shared cut/copy/paste menu; everything else keeps the
  // suppressed native menu (surfaces with their own menus opt out upstream).
  const { onRootContextMenu, onRootMouseDownCapture, menu } = useNativeInputContextMenu();
  return (
    <div
      className="app-safe-area relative flex h-full w-full flex-col overflow-hidden bg-background"
      onContextMenu={onRootContextMenu}
      onMouseDownCapture={onRootMouseDownCapture}
    >
      <WindowsTitleBar />
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">{props.children}</div>
      {menu}
    </div>
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

export default function App() {
  const browserRuntime = isBrowserRuntime();

  const [runtimePlatform, setRuntimePlatform] = useState<RuntimePlatform>(inferRuntimePlatform);
  const [platformResolved, setPlatformResolved] = useState(browserRuntime);
  const nativeMobile =
    platformResolved &&
    !browserRuntime &&
    (runtimePlatform === "android" || runtimePlatform === "ios");
  const desktopBridgeEnabled = browserRuntime || (platformResolved && !nativeMobile);

  useEffect(() => {
    if (browserRuntime || !platformResolved || nativeMobile) return;
    const unlistenPromise = startLocalAccessHostBridge();
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [browserRuntime, nativeMobile, platformResolved]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SectionId>("system");
  const [settingsReady, setSettingsReady] = useState(false);
  const [settings, setSettingsState] = useState<AppSettings>(() => getDefaultSettings());
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>({
    status: "idle",
  });
  const [context, setContext] = useState<Context>(() => getDefaultContext());
  const [overlay, setOverlay] = useState<"closed" | "entering" | "open" | "leaving">("closed");

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
  const effectiveTheme = useMemo(
    () => resolveEffectiveTheme(settings.theme),
    [settings.theme, systemThemeVersion],
  );

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
    if (settings.theme !== "system") return;
    return subscribeToSystemThemePreference(() => {
      setSystemThemeVersion((version) => version + 1);
    });
  }, [settings.theme]);

  // 同步主题 class 到 <html> 根节点
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", effectiveTheme === "dark");
  }, [effectiveTheme]);

  useEffect(() => {
    if (!settingsReady || !desktopBridgeEnabled) return;
    void invoke("app_set_close_window_behavior", {
      behavior: settings.closeWindowBehavior,
    }).catch(() => {
      // Ignore non-Tauri and older desktop shells.
    });
  }, [desktopBridgeEnabled, settingsReady, settings.closeWindowBehavior]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSettings() {
      try {
        const { settings: loaded, defaultWorkdir } = await loadPersistedSettingsWithDefaults();
        if (!cancelled) {
          defaultWorkdirRef.current = defaultWorkdir;
          const loadedWithDefaults = applyRuntimeSystemDefaults(loaded, defaultWorkdir);
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
            message: asErrorMessage(error, "加载设置失败，已回退到默认配置。"),
          });
        }
      } finally {
        if (!cancelled) {
          setSettingsReady(true);
        }
      }
    }

    void hydrateSettings();
    return () => {
      cancelled = true;
    };
  }, []);

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
            throw new Error(persistResult.conflict);
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
              message: asErrorMessage(error, fallback),
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
      queueSettingsSave(prev, next, "保存设置失败。");
    },
    [queueSettingsSave],
  );

  // Authoritative live read for tool write paths: settingsRef is updated
  // synchronously by setSettings, so read-modify-write sequences that stay in
  // one synchronous segment can never observe a stale snapshot.
  const getMcpSettings = useCallback(() => settingsRef.current.mcp, []);

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
    (section: SectionId = "system") => {
      setSettingsSection(section);
      setSettingsOpen(true);
      setOverlay("entering");
      requestAnimationFrame(() => requestAnimationFrame(() => setOverlay("open")));
      void reloadPersistedSettings().catch((error) => {
        setSettingsSaveState({
          status: "error",
          message: asErrorMessage(error, "重新加载设置失败，当前显示的是旧配置。"),
        });
      });
    },
    [reloadPersistedSettings],
  );

  const closeSettings = useCallback(() => {
    setOverlay("leaving");
  }, []);

  const handleTransitionEnd = useCallback(() => {
    if (overlay === "leaving") {
      setSettingsOpen(false);
      setOverlay("closed");
    }
  }, [overlay]);

  // 构建 locale context value，避免每次渲染重新创建
  const localeContextValue = useMemo(
    () => ({
      locale: settings.locale,
      t: (key: string) => translate(key, settings.locale),
    }),
    [settings.locale],
  );

  const appUpdateMessages = useMemo(
    () => ({
      checkFailed: translate("settings.aboutUpdateCheckFailed", settings.locale),
      installFailed: translate("settings.aboutUpdateInstallFailed", settings.locale),
      restartFailed: translate("settings.aboutRestartFailed", settings.locale),
    }),
    [settings.locale],
  );

  const appUpdate = useAppUpdateController({
    enabled: settingsReady && desktopBridgeEnabled,
    includePrereleases: settings.updates.includePrereleases,
    messages: appUpdateMessages,
  });

  useEffect(() => {
    if (!settingsReady || !desktopBridgeEnabled) return;
    void initAutomation().catch((error) => {
      console.warn("Failed to initialize automation store", error);
    });
  }, [desktopBridgeEnabled, settingsReady]);

  if (!settingsReady || !platformResolved) {
    return (
      <LocaleContext.Provider value={localeContextValue}>
        <AppChrome>
          <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
            {translate("chat.loading", settings.locale)}
          </div>
        </AppChrome>
      </LocaleContext.Provider>
    );
  }

  const visible = settingsOpen;
  const active = overlay === "open";

  return (
    <LocaleContext.Provider value={localeContextValue}>
      <AppChrome>
        {desktopBridgeEnabled ? <CronPromptRunner settings={settings} /> : null}
        <MemoryOrganizerHost settings={settings} setSettings={setSettings} />
        <AppErrorBoundary>
          <ChatPage
            settings={settings}
            setSettings={setSettings}
            getMcpSettings={getMcpSettings}
            context={context}
            setContext={setContext}
            onOpenSettings={openSettings}
            onToggleTheme={toggleTheme}
            appUpdate={appUpdate}
            desktopBridgeEnabled={desktopBridgeEnabled}
          />
        </AppErrorBoundary>
        {visible && (
          <div
            className={`absolute inset-0 z-50 transition-all duration-300 ease-out ${
              active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
            onTransitionEnd={handleTransitionEnd}
          >
            <AppErrorBoundary>
              <SettingsPage
                settings={settings}
                setSettings={setSettings}
                saveState={settingsSaveState}
                onBack={closeSettings}
                initialSection={settingsSection}
                hiddenSections={
                  desktopBridgeEnabled ? [] : ["agents", "ssh", "hooks", "cron", "systemTools"]
                }
                nativeMobile={nativeMobile}
                appUpdate={appUpdate}
              />
            </AppErrorBoundary>
          </div>
        )}
      </AppChrome>
    </LocaleContext.Provider>
  );
}
