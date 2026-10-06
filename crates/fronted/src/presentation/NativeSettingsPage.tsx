import { useEffect, useState } from "react";
import { SUPPORTED_LOCALES, useLocale } from "../i18n";
import {
  checkMobileAssistantPermissions,
  type MobileAssistantStatus,
  type MobilePermissionStates,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  openMobileSystemSettings,
  requestMobileAssistantPermission,
} from "../lib/mobileAssistant";
import {
  cancelMobileExecution,
  type ExternalMobileWorkspace,
  installMobileEnvironment,
  installMobileToolchains,
  listExternalMobileWorkspaces,
  listenMobileEnvironmentInstallProgress,
  listenMobileExecutionOutput,
  type MobileEnvironmentInstallProgress,
  type MobileExecutionStatus,
  mobileEnvironmentInstallLabel,
  mobileExecutionStatus,
  pickExternalMobileWorkspace,
  removeExternalMobileWorkspace,
  setMobileAlpineMirror,
} from "../lib/mobileExecution";
import {
  type CustomProvider,
  normalizeFontScale,
  normalizeSettings,
  STT_PROVIDER_IDS,
  type SttProviderId,
  type SttProviderSettings,
  updateCustomSettings,
  updateSystem,
} from "../lib/settings";
import { UI_THEME_PRESETS } from "../lib/settings/appearance";
import { createUuid } from "../lib/shared/id";
import { desktopSttSettingsService } from "../lib/stt/desktopSttSettingsService";
import { STT_PROVIDER_FIELDS } from "../lib/stt/providerFields";
import {
  PERSONAL_CAPABILITIES,
  personalPolicy,
  personalPolicyKey,
} from "../lib/tools/mobileAssistantPolicy";
import { BackupSyncSection } from "../pages/settings/BackupSyncSection";
import { ComputerUseSection } from "../pages/settings/ComputerUseSection";
import { CronSection } from "../pages/settings/CronSection";
import { GlobalShortcutsSection } from "../pages/settings/GlobalShortcutsSection";
import { HooksSection } from "../pages/settings/HooksSection";
import { MobileEnvironmentBrowser } from "../pages/settings/MobileEnvironmentBrowser";
import { MemoryPanel } from "../pages/settings/memory/MemoryPanel";
import { mobileSettingsStatus } from "../pages/settings/mobileSettingsStatus";
import { NativeProviderModelSettings } from "../pages/settings/NativeProviderModelSettings";
import { NativeProviderRequestSettings } from "../pages/settings/NativeProviderRequestSettings";
import { NativeProviderRuntimeSettings } from "../pages/settings/NativeProviderRuntimeSettings";
import { ProjectRootsSection } from "../pages/settings/ProjectRootsSection";
import { SoulSection } from "../pages/settings/SoulSection";
import { SshSettingsSection } from "../pages/settings/SshSettingsSection";
import type { SectionId, SettingsPageProps } from "../pages/settings/types";
import { useCodexOAuthAccounts } from "../pages/settings/useCodexOAuthAccounts";
import { presentationControls } from "./controls";
import { NativeOtherSettings } from "./NativeOtherSettings";
import {
  NativeSurface,
  removeNativeSurfaceSession,
  retainNativeSurfaceSession,
} from "./NativeSurface";
import { useNativeAccessSettings } from "./nativeAccessSettings";
import { createNativeDesktopAppearance } from "./nativeDesktopAppearance";
import { useNativeDesktopProxy } from "./nativeDesktopProxy";
import { useNativeDesktopSystem } from "./nativeDesktopSystem";
import { useNativeFontSettings } from "./nativeFontSettings";
import { nativeOAuthAccounts } from "./nativeOAuthAccounts";
import { useNativeProviderEditor } from "./nativeProviderEditor";
import { useNativeProviderImports } from "./nativeProviderImports";
import { useNativeProviderList } from "./nativeProviderList";
import { useNativeProviderModels } from "./nativeProviderModels";
import { setNativeSettingsChrome } from "./nativeSettingsChrome";
import { withNativeSettingsIcons } from "./nativeSettingsIcons";
import { createNativePresentationTheme } from "./nativeTheme";
import { createNativeToolPermissions } from "./nativeToolPermissions";
import type { PresentationNode } from "./types";

