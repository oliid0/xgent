import type { Context } from "@earendil-works/pi-ai";
import {
  configureLanPcCommandHost,
  invoke,
  isBrowserRuntime,
  LAN_PC_SESSION_CHANGED_EVENT,
  listen,
} from "@xagent/runtime";
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
import { SoulProvider } from "./lib/soul";
import { applyFontFamilies } from "./lib/system/fontFamily";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { SectionId, SettingsOpenOptions } from "./pages/settings/types";
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
  const [soulCreateRequestId, setSoulCreateRequestId] = useState(0);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settings, setSettingsState] = useState<AppSettings>(() => getDefaultSettings());
  const [lanPcCommandHostReady, setLanPcCommandHostReady] = useState(false);
  const [lanPcSessionRevision, setLanPcSessionRevision] = useState(0);
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

  // 同步主题 class 到 <html> 根节点
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", effectiveTheme === "dark");
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
    if (
      !settingsReady ||
      (!desktopBridgeEnabled && !lanPcCommandHostReady && !nativeMobile)
    )
      return;
    void initAutomation().catch((error) => {
      console.warn("Failed to initialize automation store", error);
    });
  }, [desktopBridgeEnabled, lanPcCommandHostReady, nativeMobile, settingsReady]);

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
      <SoulProvider>
        <AppChrome>
          <CronPromptRunner settings={settings} />
          <MemoryOrganizerHost settings={settings} setSettings={setSettings} />
          <AppErrorBoundary>
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
            />
          </AppErrorBoundary>
          {visible && (
            <div
              className={`absolute inset-0 z-50 flex bg-transparent transition-[background-color,opacity] duration-200 ease-out md:items-center md:justify-center md:bg-black/50 md:p-6 ${
                active ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !nativeMobile) {
                  closeSettings();
                }
              }}
              onTransitionEnd={(event) => {
                if (event.target === event.currentTarget) {
                  handleTransitionEnd();
                }
              }}
            >
              <div
                className={`h-full w-full overflow-hidden bg-background transition-[transform,opacity] duration-200 ease-out md:h-[85vh] md:max-h-[900px] md:w-[min(calc(100vw-2rem),900px)] md:rounded-2xl md:border md:border-border md:shadow-2xl ${
                  active
                    ? "translate-y-0 scale-100 opacity-100"
                    : "translate-y-6 scale-100 opacity-0 md:translate-y-0 md:scale-95"
                }`}
              >
                <AppErrorBoundary>
                  <SettingsPage
                    settings={settings}
                    setSettings={setSettings}
                    saveState={settingsSaveState}
                    onBack={closeSettings}
                    initialSection={settingsSection}
                    soulCreateRequestId={soulCreateRequestId}
                    nativeMobile={nativeMobile}
                    appUpdate={appUpdate}
                  />
                </AppErrorBoundary>
              </div>
            </div>
          )}
        </AppChrome>
      </SoulProvider>
    </LocaleContext.Provider>
  );
}