function formatByteCount(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

/** Native navigation uses the same reducers, discovery and persistence as desktop settings. */
export function NativeSettingsPage(props: SettingsPageProps) {
  const [sessionSurface] = useState(() => `settings:${crypto.randomUUID()}`);
  useEffect(() => {
    retainNativeSurfaceSession(sessionSurface);
    return () => removeNativeSurfaceSession(sessionSurface, console.error);
  }, [sessionSurface]);
  const { settings, setSettings, nativeMobile = false } = props;
  const { t } = useLocale();
  const initialPage =
    props.initialSection === "mcp" || props.initialSection === "skills"
      ? nativeMobile
        ? ""
        : "system"
      : nativeMobile && props.initialSection === "system"
        ? ""
        : props.initialSection === "failover" || props.initialSection === "usage"
          ? "providers"
          : (props.initialSection ?? (nativeMobile ? "" : "system"));
  const [page, setPage] = useState(initialPage);
  const desktopSystem = useNativeDesktopSystem(
    { settings, setSettings },
    !nativeMobile && page === "system",
    t,
  );
  const desktopProxy = useNativeDesktopProxy(
    { settings, setSettings },
    !nativeMobile && page === "system",
    t,
  );
  const access = useNativeAccessSettings(
    { settings, setSettings },
    page === "access",
    nativeMobile,
    t,
    props.onBack,
  );
  const fonts = useNativeFontSettings({ settings, setSettings }, page === "system", t);
  const [returnPage, setReturnPage] = useState("");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const [status, setStatus] = useState<MobileAssistantStatus>();
  const [permissions, setPermissions] = useState<MobilePermissionStates>({});
  const [shell, setShell] = useState<MobileExecutionStatus>();
  const [shellFilesOpen, setShellFilesOpen] = useState(false);
  const [shellToolchains, setShellToolchains] = useState<string[]>([]);
  const [shellRunId, setShellRunId] = useState("");
  const [shellInstallOutput, setShellInstallOutput] = useState("");
  const [shellInstallStage, setShellInstallStage] = useState<"rootfs" | "essentials" | "">("");
  const [shellInstallProgress, setShellInstallProgress] =
    useState<MobileEnvironmentInstallProgress | null>(null);
  const [shellWorkspaces, setShellWorkspaces] = useState<ExternalMobileWorkspace[]>([]);
  const [busyScope, setBusyScope] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [providerId, setProviderId] = useState("");
  const [providerRuntimeOpen, setProviderRuntimeOpen] = useState(
    props.initialSection === "failover" || props.initialSection === "usage",
  );
  const [providerModelId, setProviderModelId] = useState("");
  const [providerRequestOpen, setProviderRequestOpen] = useState(false);
  // A stalled Shell/status request must not disable provider controls after
  // navigation. Only the latest operation in the current route owns feedback.
  const [operations] = useState(() => ({ scope: "", revision: 0 }));
  const operationScope = `${page}:${providerId}${page === "voice" ? `:${settings.stt.provider}` : ""}`;
  operations.scope = operationScope;
  const busy = busyScope === operationScope;
  const [providerUrlDraft, setProviderUrlDraft] = useState<{ id: string; value: string } | null>(
    null,
  );
  const [voiceTest, setVoiceTest] = useState<{
    ok: boolean;
    message: string;
    configuration: typeof settings.stt;
  } | null>(null);
  const [voiceRequests] = useState(() => ({
    configuration: settings.stt,
    active: false,
    mounted: true,
    revision: 0,
  }));
  const voiceActive = page === "voice" && !nativeMobile;
  if (voiceRequests.configuration !== settings.stt || voiceRequests.active !== voiceActive) {
    voiceRequests.configuration = settings.stt;
    voiceRequests.active = voiceActive;
    voiceRequests.revision++;
  }
  useEffect(() => {
    voiceRequests.mounted = true;
    return () => {
      voiceRequests.mounted = false;
      voiceRequests.revision++;
    };
  }, [voiceRequests]);
  useEffect(() => {
    // External shortcuts can change the destination while Settings remains open.
    setPage(initialPage);
    setReturnPage("");
    setProviderId("");
    setProviderModelId("");
    setProviderRequestOpen(false);
    setProviderUrlDraft(null);
    setProviderRuntimeOpen(props.initialSection === "failover" || props.initialSection === "usage");
    setShellFilesOpen(false);
    setError("");
    operations.revision++;
  }, [props.initialSection, nativeMobile]);
  const providerEditor = useNativeProviderEditor(props, providerId, page === "providers", t);
  const provider = providerEditor.provider;
  const providerProps = {
    ...props,
    settings: providerEditor.settings,
    setSettings: providerEditor.setSettings,
  };
  // Native controls can finish editing after a route changes. Reused field
  // IDs retain their layout identity; their actions belong to this provider
  // and authentication mode so a late credential cannot edit another account.
  const c = presentationControls(
    page === "providers" && provider
      ? JSON.stringify([
          "provider",
          provider.id,
          provider.type,
          provider.authMode ?? "api-key",
          providerEditor.revision,
        ])
      : undefined,
  );
  const oauth = useCodexOAuthAccounts(
    {
      value: provider?.oauthAccountId ?? "",
      onChange: (oauthAccountId) =>
        patchProvider({ oauthAccountId, apiKeyConfigured: !!oauthAccountId }),
      browserRuntime: false,
      enabled:
        page === "providers" && provider?.type === "codex" && provider.authMode === "oauth-managed",
      scopeKey: `${page}:${providerId}:${provider?.authMode ?? "api-key"}`,
    },
    t,
  );
  // Keep the entered endpoint like the desktop provider form. Persistence strips
  // API suffixes in base-URL mode; switching to an exact endpoint must restore it.
  const providerUrl =
    providerUrlDraft?.id === providerId ? providerUrlDraft.value : (provider?.baseUrl ?? "");
  const providerModels = useNativeProviderModels(
    providerProps,
    page === "providers" ? provider : undefined,
    page === "providers" &&
      !!provider &&
      !providerModelId &&
      !providerRuntimeOpen &&
      !providerRequestOpen,
    busy,
    work,
    setProviderModelId,
    t,
  );
  const providerList = useNativeProviderList(
    props,
    page === "providers" && !provider,
    setProviderId,
    t,
  );
  const providerImports = useNativeProviderImports(
    props,
    !nativeMobile && page === "providers" && !provider,
    providerList.type,
    t,
  );
  const returnToSettings = () => {
    setPage(nativeMobile ? returnPage : "system");
    setReturnPage("");
  };

  async function refreshShell() {
    const next = await mobileExecutionStatus();
    setShell(next);
    setShellToolchains((current) =>
      current.filter((id) =>
        next.toolchains.some((tool) => tool.id === id && tool.installable && !tool.installed),
      ),
    );
    // Folder grants have their own failure state; they must not disable the installer.
    try {
      setShellWorkspaces(await listExternalMobileWorkspaces());
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function installShellToolchains(toolchains = shellToolchains) {
    const runId = `mobile-install-${createUuid()}`;
    setShellRunId(runId);
    setShellInstallOutput("");
    let stopOutput: (() => Promise<void>) | undefined;
    try {
      const decoder = { stdout: new TextDecoder(), stderr: new TextDecoder() };
      stopOutput = await listenMobileExecutionOutput((event) => {
        if (event.runId !== runId || (event.stream !== "stdout" && event.stream !== "stderr"))
          return;
        try {
          const bytes = Uint8Array.from(atob(event.data), (char) => char.charCodeAt(0));
          const chunk = decoder[event.stream].decode(bytes, { stream: true });
          setShellInstallOutput((current) => (current + chunk).slice(-8_192));
        } catch {
          // The final plugin response still contains the authoritative output.
        }
      }).catch(() => undefined);
      const result = await installMobileToolchains(toolchains, runId);
      const completedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      if (completedOutput) setShellInstallOutput(completedOutput.slice(-8_192));
      await refreshShell();
      if (!result.succeeded)
        throw new Error(
          result.cancelled
            ? t("settings.mobileInstallCancelled")
            : result.stderr.trim() || `Package installation exited with code ${result.exitCode}`,
        );
    } finally {
      await stopOutput?.().catch(() => undefined);
      setShellRunId("");
    }
  }

  async function installShellEnvironment() {
    setShellInstallStage("rootfs");
    setShellInstallProgress({ phase: "preparing" });
    const stopProgress = await listenMobileEnvironmentInstallProgress(
      setShellInstallProgress,
    ).catch(() => undefined);
    try {
      const installed = await installMobileEnvironment();
      if (!installed.installed)
        throw new Error(installed.detail || t("settings.mobileNotInstalled"));
      await refreshShell();
      if (installed.backend === "android-proot") {
        setShellInstallStage("essentials");
        try {
          await installShellToolchains(["essentials"]);
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          throw new Error(t("settings.native.shellEssentialsError").replace("{detail}", detail));
        }
      }
    } catch (cause) {
      // The Android installer restores the previous rootfs after a failed probe.
      // Recheck it so the next chat turn sees the recovered Shell capability.
      await refreshShell().catch(() => undefined);
      throw cause;
    } finally {
      stopProgress?.();
      setShellInstallProgress(null);
      setShellInstallStage("");
    }
  }

  async function refreshPermissions() {
    const next = await mobileAssistantStatus();
    setStatus(next);
    // Show supported permissions even if an OS authorization status query fails.
    const states = await checkMobileAssistantPermissions();
    setPermissions(normalizeMobileAssistantPermissions(next, states));
  }
  async function work(run: () => Promise<unknown>) {
    const revision = ++operations.revision;
    setBusyScope(operationScope);
    setError("");
    try {
      await run();
    } catch (cause) {
      if (operations.scope === operationScope && operations.revision === revision) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    } finally {
      if (operations.revision === revision) setBusyScope(null);
    }
  }
  useEffect(() => {
    if ((page === "mobileAssistant" || page === "voice") && nativeMobile)
      void work(refreshPermissions).catch(() => undefined);
    if (page === "mobileExecution" && nativeMobile) void work(refreshShell).catch(() => undefined);
  }, [page, nativeMobile]);
  useEffect(() => {
    if (page !== "mobileAssistant" || !nativeMobile) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        void work(refreshPermissions).catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [page, nativeMobile]);
  if (failure) throw failure;

  function patchProvider(patch: Partial<CustomProvider>) {
    providerEditor.patch(patch);
  }
  function patchSttProvider(patch: Partial<SttProviderSettings>) {
    const targetProvider = settings.stt.provider;
    voiceRequests.revision++;
    setVoiceTest(null);
    setError("");
    setSettings((previous) =>
      normalizeSettings({
        ...previous,
        stt: {
          ...previous.stt,
          providers: {
            ...previous.stt.providers,
            [targetProvider]: {
              ...previous.stt.providers[targetProvider],
              ...patch,
            },
          },
        },
      }),
    );
  }
  function row(
    id: string,
    label: string,
    icon: string,
    run: () => unknown,
    text?: string,
  ): PresentationNode {
    return { ...c.action(id, label, run, !busy), kind: "NavigationRow", icon, text };
  }
  const titles: Record<string, string> = {
    system: t("settings.navSystem"),
    providers: t("settings.navProviders"),
    memory: t("settings.navMemory"),
    soul: t("settings.navSoul"),
    other: t("settings.navOther"),
    hooks: t("settings.navHooks"),
    toolPermissions: t("settings.toolPermissionsTitle"),
    voice: t("settings.navVoice"),
    access: t("settings.navAccess"),
    backup: t("settings.navBackup"),
    shortcuts: t("settings.navShortcuts"),
    computerUse: t("settings.cua.title"),
    mobileAssistant: t("settings.mobileAssistant.permissions"),
    mobileExecution: t("settings.native.shellTitle"),
    cron: t("settings.navCron"),
    ssh: t("settings.navSsh"),
    about: t("settings.navAbout"),
    projectRoots: t("settings.navProjectRoots"),
  };
  const desktopSections: Array<{ id: SectionId; icon: string }> = [
    { id: "system", icon: "gearshape" },
    { id: "providers", icon: "cpu" },
    { id: "shortcuts", icon: "keyboard" },
    { id: "backup", icon: "archivebox" },
    { id: "computerUse", icon: "display" },
    { id: "toolPermissions", icon: "lock.shield" },
    { id: "voice", icon: "mic" },
    { id: "soul", icon: "person.crop.circle" },
    { id: "memory", icon: "brain" },
    { id: "other", icon: "ellipsis.circle" },
    { id: "access", icon: "icloud" },
    { id: "about", icon: "info.circle" },
  ];
  const normalizedQuery = settingsQuery.trim().toLocaleLowerCase();
  const desktopNavigation = desktopSections
    .filter(({ id }) => !props.hiddenSections?.includes(id))
    .filter(
      ({ id }) => !normalizedQuery || titles[id].toLocaleLowerCase().includes(normalizedQuery),
    )
    .map(
      ({ id, icon }): PresentationNode => ({
        ...row(`desktop-nav:${id}`, titles[id], icon, () => {
          providerEditor.cancel();
          setProviderId("");
          setProviderUrlDraft(null);
          setProviderRuntimeOpen(false);
          setProviderModelId("");
          setProviderRequestOpen(false);
          setReturnPage("");
          setPage(id);
          setError("");
        }),
        selected: page === id || (id === "other" && ["hooks", "cron", "ssh"].includes(page)),
      }),
    );
  const settingsSidebar: PresentationNode = {
    id: "settings-sidebar",
    kind: "VStack",
    fill: true,
    spacing: 12,
    padding: 16,
    children: [
      { id: "settings-title", kind: "Heading", text: t("settings.title") },
      {
        ...c.input(
          "settings-search",
          t("settings.searchPlaceholder"),
          settingsQuery,
          setSettingsQuery,
        ),
        variant: "settings-search",
        children: [
          {
            ...c.action(
              "settings-search-clear",
              t("chat.history.searchClear"),
              () => setSettingsQuery(""),
              !busy && !!settingsQuery,
            ),
            kind: "IconButton",
            icon: "xmark.circle.fill",
            variant: "ghost",
          },
        ],
      },
      { id: "settings-navigation", kind: "List", children: desktopNavigation },
      ...(!desktopNavigation.length
        ? [
            {
              id: "settings-search-empty",
              kind: "EmptyState" as const,
              label: t("settings.searchEmpty"),
            },
          ]
        : []),
      { id: "settings-sidebar-space", kind: "Spacer" },
      {
        ...c.action("settings-close", t("settings.close"), props.onBack, !busy),
        kind: "IconButton",
        icon: "xmark",
        variant: "ghost",
      },
    ],
  };
  setNativeSettingsChrome(
    sessionSurface,
    nativeMobile
      ? undefined
      : {
          sidebar: settingsSidebar,
          saveStatus: {
            id: "save-status",
            kind: "Text",
            secondary: props.saveState.status !== "error",
            text:
              props.saveState.status === "error"
                ? props.saveState.message
                : t(
                    provider
                      ? "workspaceEditor.unsaved"
                      : props.saveState.status === "saving"
                        ? "settings.saving"
                        : "settings.saved",
                  ),
          },
          handlers: new Map(c.handlers),
        },
  );
  if (page === "providers" && providerRequestOpen && provider)
    return (
      <NativeProviderRequestSettings
        key={provider.id}
        settings={providerEditor.settings}
        setSettings={providerEditor.setSettings}
        providerId={provider.id}
        canTestUsage={!providerEditor.isNew}
        onBack={() => setProviderRequestOpen(false)}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "providers" && providerImports.opened)
    return (
      <NativeSurface
        sessionSurface={sessionSurface}
        document={{
          mode: "sheet",
          title: providerImports.source === "ccs" ? "CC Switch" : "Cherry Studio",
          appearance: settings.theme,
          formFactor: "desktop",
          theme: createNativePresentationTheme(settings, false),
          dismissAction: "provider-import-back",
          nodes: providerImports.formNodes,
        }}
        handlers={providerImports.handlers}
        onError={providerImports.notice}
      />
    );
  if (page === "providers" && providerModelId && provider)
    return (
      <NativeProviderModelSettings
        key={`${provider.id}:${providerModelId}`}
        settings={providerEditor.settings}
        setSettings={providerEditor.setSettings}
        providerId={provider.id}
        modelId={providerModelId}
        onBack={() => setProviderModelId("")}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "providers" && providerRuntimeOpen)
    return (
      <NativeProviderRuntimeSettings
        settings={settings}
        setSettings={setSettings}
        providerType={provider?.type ?? "codex"}
        onBack={() => setProviderRuntimeOpen(false)}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "mobileExecution" && shellFilesOpen && shell?.installed && shell.environmentRootPath)
    return (
      <MobileEnvironmentBrowser
        open
        rootPath={shell.environmentRootPath}
        backend={shell.backend}
        onClose={() => setShellFilesOpen(false)}
        nativeSettingsSurfaceId={sessionSurface}
        appearance={settings.theme}
        theme={createNativePresentationTheme(settings, nativeMobile)}
      />
    );
  if (page === "other")
    return (
      <NativeOtherSettings
        settings={settings}
        setSettings={setSettings}
        nativeSettingsSurfaceId={sessionSurface}
        mobile={nativeMobile}
        saveState={props.saveState}
        onBack={returnToSettings}
        onClose={props.onBack}
      />
    );
  if (page === "ssh")
    return (
      <SshSettingsSection
        settings={settings}
        setSettings={setSettings}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "projectRoots")
    return (
      <ProjectRootsSection
        settings={settings}
        setSettings={setSettings}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "cron")
    return (
      <CronSection
        settings={settings}
        setSettings={setSettings}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "hooks")
    return (
      <HooksSection
        settings={settings}
        setSettings={setSettings}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "soul")
    return (
      <SoulSection
        settings={settings}
        createRequestId={props.soulCreateRequestId}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "backup")
    return (
      <BackupSyncSection
        settings={settings}
        setSettings={setSettings}
        reloadSettings={props.reloadSettings}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "memory")
    return (
      <MemoryPanel
        settings={settings}
        setSettings={setSettings}
        compact={nativeMobile}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "shortcuts" && !nativeMobile)
    return (
      <GlobalShortcutsSection
        settings={settings}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  if (page === "computerUse" && !nativeMobile)
    return (
      <ComputerUseSection
        settings={settings}
        setSettings={setSettings}
        onBack={returnToSettings}
        nativeSettingsSurfaceId={sessionSurface}
      />
    );
  const nodes: PresentationNode[] = [];
  if (page && (nativeMobile || providerId))
    nodes.push({
      ...c.action("back", t("settings.native.back"), () => {
        if (providerId) {
          if (!providerEditor.cancel()) return;
          setProviderId("");
          setProviderUrlDraft(null);
        } else {
          setPage(returnPage);
          setReturnPage("");
        }
        setError("");
      }),
      icon: "chevron.left",
    });
  if (props.saveState.status === "error")
    nodes.push({
      id: "save-status",
      kind: "Text",
      text: `${t("settings.saveError")}: ${props.saveState.message}`,
    });
  if (error) nodes.push({ id: "error", kind: "Banner", label: error, status: "error" });
  if (busy)
    nodes.push({
      id: "busy",
      kind: "Progress",
      label:
        shellInstallStage === "rootfs"
          ? mobileEnvironmentInstallLabel(shellInstallProgress, t)
          : shellInstallStage === "essentials"
            ? t("settings.native.shellInstallingEssentials")
            : t("app.loading"),
    });
  const currentVersion =
    props.appUpdate.result?.currentVersion ??
    (typeof __XGENT_APP_VERSION__ === "string" ? __XGENT_APP_VERSION__ : undefined);
  const navigate = (id: SectionId, icon: string, description?: string): PresentationNode => ({
    ...row(
      `nav:${id}`,
      titles[id],
      icon,
      () => {
        setReturnPage(page);
        setPage(id);
      },
      description,
    ),
    ...(nativeMobile && !page
      ? {
          variant: "settings-index-navigation",
          value:
            id === "about" && currentVersion
              ? `v${currentVersion}`
              : mobileSettingsStatus(id, settings, t),
        }
      : {}),
  });
  const visible = (id: SectionId) => !props.hiddenSections?.includes(id);

  if (!page && nativeMobile) {
    const appearance = settings.customSettings.appearance;
    const updateAppearance = (patch: Partial<typeof appearance>) =>
      setSettings((previous) =>
        updateCustomSettings(previous, {
          appearance: { ...previous.customSettings.appearance, ...patch },
        }),
      );
    nodes.push(
      c.group("mobile-theme", "", [
        c.select(
          "theme",
          t("settings.native.appearance"),
          settings.theme,
          [
            { value: "system", label: t("settings.native.system") },
            { value: "light", label: t("settings.native.light") },
            { value: "dark", label: t("settings.native.dark") },
          ],
          (theme) =>
            setSettings((previous) => ({ ...previous, theme: theme as typeof previous.theme })),
        ),
        c.select(
          "appearance-preset",
          t("settings.ui.preset"),
          appearance.preset,
          UI_THEME_PRESETS.map((value) => ({
            value,
            label:
              value === "current"
                ? t("settings.ui.current")
                : value === "stone"
                  ? "Stone"
                  : "Matcha",
          })),
          (preset) =>
            updateAppearance({
              preset: preset as typeof appearance.preset,
              customized: false,
            }),
        ),
      ]),
      c.group("mobile-appearance", t("settings.mobile.appearanceGroup"), [
        ...(visible("system")
          ? [navigate("system", "gearshape", t("settings.mobile.systemDescription"))]
          : []),
        ...(visible("providers")
          ? [navigate("providers", "cpu", t("settings.mobile.providersDescription"))]
          : []),
      ]),
      c.group("mobile-personal", t("settings.mobile.personalGroup"), [
        ...(visible("soul")
          ? [navigate("soul", "sparkles", t("settings.mobile.soulDescription"))]
          : []),
        ...(visible("memory")
          ? [navigate("memory", "brain", t("settings.mobile.memoryDescription"))]
          : []),
        ...(visible("mobileAssistant")
          ? [navigate("mobileAssistant", "shield", t("settings.mobile.assistantDescription"))]
          : []),
      ]),
      c.group("mobile-capabilities", t("settings.mobile.capabilitiesGroup"), [
        ...(visible("mobileExecution")
          ? [navigate("mobileExecution", "terminal", t("settings.native.shellEnvironment"))]
          : []),
        ...(visible("toolPermissions")
          ? [navigate("toolPermissions", "lock.shield", t("settings.toolPermissionsTitle"))]
          : []),
        ...(visible("voice") ? [navigate("voice", "mic", t("settings.stt.desc"))] : []),
        ...(visible("other")
          ? [navigate("other", "ellipsis.circle", t("settings.mobile.otherDescription"))]
          : []),
        ...(visible("access")
          ? [navigate("access", "icloud", t("settings.mobile.accessDescription"))]
          : []),
        ...(visible("backup")
          ? [navigate("backup", "archivebox", t("settings.backupSyncDesc"))]
          : []),
        ...(visible("about")
          ? [navigate("about", "info.circle", t("settings.mobile.aboutDescription"))]
          : []),
      ]),
    );
  } else if (!page) {
    const appearance = settings.customSettings.appearance;
    const fontScaleOptions = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4].map((value) => ({
      value: String(value),
      label: `${Math.round(value * 100)}%`,
    }));
    const updateAppearance = (patch: Partial<typeof appearance>) =>
      setSettings((previous) =>
        updateCustomSettings(previous, {
          appearance: { ...previous.customSettings.appearance, ...patch },
        }),
      );
    nodes.push(
      c.group("appearance", t("settings.native.theme"), [
        c.select(
          "theme",
          t("settings.native.appearance"),
          settings.theme,
          [
            { value: "system", label: t("settings.native.system") },
            { value: "light", label: t("settings.native.light") },
            { value: "dark", label: t("settings.native.dark") },
          ],
          (theme) =>
            setSettings((previous) => ({ ...previous, theme: theme as typeof previous.theme })),
        ),
        c.select(
          "appearance-preset",
          t("settings.ui.preset"),
          appearance.preset,
          UI_THEME_PRESETS.map((value) => ({
            value,
            label:
              value === "current"
                ? t("settings.ui.current")
                : value === "stone"
                  ? "Stone"
                  : "Matcha",
          })),
          (preset) =>
            updateAppearance({
              preset: preset as typeof appearance.preset,
              customized: false,
            }),
        ),
        c.toggle(
          "appearance-customized",
          t("settings.ui.customize"),
          appearance.customized,
          (customized) => updateAppearance({ customized }),
        ),
        ...(appearance.customized
          ? [
              c.color(
                "accent-light",
                t("settings.ui.accentLight"),
                appearance.accentLight,
                (accentLight) => updateAppearance({ accentLight }),
              ),
              c.color(
                "accent-dark",
                t("settings.ui.accentDark"),
                appearance.accentDark,
                (accentDark) => updateAppearance({ accentDark }),
              ),
              c.color(
                "sidebar-light",
                t("settings.ui.sidebarLight"),
                appearance.sidebarLight,
                (sidebarLight) => updateAppearance({ sidebarLight }),
              ),
              c.color(
                "sidebar-dark",
                t("settings.ui.sidebarDark"),
                appearance.sidebarDark,
                (sidebarDark) => updateAppearance({ sidebarDark }),
              ),
              c.select(
                "appearance-radius",
                t("settings.ui.radius"),
                String(appearance.radius),
                [...new Set([0, 8, 12, 16, 24, 32, appearance.radius])]
                  .sort((a, b) => a - b)
                  .map((value) => ({ value: String(value), label: `${value}px` })),
                (radius) => updateAppearance({ radius: Number(radius) }),
              ),
            ]
          : []),
        ...(
          [
            ["sidebar", t("settings.fontSizeSidebar")],
            ["chat", t("settings.fontSizeChat")],
            ["workspaceTools", t("settings.fontSizeWorkspaceTools")],
          ] as const
        ).map(([zone, label]) =>
          c.select(
            `font-scale:${zone}`,
            label,
            String(settings.customSettings.fontScale[zone]),
            fontScaleOptions,
            (value) =>
              setSettings((previous) =>
                updateCustomSettings(previous, {
                  fontScale: {
                    ...previous.customSettings.fontScale,
                    [zone]: normalizeFontScale(Number(value)),
                  },
                }),
              ),
          ),
        ),
        c.toggle(
          "thinking",
          t("settings.native.showReasoning"),
          settings.customSettings.appearance.showThinking,
          (showThinking) =>
            setSettings((previous) =>
              updateCustomSettings(previous, {
                appearance: { ...previous.customSettings.appearance, showThinking },
              }),
            ),
        ),
      ]),
    );
    nodes.push(
      c.group("app-settings", t("settings.native.appSettings"), [
        ...(visible("system") ? [navigate("system", "gearshape")] : []),
        ...(visible("providers") ? [navigate("providers", "cpu")] : []),
        ...(!nativeMobile && visible("shortcuts") ? [navigate("shortcuts", "keyboard")] : []),
        ...(!nativeMobile && visible("computerUse") ? [navigate("computerUse", "display")] : []),
        ...(nativeMobile
          ? [
              ...(visible("mobileAssistant") ? [navigate("mobileAssistant", "hand.raised")] : []),
              ...(visible("mobileExecution") ? [navigate("mobileExecution", "terminal")] : []),
            ]
          : []),
        ...(!nativeMobile && visible("toolPermissions")
          ? [navigate("toolPermissions", "lock.shield")]
          : []),
        ...(visible("voice") ? [navigate("voice", "mic")] : []),
        ...(visible("other") ? [navigate("other", "ellipsis.circle")] : []),
        ...(visible("access") ? [navigate("access", "icloud")] : []),
        ...(visible("backup") ? [navigate("backup", "archivebox")] : []),
        ...(visible("soul") ? [navigate("soul", "person.crop.circle")] : []),
        ...(visible("memory") ? [navigate("memory", "brain")] : []),
        ...(visible("about") ? [navigate("about", "info.circle")] : []),
      ]),
    );
  } else if (page === "system") {
    const executionMode = {
      ...c.select(
        "mode",
        t("settings.executionMode"),
        settings.system.executionMode === "text" ? "text" : "tools",
        [
          { value: "text", label: t("settings.chatMode") },
          { value: "tools", label: t("settings.agentMode") },
        ],
        (value) =>
          setSettings((previous) =>
            updateSystem(previous, {
              executionMode: value === "text" ? "text" : "tools",
            }),
          ),
      ),
      icon: "bubble.left.and.bubble.right",
      text: t(
        settings.system.executionMode === "text"
          ? "settings.chatModeDesc"
          : "settings.agentModeDesc",
      ),
    };
    const language = c.select(
      "language",
      t("settings.language"),
      settings.locale,
      SUPPORTED_LOCALES.map((value) => ({
        value,
        label: t(
          value === "system"
            ? "settings.auto"
            : value === "zh-CN"
              ? "settings.chinese"
              : "settings.english",
        ),
      })),
      (locale) =>
        setSettings((previous) => ({ ...previous, locale: locale as typeof previous.locale })),
    );
    if (nativeMobile) {
      nodes.push(c.group("general", "", [executionMode, { ...language, icon: "globe" }]));
      const appearance = createNativeDesktopAppearance({ settings, setSettings }, t, false);
      nodes.push(...appearance.nodes);
      for (const [id, handler] of appearance.handlers) c.handlers.set(id, handler);
      nodes.push(...fonts.nodes);
      for (const [id, handler] of fonts.handlers) c.handlers.set(id, handler);
    } else {
      nodes.push(c.group("execution-mode", "", [executionMode]));
      nodes.push(...desktopSystem.nodes.filter((node) => node.id === "desktop-terminal"));
      nodes.push(
        c.group("general", "", [
          c.select(
            "theme",
            t("settings.appearance"),
            settings.theme,
            [
              { value: "system", label: t("settings.auto") },
              { value: "light", label: t("settings.light") },
              { value: "dark", label: t("settings.dark") },
            ],
            (theme) =>
              setSettings((previous) => ({ ...previous, theme: theme as typeof previous.theme })),
          ),
          language,
        ]),
      );
      const appearance = createNativeDesktopAppearance({ settings, setSettings }, t);
      nodes.push(...appearance.nodes.filter((node) => node.id === "desktop-appearance"));
      for (const [id, handler] of appearance.handlers) c.handlers.set(id, handler);
      nodes.push(...fonts.nodes);
      for (const [id, handler] of fonts.handlers) c.handlers.set(id, handler);
      nodes.push(...appearance.nodes.filter((node) => node.id !== "desktop-appearance"));
      nodes.push(...desktopSystem.nodes.filter((node) => node.id !== "desktop-terminal"));
      for (const [id, handler] of desktopSystem.handlers) c.handlers.set(id, handler);
      nodes.push(...desktopProxy.nodes);
      for (const [id, handler] of desktopProxy.handlers) c.handlers.set(id, handler);
    }
  } else if (page === "providers") {
    const providerRuntimeAction = {
      ...c.action(
        "provider-runtime-settings",
        t("settings.openCustomSettings"),
        () => setProviderRuntimeOpen(true),
        !busy,
      ),
      kind: "IconButton" as const,
      icon: "slider.horizontal.3",
      size: "large" as const,
      variant: "ghost",
    };
    if (!provider) {
      const [vendorSelector, ...providerRows] = providerList.nodes;
      nodes.push({
        id: "provider-category-toolbar",
        kind: "HStack",
        variant: "provider-category-toolbar",
        children: [...(vendorSelector ? [vendorSelector] : []), providerRuntimeAction],
      });
      nodes.push(...providerImports.listNodes);
      for (const [id, handler] of providerImports.handlers) c.handlers.set(id, handler);
      nodes.push(...providerRows);
      for (const [id, handler] of providerList.handlers) c.handlers.set(id, handler);
      nodes.push(
        c.action("add-provider", t("settings.native.addProvider"), () => {
          const id = providerEditor.add(providerList.type);
          if (id) setProviderId(id);
        }),
      );
    } else {
      nodes.push(providerRuntimeAction);
      nodes.push(
        c.group("provider-details", provider.name, [
          c.input("provider-name", t("settings.native.name"), provider.name, (name) =>
            patchProvider({ name }),
          ),
          c.select(
            "provider-type",
            t("settings.native.api"),
            provider.type,
            ["codex", "claude_code", "gemini", "xai", "deepseek"].map((value) => ({
              value,
              label: value === "codex" ? "OpenAI compatible" : value,
            })),
            (type) =>
              patchProvider({
                type: type as CustomProvider["type"],
                authMode: "api-key",
                oauthAccountId: undefined,
              }),
          ),
          c.input("provider-url", "Base URL", providerUrl, (baseUrl) => {
            setProviderUrlDraft({ id: provider.id, value: baseUrl });
            patchProvider({ baseUrl });
          }),
          ...(provider.type === "gemini"
            ? []
            : [
                c.input(
                  "provider-models-url",
                  t("settings.providerModelsUrl"),
                  provider.modelsUrl ?? "",
                  (modelsUrl) => patchProvider({ modelsUrl: modelsUrl || undefined }),
                  false,
                  true,
                  (value) => value.trim(),
                ),
              ]),
          c.toggle(
            "full-url",
            t("settings.native.exactEndpoint"),
            provider.isFullUrl,
            (isFullUrl) => patchProvider({ isFullUrl, baseUrl: providerUrl }),
          ),
          ...(provider.type === "codex" || provider.type === "claude_code"
            ? [
                c.select(
                  "provider-auth",
                  t("settings.providerAuthMethod"),
                  provider.authMode ?? "api-key",
                  [
                    { value: "api-key", label: t("settings.providerAuthApiKey") },
                    ...(provider.type === "codex"
                      ? [{ value: "oauth-managed", label: t("settings.providerAuthOAuth") }]
                      : []),
                    { value: "oauth-token", label: t("settings.providerAuthToken") },
                  ],
                  (authMode) =>
                    patchProvider({
                      authMode: authMode as CustomProvider["authMode"],
                      oauthAccountId: undefined,
                      apiKey: authMode === "oauth-managed" ? "" : provider.apiKey,
                      apiKeyConfigured: authMode !== "oauth-managed" && !!provider.apiKey,
                      customHeaders:
                        authMode === "oauth-token"
                          ? provider.customHeaders
                          : provider.customHeaders?.filter(
                              (header) => header.key.toLowerCase() !== "chatgpt-account-id",
                            ),
                    }),
                ),
              ]
            : []),
          ...(provider.authMode === "oauth-managed"
            ? [
                {
                  id: "oauth-managed-hint",
                  kind: "Text" as const,
                  text: t("settings.providerOAuthManagedHintCodex"),
                  secondary: true,
                },
              ]
            : [
                c.input(
                  "provider-key",
                  provider.authMode === "oauth-token"
                    ? t("settings.providerOAuthToken")
                    : "API Key",
                  provider.apiKey,
                  (apiKey) => patchProvider({ apiKey }),
                  true,
                ),
              ]),
          ...(provider.authMode === "oauth-token"
            ? [
                {
                  id: "oauth-token-hint",
                  kind: "Text" as const,
                  secondary: true,
                  text: t(
                    provider.type === "claude_code"
                      ? "settings.providerOAuthHintAnthropic"
                      : "settings.providerOAuthHintCodex",
                  ),
                },
                ...(provider.type === "codex"
                  ? [
                      c.input(
                        "provider-oauth-account-id",
                        t("settings.providerOAuthAccountId"),
                        provider.customHeaders?.find(
                          (header) => header.key.toLowerCase() === "chatgpt-account-id",
                        )?.value ?? "",
                        (value) =>
                          patchProvider({
                            customHeaders: [
                              ...(provider.customHeaders ?? []).filter(
                                (header) => header.key.toLowerCase() !== "chatgpt-account-id",
                              ),
                              ...(value.trim()
                                ? [{ key: "chatgpt-account-id", value: value.trim() }]
                                : []),
                            ],
                          }),
                        false,
                        true,
                        (value) => value.trim(),
                      ),
                      {
                        id: "oauth-account-hint",
                        kind: "Text" as const,
                        text: t("settings.providerOAuthAccountIdHint"),
                        secondary: true,
                      },
                    ]
                  : []),
              ]
            : []),
          ...(provider.type === "codex"
            ? [
                c.select(
                  "request-format",
                  t("settings.native.requestFormat"),
                  provider.requestFormat ?? "openai-responses",
                  [
                    { value: "openai-responses", label: "Responses API" },
                    { value: "openai-completions", label: "Chat Completions" },
                  ],
                  (requestFormat) =>
                    patchProvider({
                      requestFormat: requestFormat as CustomProvider["requestFormat"],
                    }),
                ),
              ]
            : []),
          ...(providerModels.fetch ? [providerModels.fetch] : []),
        ]),
      );
      if (provider.authMode === "oauth-managed")
        nodes.push(nativeOAuthAccounts(c, oauth, provider.oauthAccountId ?? "", t));
      nodes.push(...providerModels.nodes);
      for (const [id, handler] of providerModels.handlers) c.handlers.set(id, handler);
      nodes.push(
        c.action(
          "provider-request-settings",
          t("settings.providerDialogRequest"),
          () => setProviderRequestOpen(true),
          !busy,
        ),
      );
      if (providerEditor.error)
        nodes.push({
          id: "provider-editor-error",
          kind: "Banner",
          label: providerEditor.error,
          status: "error",
        });
      nodes.push({
        id: "provider-editor-actions",
        kind: "HStack",
        variant: "provider-editor-actions",
        spacing: 8,
        children: [
          {
            ...c.action("provider-editor-cancel", t("settings.cancel"), () => {
              if (!providerEditor.cancel()) return;
              setProviderId("");
              setProviderUrlDraft(null);
            }),
            size: "large",
            fill: true,
            variant: "secondary",
          },
          {
            ...c.action("provider-editor-save", t("settings.save"), () => {
              if (!providerEditor.save()) return;
              setProviderId("");
              setProviderUrlDraft(null);
            }),
            size: "large",
            fill: true,
            variant: "primary",
          },
        ],
      });
      const deleteControls = presentationControls(
        JSON.stringify([
          "provider-delete",
          provider.id,
          providerEditor.revision,
          providerEditor.deleteRevision,
        ]),
      );
      if (!providerEditor.isNew)
        nodes.push(
          providerEditor.deletePending
            ? {
                id: "provider-delete-confirmation",
                kind: "Banner",
                label: t("settings.native.deleteProvider"),
                text: t("settings.native.deleteProviderDetail"),
                status: "paused",
                children: [
                  {
                    ...deleteControls.action(
                      "provider-delete-confirm",
                      t("settings.delete"),
                      () => {
                        if (!providerEditor.remove()) return;
                        setProviderId("");
                        setProviderUrlDraft(null);
                      },
                    ),
                    destructive: true,
                  },
                  deleteControls.action("provider-delete-cancel", t("settings.cancel"), () =>
                    providerEditor.cancelRemove(),
                  ),
                ],
              }
            : {
                ...c.action("provider-delete", t("settings.delete"), () =>
                  providerEditor.requestRemove(),
                ),
                destructive: true,
              },
        );
      for (const [id, handler] of deleteControls.handlers) c.handlers.set(id, handler);
    }
  } else if (page === "mobileAssistant") {
    nodes.push(
      c.action(
        "refresh-permissions",
        t("settings.mobileAssistant.refresh"),
        () => work(refreshPermissions),
        !busy,
      ),
    );
    const aliases = Object.keys(
      status?.permissionAliases ?? {},
    ) as (keyof MobilePermissionStates)[];
    const permissionRows: PresentationNode[] = aliases.map((permission) => {
      const state = permissions[permission] ?? "prompt";
      return {
        ...row(
          `permission:${permission}`,
          t(`settings.mobileAssistant.${permission}`),
          "hand.raised",
          () =>
            work(async () => {
              if (!status) return;
              if (state === "denied" || state === "requested") {
                await openMobileSystemSettings();
                return;
              }
              const next = await requestMobileAssistantPermission(
                status.permissionAliases[permission] ?? permission,
              );
              setPermissions(normalizeMobileAssistantPermissions(status, next));
            }),
          t(
            `settings.mobileAssistant.${state === "granted" ? "granted" : state === "requested" ? "requested" : state === "denied" ? "denied" : "notRequested"}`,
          ),
        ),
        disabled: busy || state === "granted",
      };
    });
    if (status?.network) {
      const transport = status.network.transport;
      const networkLabel =
        transport === "wifi"
          ? "Wi-Fi"
          : transport === "cellular"
            ? t("settings.native.cellular")
            : transport === "ethernet"
              ? t("settings.native.ethernet")
              : transport === "none"
                ? t("settings.native.offline")
                : t("settings.native.otherNetwork");
      permissionRows.push({
        id: "network-status",
        kind: "NavigationRow",
        icon: "wifi",
        label: t("settings.native.network"),
        value: networkLabel,
        disabled: true,
      });
    }
    nodes.push(c.group("permissions", titles.mobileAssistant, permissionRows));
    nodes.push(
      c.group(
        "personal-access",
        t("settings.mobileAssistant.agentAccess"),
        PERSONAL_CAPABILITIES.filter(
          (capability) =>
            capability === "clipboard" || status?.permissionAliases[capability] !== undefined,
        ).map((capability) =>
          c.select(
            `personal-policy:${capability}`,
            t(`settings.mobileAssistant.${capability}`),
            personalPolicy(capability, settings.system.toolPolicies),
            ["allow", "ask", "deny"].map((value) => ({
              value,
              label: t(`settings.toolPolicy.${value}`),
            })),
            (value) =>
              setSettings((previous) =>
                updateSystem(previous, {
                  toolPolicies: {
                    ...previous.system.toolPolicies,
                    [personalPolicyKey(capability)]: value as "allow" | "ask" | "deny",
                  },
                }),
              ),
          ),
        ),
      ),
    );
  } else if (page === "mobileExecution") {
    const backendLabel =
      shell?.backend === "android-proot"
        ? "Android PRoot"
        : shell?.backend === "ios-a-shell"
          ? "iOS a-Shell"
          : t("settings.native.unavailable");
    const statusLabel = shell?.installed
      ? t("settings.native.installed")
      : shell?.available
        ? t("settings.native.notInstalled")
        : t("settings.native.unavailable");
    nodes.push(
      c.group("shell-status", t("settings.native.status"), [
        {
          id: "shell-installation-status",
          kind: "StatusDot",
          label: statusLabel,
          status: shell?.installed ? "completed" : shell?.available ? "paused" : "error",
        },
        {
          id: "shell-backend",
          kind: "Text",
          text: `${t("settings.native.backend")}  ·  ${backendLabel}`,
        },
        ...(shell?.environmentVersion
          ? [
              {
                id: "shell-version",
                kind: "Text" as const,
                text: `${t("settings.native.version")}  ·  ${shell.environmentVersion}`,
              },
            ]
          : []),
        ...(shell?.installed
          ? [
              {
                id: "shell-size",
                kind: "Text" as const,
                text: `${t("settings.native.size")}  ·  ${formatByteCount(shell.diskUsageBytes)}`,
              },
            ]
          : []),
        ...(!shell?.installed && shell?.detail
          ? [
              {
                id: "shell-detail",
                kind: "Banner" as const,
                label: shell.detail,
                status: shell.available ? ("paused" as const) : ("error" as const),
              },
            ]
          : []),
      ]),
      c.group("shell-actions", t("settings.native.actions"), [
        c.action(
          "install-shell",
          busy ? t("settings.mobileInstalling") : t("settings.mobileInstallEnvironment"),
          () => work(installShellEnvironment),
          !busy && shell?.installed !== true,
        ),
        c.action("refresh-shell", t("settings.mobileRefresh"), () => work(refreshShell), !busy),
        ...(shell?.installed && shell.environmentRootPath
          ? [
              c.action(
                "browse-shell-files",
                t("settings.mobileFilesBrowse"),
                () => setShellFilesOpen(true),
                !busy,
              ),
            ]
          : []),
      ]),
      ...(shell?.backend === "android-proot" && shell.alpineMirrors?.length
        ? [
            c.group("shell-mirror", t("settings.mobileAlpineMirror"), [
              c.select(
                "alpine-mirror",
                t("settings.mobileAlpineMirror"),
                shell.selectedAlpineMirror ?? "official",
                shell.alpineMirrors.map((mirror) => ({ value: mirror.id, label: mirror.name })),
                (id) =>
                  work(async () => {
                    setShell(await setMobileAlpineMirror(id));
                  }),
                !busy,
              ),
              {
                id: "alpine-mirror-hint",
                kind: "Text",
                text: t("settings.mobileAlpineMirrorHint"),
              },
            ]),
          ]
        : []),
      c.group("shell-toolchains", t("settings.native.toolchains"), [
        ...(shell?.toolchains ?? []).map(
          (tool): PresentationNode =>
            tool.installable && !tool.installed
              ? c.toggle(
                  `shell-pack:${tool.id}`,
                  tool.label,
                  shellToolchains.includes(tool.id),
                  (selected) =>
                    setShellToolchains((current) =>
                      selected ? [...current, tool.id] : current.filter((id) => id !== tool.id),
                    ),
                  !busy && shell?.installed === true,
                )
              : {
                  id: `toolchain:${tool.id}`,
                  kind: "NavigationRow",
                  label: tool.label,
                  text:
                    tool.version ||
                    (tool.installed
                      ? t("settings.native.ready")
                      : t("settings.native.unavailable")),
                  icon: tool.installed ? "checkmark.circle" : "xmark.circle",
                  disabled: true,
                },
        ),
        c.action(
          "install-shell-packs",
          busy ? t("settings.mobileInstalling") : t("settings.mobileInstallSelected"),
          () => work(() => installShellToolchains()),
          !busy && shell?.installed === true && shellToolchains.length > 0,
        ),
        ...(shellRunId
          ? [
              c.action("cancel-shell-packs", t("settings.mobileCancel"), async () => {
                try {
                  await cancelMobileExecution(shellRunId);
                } catch (cause) {
                  setError(String(cause));
                }
              }),
            ]
          : []),
        ...(shellInstallOutput
          ? [
              {
                id: "shell-install-output",
                kind: "CodeBlock" as const,
                label: t("settings.mobileInstallOutput"),
                text: shellInstallOutput.split("\n").slice(-12).join("\n"),
              },
            ]
          : []),
      ]),
      c.group("shell-workspaces", t("settings.native.folders"), [
        c.action(
          "shell-pick-workspace",
          t("settings.mobileMountFolder"),
          () =>
            work(async () => {
              await pickExternalMobileWorkspace(true);
              await refreshShell();
            }),
          !busy,
        ),
        ...shellWorkspaces.map(
          (workspace): PresentationNode =>
            c.group(`workspace:${workspace.id}`, workspace.name, [
              {
                id: `workspace:${workspace.id}:path`,
                kind: "Text",
                text: workspace.path,
                maxLines: 2,
              },
              {
                ...c.action(
                  `remove-workspace:${workspace.id}`,
                  t("settings.delete"),
                  () =>
                    work(async () => {
                      await removeExternalMobileWorkspace(workspace.id);
                      await refreshShell();
                    }),
                  !busy,
                ),
                destructive: true,
              },
            ]),
        ),
      ]),
    );
  } else if (page === "toolPermissions") {
    const permissions = createNativeToolPermissions({ settings, setSettings }, nativeMobile, t);
    nodes.push(...permissions.nodes);
    for (const [id, handler] of permissions.handlers) c.handlers.set(id, handler);
  } else if (page === "voice") {
    if (nativeMobile) {
      nodes.push(
        c.group("voice-general", t("settings.navVoice"), [
          {
            ...c.toggle("voice-enabled", t("settings.navVoice"), settings.stt.enabled, (enabled) =>
              setSettings((previous) =>
                normalizeSettings({ ...previous, stt: { ...previous.stt, enabled } }),
              ),
            ),
            text: t("settings.mobileAssistant.microphoneDescription"),
            icon: "mic",
          },
          {
            id: "voice-device-status",
            kind: "StatusDot",
            label: !status
              ? t(error ? "settings.native.speechUnavailable" : "settings.native.speechChecking")
              : status.voiceInputAvailable
                ? t("settings.native.speechAvailable")
                : t("settings.native.speechUnavailable"),
            status: status?.voiceInputAvailable
              ? "completed"
              : status || error
                ? "error"
                : "running",
          },
          {
            ...row(
              "voice-permissions",
              t("settings.mobileAssistant.microphone"),
              "hand.raised",
              () => {
                setReturnPage("voice");
                setPage("mobileAssistant");
              },
              t(
                `settings.mobileAssistant.${
                  permissions.microphone === "granted"
                    ? "granted"
                    : permissions.microphone === "requested"
                      ? "requested"
                      : permissions.microphone === "denied"
                        ? "denied"
                        : "notRequested"
                }`,
              ),
            ),
            disabled: busy,
          },
        ]),
      );
    } else {
      const providerId = settings.stt.provider;
      const sttProvider = settings.stt.providers[providerId];
      const providerLabels: Record<SttProviderId, string> = {
        aliyun_dashscope: t("settings.native.aliyun"),
        tencent_cloud: t("settings.native.tencent"),
        volcengine_v2: t("settings.native.volcengineV2"),
        volcengine_seed_v3: t("settings.native.volcengineV3"),
        baidu_cloud: t("settings.native.baidu"),
      };
      nodes.push(
        c.group("voice-general", t("settings.stt.title"), [
          {
            ...c.toggle(
              "voice-enabled",
              t("settings.stt.title"),
              settings.stt.enabled,
              (enabled) => {
                voiceRequests.revision++;
                setVoiceTest(null);
                setError("");
                setSettings((previous) =>
                  normalizeSettings({ ...previous, stt: { ...previous.stt, enabled } }),
                );
              },
            ),
            text: t("settings.stt.desc"),
          },
          c.select(
            "voice-provider",
            t("settings.stt.provider"),
            providerId,
            STT_PROVIDER_IDS.map((id) => ({ value: id, label: providerLabels[id] })),
            (value) => {
              voiceRequests.revision++;
              setVoiceTest(null);
              setError("");
              setSettings((previous) =>
                normalizeSettings({
                  ...previous,
                  stt: { ...previous.stt, provider: value as SttProviderId },
                }),
              );
            },
          ),
        ]),
        c.group("voice-provider-fields", providerLabels[providerId], [
          {
            id: "voice-credentials",
            kind: "VStack",
            variant: "voice-credentials",
            children: STT_PROVIDER_FIELDS[providerId].map((field) => ({
              ...c.input(
                `voice:${providerId}:${field.key}`,
                field.label,
                typeof sttProvider[field.key] === "string" ? String(sttProvider[field.key]) : "",
                (value) => patchSttProvider({ [field.key]: value }),
                Boolean(field.secret),
              ),
              text:
                field.secret && sttProvider.configured ? t("settings.stt.secretSaved") : undefined,
            })),
          },
        ]),
        c.action(
          "voice-test",
          t("settings.stt.test"),
          () =>
            work(async () => {
              const configuration = settings.stt;
              const revision = ++voiceRequests.revision;
              const current = () =>
                voiceRequests.mounted &&
                voiceRequests.active &&
                voiceRequests.configuration === configuration &&
                voiceRequests.revision === revision;
              setVoiceTest(null);
              try {
                await desktopSttSettingsService.update(configuration);
                if (!current()) return;
                const result = await desktopSttSettingsService.test(providerId);
                if (!current()) return;
                const ok = result.result === "connected" || result.result === "connected_no_speech";
                setVoiceTest({
                  ok,
                  message: result.message || t(`settings.stt.test.${result.result}`),
                  configuration,
                });
              } catch (cause) {
                if (current()) throw cause;
              }
            }),
          !busy,
        ),
      );
      if (voiceTest?.configuration === settings.stt)
        nodes.push({
          id: "voice-test-result",
          kind: "Banner",
          label: voiceTest.message,
          status: voiceTest.ok ? "completed" : "error",
        });
    }
  } else if (page === "access") {
    nodes.push(...access.nodes);
    for (const [id, handler] of access.handlers) c.handlers.set(id, handler);
  } else if (page === "about") {
    nodes.push(
      { id: "about-name", kind: "Heading", text: "XGent" },
      {
        id: "about-version",
        kind: "Text",
        secondary: true,
        text: `v${props.appUpdate.result?.currentVersion || __XGENT_APP_VERSION__}`,
      },
    );
  } else {
    // Deep links to sections outside this surface return to the functional navigation.
    nodes.push(c.action("home", t("settings.title"), () => setPage("")));
  }
  c.handlers.set(c.actionId("close"), {
    enabled: !busy,
    accepts: (value) => value === null,
    run: props.onBack,
  });
  const renderedNodes: PresentationNode[] = nativeMobile
    ? nodes.map(withNativeSettingsIcons)
    : [
        {
          id: "settings-layout",
          kind: "SettingsLayout",
          fill: true,
          children: [
            settingsSidebar,
            {
              id: "settings-detail",
              kind: "ScrollView",
              fill: true,
              padding: 20,
              children: [
                {
                  id: "settings-detail-title",
                  kind: "Heading",
                  text: provider?.name || titles[page] || t("settings.title"),
                },
                ...nodes,
              ],
            },
          ],
        },
      ];
  return (
    <NativeSurface
      sessionSurface={sessionSurface}
      document={{
        mode: "sheet",
        title: provider?.name || titles[page] || t("settings.title"),
        appearance: settings.theme,
        formFactor: nativeMobile ? "mobile" : "desktop",
        theme: createNativePresentationTheme(settings, nativeMobile),
        nodes: renderedNodes,
        dismissAction: busy ? undefined : c.actionId("close"),
      }}
      handlers={c.handlers}
      onError={setFailure}
    />
  );
}
