import { invoke } from "@xgent/runtime";
import { useEffect, useState } from "react";
import { SUPPORTED_LOCALES, useLocale } from "../i18n";
import {
  applyBackupImport,
  type BackupSyncConfigView,
  downloadBackup,
  exportBackup,
  fetchRemoteInfo,
  loadSyncConfig,
  peekBackupImport,
  saveSyncConfig,
  testSyncConnection,
  uploadBackup,
} from "../lib/backup";
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
  installMobileEnvironment,
  type MobileExecutionStatus,
  mobileExecutionStatus,
} from "../lib/mobileExecution";
import {
  type AppSettings,
  applyMcpOpsToAppSettings,
  type CustomProvider,
  normalizeCustomProvider,
  normalizeFontScale,
  normalizeSettings,
  normalizeSkillsSettings,
  STT_PROVIDER_IDS,
  type SttProviderId,
  type SttProviderSettings,
  updateAccessSettings,
  updateCustomProviders,
  updateCustomSettings,
  updateMemorySettings,
  updateSystem,
} from "../lib/settings";
import { UI_THEME_PRESETS } from "../lib/settings/appearance";
import { createUuid } from "../lib/shared/id";
import { desktopSttSettingsService } from "../lib/stt/desktopSttSettingsService";
import { BUILTIN_TOOL_CATALOG, BUILTIN_TOOL_CATEGORIES } from "../lib/tools/builtinToolCatalog";
import { resolveRuntimeToolCapabilities } from "../lib/tools/runtimeToolCapabilities";
import { MobileSkillsPage } from "../pages/chat/mobile/MobileSkillsPage";
import { canTestSyncConnection } from "../pages/settings/backupSyncForm";
import { ComputerUseSection } from "../pages/settings/ComputerUseSection";
import { CronSection } from "../pages/settings/CronSection";
import { GlobalShortcutsSection } from "../pages/settings/GlobalShortcutsSection";
import { HooksSection } from "../pages/settings/HooksSection";
import {
  createDraftModelConfig,
  fetchModelsFromApi,
  mergeFetchedModels,
} from "../pages/settings/providerUtils";
import { SoulSection } from "../pages/settings/SoulSection";
import { SshSettingsSection } from "../pages/settings/SshSettingsSection";
import type { SectionId, SettingsPageProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import type { PresentationNode } from "./types";

type LanPcClientStatus = {
  paired: boolean;
  baseUrl?: string | null;
  deviceId?: string | null;
  expiresAt?: number | null;
};

type CloudSecretVaultStatus = {
  githubTokenConfigured: boolean;
  githubUsername?: string | null;
};

/** Native navigation uses the same reducers, discovery and persistence as desktop settings. */
export function NativeSettingsPage(props: SettingsPageProps) {
  const { settings, setSettings, nativeMobile = false } = props;
  const { t, locale } = useLocale();
  const [page, setPage] = useState(
    nativeMobile && props.initialSection === "system"
      ? ""
      : (props.initialSection ?? (nativeMobile ? "" : "system")),
  );
  const [settingsQuery, setSettingsQuery] = useState("");
  const [failure, setFailure] = useState<unknown>(null);
  const [status, setStatus] = useState<MobileAssistantStatus>();
  const [permissions, setPermissions] = useState<MobilePermissionStates>({});
  const [shell, setShell] = useState<MobileExecutionStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [providerDeletePending, setProviderDeletePending] = useState(false);
  const [mcpId, setMcpId] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"http" | "sse" | "stdio">("http");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpDeleteId, setMcpDeleteId] = useState("");
  const [lanPairingCode, setLanPairingCode] = useState("");
  const [lanDeviceName, setLanDeviceName] = useState("Xgent mobile");
  const [lanPc, setLanPc] = useState<LanPcClientStatus>({ paired: false });
  const [vault, setVault] = useState<CloudSecretVaultStatus>({
    githubTokenConfigured: false,
  });
  const [accessStatus, setAccessStatus] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [voiceTest, setVoiceTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [backupConfirmation, setBackupConfirmation] = useState<
    | { kind: "import"; path: string }
    | { kind: "upload" }
    | { kind: "download" }
    | { kind: "auto-sync" }
    | null
  >(null);
  const [backupStatus, setBackupStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [backupConfig, setBackupConfig] = useState<BackupSyncConfigView | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const c = presentationControls();
  const tr = (en: string, zh: string) => (locale === "zh-CN" ? zh : en);
  const provider = settings.customProviders.find((item) => item.id === providerId);
  const returnToSettings = () => setPage(nativeMobile ? "" : "system");

  async function refreshPermissions() {
    const [next, states] = await Promise.all([
      mobileAssistantStatus(),
      checkMobileAssistantPermissions(),
    ]);
    setStatus(next);
    setPermissions(normalizeMobileAssistantPermissions(next, states));
  }
  async function work(run: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if ((page === "mobileAssistant" || page === "voice") && nativeMobile)
      void work(refreshPermissions);
    if (page === "mobileExecution" && nativeMobile)
      void work(async () => setShell(await mobileExecutionStatus()));
    if (page === "access") {
      void work(async () => {
        const nextVault = await invoke<CloudSecretVaultStatus>("cloud_secret_vault_status");
        setVault(nextVault);
        if (!nativeMobile) {
          setAccessStatus(
            nextVault.githubTokenConfigured
              ? t("settings.accessTokenConfigured")
              : t("settings.accessTokenMissing"),
          );
          return;
        }
        const lan = await invoke<LanPcClientStatus>("lan_pc_status");
        setLanPc(lan);
        setAccessStatus(
          `${lan.paired ? t("settings.accessComputerPaired") : t("settings.accessComputerNotPaired")} · ${nextVault.githubTokenConfigured ? t("settings.accessTokenConfigured") : t("settings.accessTokenMissing")}`,
        );
      });
    }
    if (page === "backup") {
      void work(async () => {
        setBackupConfig(await loadSyncConfig());
        setBackupPassword("");
      });
    }
  }, [page, nativeMobile]);
  useEffect(() => {
    if (page !== "mobileAssistant" || !nativeMobile) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void work(refreshPermissions);
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
    setSettings((previous) =>
      updateCustomProviders(
        previous,
        previous.customProviders.map((item) =>
          item.id === providerId ? { ...item, ...patch } : item,
        ),
      ),
    );
  }
  function patchAccess(patch: Partial<AppSettings["access"]>) {
    setSettings((previous) => updateAccessSettings(previous, patch));
  }
  function setCapabilityBlocked(
    capability: AppSettings["access"]["blockedLocalCapabilities"][number],
    blocked: boolean,
  ) {
    const next = new Set(settings.access.blockedLocalCapabilities);
    if (blocked) next.add(capability);
    else next.delete(capability);
    patchAccess({ blockedLocalCapabilities: Array.from(next) });
  }
  function patchSttProvider(patch: Partial<SttProviderSettings>) {
    setVoiceTest(null);
    setSettings((previous) =>
      normalizeSettings({
        ...previous,
        stt: {
          ...previous.stt,
          providers: {
            ...previous.stt.providers,
            [previous.stt.provider]: {
              ...previous.stt.providers[previous.stt.provider],
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
    mcp: "MCP",
    skills: t("settings.navSkills"),
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
    mobileExecution: t("settings.mobile.executionDescription"),
    cron: t("settings.navCron"),
    ssh: t("settings.navSsh"),
    about: t("settings.navAbout"),
  };
  if (page === "skills")
    return (
      <MobileSkillsPage
        settings={settings}
        setSettings={setSettings}
        onOpenSidebar={returnToSettings}
      />
    );
  if (page === "ssh")
    return (
      <SshSettingsSection settings={settings} setSettings={setSettings} onBack={returnToSettings} />
    );
  if (page === "cron")
    return <CronSection settings={settings} setSettings={setSettings} onBack={returnToSettings} />;
  if (page === "hooks")
    return (
      <HooksSection settings={settings} setSettings={setSettings} onBack={() => setPage("other")} />
    );
  if (page === "soul")
    return (
      <SoulSection
        settings={settings}
        createRequestId={props.soulCreateRequestId}
        onBack={returnToSettings}
      />
    );
  if (page === "shortcuts" && !nativeMobile)
    return <GlobalShortcutsSection settings={settings} onBack={returnToSettings} />;
  if (page === "computerUse" && !nativeMobile)
    return (
      <ComputerUseSection settings={settings} setSettings={setSettings} onBack={returnToSettings} />
    );
  const nodes: PresentationNode[] = [];
  if (page && (nativeMobile || providerId))
    nodes.push({
      ...c.action("back", tr("Back", "返回"), () => {
        if (providerId) {
          setProviderId("");
          setProviderDeletePending(false);
        } else setPage("");
        setError("");
      }),
      icon: "chevron.left",
    });
  nodes.push({
    id: "save-status",
    kind: "Text",
    secondary: props.saveState.status !== "error",
    text:
      props.saveState.status === "error"
        ? props.saveState.message
        : t(props.saveState.status === "saving" ? "settings.saving" : "settings.saved"),
  });
  if (error) nodes.push({ id: "error", kind: "Text", text: error });
  if (busy) nodes.push({ id: "busy", kind: "Progress", label: t("app.loading") });
  const navigate = (id: string, icon: string) =>
    row("nav:" + id, titles[id], icon, () => setPage(id));
  const visible = (id: SectionId) => !props.hiddenSections?.includes(id);

  if (!page) {
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
      c.group("appearance", tr("Theme", "主题"), [
        c.select(
          "theme",
          tr("Appearance", "外观"),
          settings.theme,
          [
            { value: "system", label: tr("System", "跟随系统") },
            { value: "light", label: tr("Light", "浅色") },
            { value: "dark", label: tr("Dark", "深色") },
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
          tr("Show reasoning", "显示思考过程"),
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
      c.group("app-settings", tr("App settings", "应用设置"), [
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
        ...(visible("toolPermissions") ? [navigate("toolPermissions", "lock.shield")] : []),
        ...(visible("voice") ? [navigate("voice", "mic")] : []),
        ...(visible("mcp") ? [navigate("mcp", "puzzlepiece.extension")] : []),
        ...(visible("other") ? [navigate("other", "ellipsis.circle")] : []),
        ...(visible("access") ? [navigate("access", "icloud")] : []),
        ...(visible("backup") ? [navigate("backup", "archivebox")] : []),
        ...(visible("soul") ? [navigate("soul", "person.crop.circle")] : []),
        ...(visible("memory") ? [navigate("memory", "brain")] : []),
        ...(visible("skills") ? [navigate("skills", "sparkles")] : []),
        ...(visible("about") ? [navigate("about", "info.circle")] : []),
      ]),
    );
  } else if (page === "system") {
    nodes.push(
      c.group("general", titles.system, [
        c.select(
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
        ),
        c.select(
          "mode",
          t("settings.executionMode"),
          settings.system.executionMode === "text" ? "text" : "tools",
          [
            { value: "text", label: t("settings.chatMode") },
            { value: "tools", label: t("settings.agentMode") },
          ],
          (value) =>
            setSettings((previous) =>
              updateSystem(previous, { executionMode: value === "text" ? "text" : "tools" }),
            ),
        ),
      ]),
    );
    nodes.push({
      id: "system-font",
      kind: "Text",
      secondary: true,
      text: tr(
        "Text size, contrast and reduced motion follow system accessibility settings.",
        "字号、对比度和减弱动态效果跟随系统辅助功能设置。",
      ),
    });
  } else if (page === "providers") {
    if (!provider) {
      nodes.push(
        c.group(
          "providers",
          titles.providers,
          settings.customProviders.map((item) =>
            row(
              "provider:" + item.id,
              item.name,
              "cpu",
              () => setProviderId(item.id),
              item.baseUrl,
            ),
          ),
        ),
      );
      nodes.push(
        c.action("add-provider", tr("Add provider", "添加服务商"), () => {
          const id = createUuid();
          const next = normalizeCustomProvider({
            id,
            name: tr("New provider", "新服务商"),
            type: "codex",
          });
          setSettings((previous) =>
            updateCustomProviders(previous, [...previous.customProviders, next]),
          );
          setProviderId(id);
        }),
      );
    } else {
      nodes.push(
        c.group("provider-details", provider.name, [
          c.input("provider-name", tr("Name", "名称"), provider.name, (name) =>
            patchProvider({ name }),
          ),
          c.select(
            "provider-type",
            tr("API", "接口"),
            provider.type,
            ["codex", "claude_code", "gemini", "xai", "deepseek"].map((value) => ({
              value,
              label: value === "codex" ? "OpenAI compatible" : value,
            })),
            (type) => patchProvider({ type: type as CustomProvider["type"] }),
          ),
          c.input("provider-url", "Base URL", provider.baseUrl, (baseUrl) =>
            patchProvider({ baseUrl }),
          ),
          c.toggle(
            "full-url",
            tr("Use exact endpoint", "使用完整接口地址"),
            provider.isFullUrl,
            (isFullUrl) => patchProvider({ isFullUrl }),
          ),
          c.input(
            "provider-key",
            "API Key",
            provider.apiKey,
            (apiKey) => patchProvider({ apiKey }),
            true,
          ),
          ...(provider.type === "codex"
            ? [
                c.select(
                  "request-format",
                  tr("Request format", "请求格式"),
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
          c.action(
            "fetch-models",
            tr("Fetch models", "获取模型"),
            () =>
              work(async () => {
                const targetId = provider.id;
                const fetched = await fetchModelsFromApi(
                  provider.type,
                  provider.baseUrl,
                  provider.apiKey,
                  {
                    ...provider,
                    providerConfigId: targetId,
                  },
                );
                setSettings((previous) =>
                  updateCustomProviders(
                    previous,
                    previous.customProviders.map((item) =>
                      item.id === targetId
                        ? { ...item, models: mergeFetchedModels(fetched, item.models) }
                        : item,
                    ),
                  ),
                );
              }),
            !busy && !!provider.baseUrl.trim(),
          ),
        ]),
      );
      nodes.push(
        c.group(
          "models",
          tr("Enabled models", "启用的模型"),
          provider.models.map((model) =>
            c.toggle(
              "model:" + model.id,
              model.id,
              provider.activeModels.includes(model.id),
              (enabled) =>
                setSettings((previous) =>
                  updateCustomProviders(
                    previous,
                    previous.customProviders.map((item) =>
                      item.id === provider.id
                        ? {
                            ...item,
                            activeModels: enabled
                              ? [...new Set([...item.activeModels, model.id])]
                              : item.activeModels.filter((id) => id !== model.id),
                          }
                        : item,
                    ),
                  ),
                ),
            ),
          ),
        ),
      );
      nodes.push(
        c.group("manual-model", tr("Add model", "添加模型"), [
          c.input("model-id", "Model ID", modelId, setModelId),
          c.action(
            "add-model",
            tr("Add", "添加"),
            () => {
              const id = modelId.trim();
              setSettings((previous) =>
                updateCustomProviders(
                  previous,
                  previous.customProviders.map((item) =>
                    item.id === provider.id
                      ? {
                          ...item,
                          models: item.models.some((model) => model.id === id)
                            ? item.models
                            : [...item.models, createDraftModelConfig(item.type, id)],
                          activeModels: [...new Set([...item.activeModels, id])],
                        }
                      : item,
                  ),
                ),
              );
              setModelId("");
            },
            !!modelId.trim(),
          ),
        ]),
      );
      nodes.push(
        providerDeletePending
          ? {
              id: "provider-delete-confirmation",
              kind: "Banner",
              label: tr("Delete this provider?", "删除这个供应商？"),
              text: tr(
                "Its local credentials and model configuration will be removed.",
                "将移除其本地凭据和模型配置。",
              ),
              status: "paused",
              children: [
                {
                  ...c.action("provider-delete-confirm", t("settings.delete"), () => {
                    const targetId = provider.id;
                    setSettings((previous) =>
                      updateCustomProviders(
                        previous,
                        previous.customProviders.filter((item) => item.id !== targetId),
                      ),
                    );
                    setProviderDeletePending(false);
                    setProviderId("");
                  }),
                  destructive: true,
                },
                c.action("provider-delete-cancel", t("settings.cancel"), () =>
                  setProviderDeletePending(false),
                ),
              ],
            }
          : {
              ...c.action("provider-delete", t("settings.delete"), () =>
                setProviderDeletePending(true),
              ),
              destructive: true,
            },
      );
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
    nodes.push(
      c.group(
        "permissions",
        titles.mobileAssistant,
        aliases.map((permission) => {
          const state = permissions[permission] ?? "prompt";
          return {
            ...row(
              "permission:" + permission,
              t("settings.mobileAssistant." + permission),
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
                "settings.mobileAssistant." +
                  (state === "granted"
                    ? "granted"
                    : state === "requested"
                      ? "requested"
                      : state === "denied"
                        ? "denied"
                        : "notRequested"),
              ),
            ),
            disabled: busy || state === "granted",
          };
        }),
      ),
    );
    if (status?.detail)
      nodes.push({ id: "permissions-detail", kind: "Text", secondary: true, text: status.detail });
  } else if (page === "mobileExecution") {
    nodes.push(
      c.group("shell", "Shell", [
        { id: "shell-status", kind: "Text", text: shell?.detail ?? t("app.loading") },
        c.action(
          "refresh-shell",
          t("settings.mobileAssistant.refresh"),
          () => work(async () => setShell(await mobileExecutionStatus())),
          !busy,
        ),
        c.action(
          "install-shell",
          tr("Prepare environment", "准备运行环境"),
          () =>
            work(async () => {
              await installMobileEnvironment();
              setShell(await mobileExecutionStatus());
            }),
          !busy,
        ),
        ...(shell?.toolchains ?? []).map(
          (tool): PresentationNode => ({
            id: "toolchain:" + tool.id,
            kind: "Text",
            text:
              tool.label +
              " · " +
              (tool.installed ? tr("Ready", "可用") : tr("Unavailable", "不可用")) +
              "\n" +
              (tool.detail ?? ""),
          }),
        ),
      ]),
    );
  } else if (page === "toolPermissions") {
    const capabilities = resolveRuntimeToolCapabilities(nativeMobile ? "native-mobile" : "desktop");
    for (const category of BUILTIN_TOOL_CATEGORIES) {
      const tools = BUILTIN_TOOL_CATALOG.filter(
        (tool) =>
          tool.categoryId === category.id &&
          (tool.toolName !== "ManagedProcess" || capabilities.managedProcess) &&
          (tool.toolName !== "ReadTerminal" || capabilities.terminal),
      );
      nodes.push(
        c.group(
          category.id,
          t(category.labelKey),
          tools.map((tool) =>
            c.select(
              "policy:" + tool.toolName,
              tool.toolName,
              settings.system.toolPolicies?.[tool.toolName] ?? "allow",
              ["allow", "ask", "deny"].map((value) => ({
                value,
                label: t("settings.toolPolicy." + value),
              })),
              (value) =>
                setSettings((previous) =>
                  updateSystem(previous, {
                    toolPolicies: {
                      ...previous.system.toolPolicies,
                      [tool.toolName]: value as "allow" | "ask" | "deny",
                    },
                  }),
                ),
            ),
          ),
        ),
      );
    }
  } else if (page === "memory") {
    nodes.push(
      c.group("memory", titles.memory, [
        c.toggle(
          "organizer",
          tr("Automatic memory organization", "自动整理记忆"),
          settings.memory.organizerEnabled,
          (organizerEnabled) =>
            setSettings((previous) => updateMemorySettings(previous, { organizerEnabled })),
        ),
        c.select(
          "scope",
          tr("Scope", "范围"),
          settings.memory.organizerScope,
          ["all", "global", "projects", "current-project"].map((value) => ({
            value,
            label: value,
          })),
          (scope) =>
            setSettings((previous) =>
              updateMemorySettings(previous, {
                organizerScope: scope as typeof previous.memory.organizerScope,
              }),
            ),
        ),
      ]),
    );
  } else if (page === "mcp") {
    nodes.push(
      ...settings.mcp.servers.map((server) =>
        c.group(`mcp:${server.id}`, server.id, [
          {
            id: `mcp:${server.id}:detail`,
            kind: "Text",
            secondary: true,
            text:
              server.transport === "stdio"
                ? `${server.command} ${server.args.join(" ")}`
                : server.url,
          },
          c.toggle(
            `mcp:${server.id}:enabled`,
            t("settings.enable"),
            server.enabled,
            (enabled) =>
              setSettings((previous) =>
                applyMcpOpsToAppSettings(previous, [
                  { kind: "setEnabled", serverIds: [server.id], enabled },
                ]),
              ),
            !nativeMobile || server.transport !== "stdio",
          ),
          {
            ...c.action(`mcp:${server.id}:remove`, t("settings.delete"), () =>
              setMcpDeleteId(server.id),
            ),
            destructive: true,
          },
        ]),
      ),
    );
    if (mcpDeleteId) {
      nodes.push({
        id: "mcp-delete-confirmation",
        kind: "Banner",
        label: tr(`Delete ${mcpDeleteId}?`, `删除 ${mcpDeleteId}？`),
        status: "paused",
        children: [
          {
            ...c.action("mcp-delete-confirm", t("settings.delete"), () => {
              const serverId = mcpDeleteId;
              setSettings((previous) =>
                applyMcpOpsToAppSettings(previous, [{ kind: "remove", serverId }]),
              );
              setMcpDeleteId("");
            }),
            destructive: true,
          },
          c.action("mcp-delete-cancel", t("settings.cancel"), () => setMcpDeleteId("")),
        ],
      });
    }
    nodes.push(
      c.group("new-mcp", tr("Connect MCP server", "连接 MCP 服务"), [
        c.input("mcp-id", tr("Name", "名称"), mcpId, setMcpId),
        ...(!nativeMobile
          ? [
              c.select(
                "mcp-transport",
                tr("Transport", "传输方式"),
                mcpTransport,
                [
                  { value: "http", label: "HTTP" },
                  { value: "sse", label: "SSE" },
                  { value: "stdio", label: "stdio" },
                ],
                (value) => setMcpTransport(value as typeof mcpTransport),
              ),
            ]
          : []),
        ...(mcpTransport === "stdio" && !nativeMobile
          ? [
              c.input("mcp-command", tr("Command", "命令"), mcpCommand, setMcpCommand),
              c.input(
                "mcp-args",
                tr("Arguments (one per line)", "参数（每行一个）"),
                mcpArgs,
                setMcpArgs,
              ),
            ]
          : [c.input("mcp-url", "URL", mcpUrl, setMcpUrl)]),
        c.action(
          "add-mcp",
          tr("Connect", "连接"),
          () => {
            const transport = nativeMobile ? "http" : mcpTransport;
            const url = transport === "stdio" ? null : new URL(mcpUrl.trim());
            if (url && !["https:", "http:"].includes(url.protocol))
              throw new Error("MCP requires an HTTP(S) URL");
            setSettings((previous) =>
              applyMcpOpsToAppSettings(previous, [
                {
                  kind: "upsert",
                  server: {
                    id: mcpId.trim(),
                    url: url?.toString() ?? "",
                    transport,
                    enabled: true,
                    command: transport === "stdio" ? mcpCommand.trim() : "",
                    args:
                      transport === "stdio"
                        ? mcpArgs
                            .split(/\r?\n/)
                            .map((value) => value.trim())
                            .filter(Boolean)
                        : [],
                    timeoutMs: 60000,
                  },
                },
              ]),
            );
            setMcpId("");
            setMcpUrl("");
            setMcpCommand("");
            setMcpArgs("");
          },
          !!mcpId.trim() &&
            (mcpTransport === "stdio" && !nativeMobile ? !!mcpCommand.trim() : !!mcpUrl.trim()) &&
            !settings.mcp.servers.some((server) => server.id === mcpId.trim()),
        ),
      ]),
    );
  } else if (page === "voice") {
    if (nativeMobile) {
      nodes.push(
        c.group("voice-general", t("settings.stt.title"), [
          c.toggle("voice-enabled", t("settings.stt.title"), settings.stt.enabled, (enabled) =>
            setSettings((previous) =>
              normalizeSettings({ ...previous, stt: { ...previous.stt, enabled } }),
            ),
          ),
          {
            id: "voice-device-status",
            kind: "StatusDot",
            label: !status
              ? tr("Checking system speech recognition", "正在检查系统语音识别")
              : status.voiceInputAvailable
                ? tr("System speech recognition is available", "系统语音识别可用")
                : tr("System speech recognition is unavailable", "系统语音识别不可用"),
            status: status?.voiceInputAvailable ? "completed" : status ? "error" : "running",
          },
          {
            ...row(
              "voice-permissions",
              t("settings.mobileAssistant.microphone"),
              "hand.raised",
              () => setPage("mobileAssistant"),
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
      if (status?.detail)
        nodes.push({
          id: "voice-device-detail",
          kind: "Text",
          secondary: true,
          text: status.detail,
        });
    } else {
      const providerId = settings.stt.provider;
      const sttProvider = settings.stt.providers[providerId];
      const providerLabels: Record<SttProviderId, string> = {
        aliyun_dashscope: "阿里云 DashScope",
        tencent_cloud: "腾讯云 ASR",
        volcengine_v2: "火山引擎 ASR v2",
        volcengine_seed_v3: "火山引擎 Seed ASR v3",
        baidu_cloud: "百度智能云 ASR",
      };
      const providerFields: Record<
        SttProviderId,
        Array<{ key: keyof SttProviderSettings; label: string; secure?: boolean }>
      > = {
        aliyun_dashscope: [
          { key: "websocketUrl", label: "WebSocket URL" },
          { key: "model", label: "Model" },
          { key: "apiKey", label: "API Key", secure: true },
        ],
        tencent_cloud: [
          { key: "appId", label: "AppId" },
          { key: "engineModelType", label: "Engine Model Type" },
          { key: "secretId", label: "SecretId", secure: true },
          { key: "secretKey", label: "SecretKey", secure: true },
        ],
        volcengine_v2: [
          { key: "websocketUrl", label: "WebSocket URL" },
          { key: "appId", label: "App ID" },
          { key: "cluster", label: "Cluster" },
          { key: "accessToken", label: "Access Token", secure: true },
        ],
        volcengine_seed_v3: [
          { key: "websocketUrl", label: "WebSocket URL" },
          { key: "appId", label: "App ID" },
          { key: "resourceId", label: "Resource ID" },
          { key: "accessToken", label: "Access Token", secure: true },
        ],
        baidu_cloud: [
          { key: "websocketUrl", label: "WebSocket URL" },
          { key: "baiduAppId", label: "App ID" },
          { key: "devPid", label: "dev_pid" },
          { key: "baiduApiKey", label: "API Key", secure: true },
        ],
      };
      nodes.push(
        c.group("voice-general", t("settings.stt.title"), [
          c.toggle("voice-enabled", t("settings.stt.title"), settings.stt.enabled, (enabled) =>
            setSettings((previous) =>
              normalizeSettings({ ...previous, stt: { ...previous.stt, enabled } }),
            ),
          ),
          c.select(
            "voice-provider",
            t("settings.stt.provider"),
            providerId,
            STT_PROVIDER_IDS.map((id) => ({ value: id, label: providerLabels[id] })),
            (value) => {
              setVoiceTest(null);
              setSettings((previous) =>
                normalizeSettings({
                  ...previous,
                  stt: { ...previous.stt, provider: value as SttProviderId },
                }),
              );
            },
          ),
        ]),
        c.group(
          "voice-provider-fields",
          providerLabels[providerId],
          providerFields[providerId].map((field) =>
            c.input(
              `voice:${field.key}`,
              field.label,
              typeof sttProvider[field.key] === "string" ? String(sttProvider[field.key]) : "",
              (value) => patchSttProvider({ [field.key]: value }),
              field.secure,
            ),
          ),
        ),
        c.action(
          "voice-test",
          t("settings.stt.test"),
          () =>
            work(async () => {
              setVoiceTest(null);
              await desktopSttSettingsService.update(settings.stt);
              const result = await desktopSttSettingsService.test(providerId);
              const ok = result.result === "connected" || result.result === "connected_no_speech";
              setVoiceTest({
                ok,
                message: result.message || t(`settings.stt.test.${result.result}`),
              });
            }),
          !busy,
        ),
      );
      if (voiceTest)
        nodes.push({
          id: "voice-test-result",
          kind: "Banner",
          label: voiceTest.message,
          status: voiceTest.ok ? "completed" : "error",
        });
    }
  } else if (page === "other") {
    nodes.push(
      c.group("other-tools", titles.other, [
        navigate("hooks", "bolt"),
        navigate("cron", "calendar.badge.clock"),
        navigate("ssh", "server.rack"),
      ]),
    );
  } else if (page === "access") {
    const normalizeLanUrl = (input: string) => {
      const source = /^[a-z][a-z\d+.-]*:\/\//i.test(input.trim())
        ? input.trim()
        : `http://${input.trim()}`;
      const url = new URL(source);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("The computer address must use HTTP or HTTPS.");
      }
      if (url.protocol === "http:" && !url.port) url.port = "28367";
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString();
    };
    if (nativeMobile) {
      nodes.push(
        c.group("lan-computer", t("settings.accessLanControl"), [
          c.input(
            "lan-url",
            t("settings.accessComputerAddress"),
            settings.access.lanControlUrl,
            (lanControlUrl) => patchAccess({ lanControlUrl }),
          ),
          c.input("lan-pairing-code", t("settings.accessLanPairingCode"), lanPairingCode, (value) =>
            setLanPairingCode(value.replace(/\D/g, "").slice(0, 6)),
          ),
          c.input(
            "lan-device-name",
            t("settings.accessLanDeviceName"),
            lanDeviceName,
            setLanDeviceName,
          ),
          c.action(
            "lan-pair",
            t("settings.accessPairComputer"),
            () =>
              work(async () => {
                const baseUrl = normalizeLanUrl(settings.access.lanControlUrl);
                patchAccess({ lanControlUrl: baseUrl });
                const next = await invoke<LanPcClientStatus>("lan_pc_pair", {
                  baseUrl,
                  code: lanPairingCode,
                  deviceName: lanDeviceName.trim(),
                });
                setLanPc(next);
                setLanPairingCode("");
                setAccessStatus(t("settings.accessComputerPaired"));
              }),
            !busy &&
              !!settings.access.lanControlUrl.trim() &&
              lanPairingCode.length === 6 &&
              !!lanDeviceName.trim(),
          ),
          ...(lanPc.paired
            ? [
                c.action("lan-disconnect", t("settings.accessDisconnectComputer"), () =>
                  work(async () => {
                    setLanPc(await invoke<LanPcClientStatus>("lan_pc_disconnect"));
                    patchAccess({ preferLanPcExecution: false });
                    setAccessStatus(t("settings.accessComputerNotPaired"));
                  }),
                ),
              ]
            : []),
          c.toggle(
            "lan-prefer",
            t("settings.accessPreferLanPc"),
            settings.access.preferLanPcExecution,
            (preferLanPcExecution) => patchAccess({ preferLanPcExecution }),
            lanPc.paired,
          ),
          c.toggle("ios-ashell", "a-Shell", settings.access.iosAShellEnabled, (iosAShellEnabled) =>
            patchAccess({ iosAShellEnabled }),
          ),
        ]),
      );
    } else {
      nodes.push(
        c.group("local-web-ui", t("settings.accessWebUi"), [
          c.toggle(
            "web-ui-enabled",
            t("settings.accessWebUi"),
            settings.access.webUiEnabled,
            (webUiEnabled) => patchAccess({ webUiEnabled }),
          ),
          c.select(
            "web-ui-scope",
            t("settings.accessScope"),
            settings.access.webUiScope,
            [
              { value: "lan", label: t("settings.accessScopeLan") },
              { value: "loopback", label: t("settings.accessScopeLoopback") },
            ],
            (webUiScope) => patchAccess({ webUiScope: webUiScope as "lan" | "loopback" }),
          ),
          c.input(
            "web-ui-port",
            t("settings.accessPort"),
            String(settings.access.webUiPort),
            (value) => {
              const port = Number(value);
              if (Number.isInteger(port) && port >= 1 && port <= 65535)
                patchAccess({ webUiPort: port });
            },
          ),
        ]),
      );
    }
    const capabilityRows: Array<
      [AppSettings["access"]["blockedLocalCapabilities"][number], string]
    > = [
      ["terminal", "settings.accessBlockTerminal"],
      ["browser_automation", "settings.accessBlockBrowserAutomation"],
      ["ssh", "settings.accessBlockSsh"],
      ["git", "settings.accessBlockGit"],
      ["file_write", "settings.accessBlockFileWrite"],
    ];
    nodes.push(
      c.group(
        "local-capabilities",
        t("settings.accessPairing"),
        capabilityRows.map(([capability, labelKey]) =>
          c.toggle(
            `block:${capability}`,
            t(labelKey),
            settings.access.blockedLocalCapabilities.includes(capability),
            (blocked) => setCapabilityBlocked(capability, blocked),
          ),
        ),
      ),
      c.group("cloud-execution", t("settings.accessCloudExecution"), [
        c.toggle(
          "cloud-enabled",
          t("settings.accessCloudExecution"),
          settings.access.cloudExecutionEnabled,
          (cloudExecutionEnabled) => patchAccess({ cloudExecutionEnabled }),
        ),
        c.input(
          "github-owner",
          t("settings.accessGithubOwner"),
          settings.access.githubOwner,
          (githubOwner) => patchAccess({ githubOwner }),
        ),
        c.input(
          "github-repository",
          t("settings.accessGithubRepository"),
          settings.access.githubRepository,
          (githubRepository) => patchAccess({ githubRepository }),
        ),
        c.input("github-token", t("settings.accessGithubToken"), githubToken, setGithubToken, true),
        c.action(
          "github-token-save",
          t("settings.accessSaveToken"),
          () =>
            work(async () => {
              const next = await invoke<CloudSecretVaultStatus>(
                "cloud_secret_vault_set_github_token",
                { username: settings.access.githubOwner, token: githubToken },
              );
              setVault(next);
              setGithubToken("");
              setAccessStatus(t("settings.accessTokenConfigured"));
            }),
          !busy && !!settings.access.githubOwner.trim() && !!githubToken.trim(),
        ),
        ...(vault.githubTokenConfigured
          ? [
              c.action("github-token-remove", t("settings.accessRemoveToken"), () =>
                work(async () => {
                  setVault(
                    await invoke<CloudSecretVaultStatus>("cloud_secret_vault_remove_github_token"),
                  );
                  setAccessStatus(t("settings.accessTokenMissing"));
                }),
              ),
            ]
          : []),
      ]),
    );
    if (accessStatus)
      nodes.push({ id: "access-status", kind: "Banner", label: accessStatus, status: "completed" });
  } else if (page === "backup") {
    const restore = async (run: () => Promise<{ skills: unknown }>) => {
      const outcome = await run();
      await props.reloadSettings?.();
      if (outcome.skills) {
        const skills = normalizeSkillsSettings(outcome.skills);
        setSettings((previous) => ({ ...previous, skills }));
      }
    };
    const patchBackupConfig = (patch: Partial<BackupSyncConfigView>) =>
      setBackupConfig((current) => (current ? { ...current, ...patch } : current));
    if (backupConfig) {
      nodes.push(
        c.group("backup-connection", t("settings.backupSyncTitle"), [
          c.input("backup-url", "WebDAV URL", backupConfig.url, (url) =>
            patchBackupConfig({ url }),
          ),
          c.input(
            "backup-username",
            t("settings.backupSyncUsername"),
            backupConfig.username,
            (username) => patchBackupConfig({ username }),
          ),
          c.input(
            "backup-password",
            t("settings.backupSyncPassword"),
            backupPassword,
            setBackupPassword,
            true,
          ),
          c.input(
            "backup-directory",
            t("settings.backupSyncRemoteDir"),
            backupConfig.remoteDir,
            (remoteDir) => patchBackupConfig({ remoteDir }),
          ),
          c.input(
            "backup-profile",
            t("settings.backupSyncProfile"),
            backupConfig.profile,
            (profile) => patchBackupConfig({ profile }),
          ),
          c.toggle(
            "backup-auto",
            t("settings.backupSyncAuto"),
            backupConfig.autoSync,
            (autoSync) => {
              if (!autoSync) {
                patchBackupConfig({ autoSync: false });
                return;
              }
              patchBackupConfig({ autoSync: true });
              setBackupConfirmation({ kind: "auto-sync" });
            },
          ),
          c.action(
            "backup-save-connection",
            t("settings.save"),
            () =>
              work(async () => {
                const next = await saveSyncConfig({
                  url: backupConfig.url,
                  username: backupConfig.username,
                  password: backupPassword,
                  passwordTouched: Boolean(backupPassword),
                  remoteDir: backupConfig.remoteDir,
                  profile: backupConfig.profile,
                  autoSync: backupConfig.autoSync,
                });
                setBackupConfig(next);
                setBackupPassword("");
                if (!canTestSyncConnection(next)) {
                  setBackupStatus({ ok: true, message: t("settings.backupSyncSaveDone") });
                  return;
                }
                try {
                  await testSyncConnection();
                  setBackupStatus({
                    ok: true,
                    message: t("settings.backupSyncSaveAndTestDone"),
                  });
                } catch (cause) {
                  const message = cause instanceof Error ? cause.message : String(cause);
                  setBackupStatus({
                    ok: false,
                    message: `${t("settings.backupSyncSaveAndTestFailed")}${message}`,
                  });
                }
              }),
            !busy && !!backupConfig.url.trim(),
          ),
          c.action(
            "backup-test-connection",
            t("settings.backupSyncTest"),
            () =>
              work(async () => {
                await testSyncConnection();
                setBackupStatus({ ok: true, message: t("settings.backupSyncTestDone") });
              }),
            !busy && !!backupConfig.url.trim(),
          ),
        ]),
      );
    }
    nodes.push(
      c.group("backup-local", t("settings.backupLocalTitle"), [
        c.action("backup-export", t("settings.backupExport"), () =>
          work(async () => {
            const path = await exportBackup(settings.skills);
            if (path)
              setBackupStatus({ ok: true, message: `${t("settings.backupExportDone")}${path}` });
          }),
        ),
        c.action("backup-import", t("settings.backupImport"), () =>
          work(async () => {
            const preview = await peekBackupImport();
            if (preview) setBackupConfirmation({ kind: "import", path: preview.path });
          }),
        ),
      ]),
      c.group("backup-cloud", t("settings.backupSyncTitle"), [
        c.action("backup-upload", t("settings.backupSyncUpload"), async () => {
          const remote = await fetchRemoteInfo();
          if (remote) setBackupConfirmation({ kind: "upload" });
          else {
            await uploadBackup(settings.skills);
            setBackupStatus({ ok: true, message: t("settings.backupSyncUploadDone") });
          }
        }),
        c.action("backup-download", t("settings.backupSyncDownload"), async () => {
          const remote = await fetchRemoteInfo();
          if (!remote) {
            setBackupStatus({ ok: false, message: t("settings.backupSyncRemoteEmpty") });
            return;
          }
          setBackupConfirmation({ kind: "download" });
        }),
      ]),
    );
    if (backupConfirmation) {
      const confirmLabel =
        backupConfirmation.kind === "import"
          ? t("settings.backupImportConfirmAction")
          : backupConfirmation.kind === "upload"
            ? t("settings.backupSyncUpload")
            : backupConfirmation.kind === "download"
              ? t("settings.backupSyncDownload")
              : t("settings.backupSyncAutoConfirmAction");
      nodes.push({
        id: "backup-confirmation",
        kind: "Banner",
        label:
          backupConfirmation.kind === "import"
            ? t("settings.backupImportConfirmTitle")
            : backupConfirmation.kind === "upload"
              ? t("settings.backupSyncUploadConfirmTitle")
              : backupConfirmation.kind === "download"
                ? t("settings.backupSyncDownloadConfirmTitle")
                : t("settings.backupSyncAutoConfirmTitle"),
        text:
          backupConfirmation.kind === "auto-sync"
            ? `${t("settings.backupSyncAutoConfirmSubtitle")}\n${t("settings.backupSyncAutoConfirmDesc")}`
            : undefined,
        status: "paused",
        children: [
          c.action("backup-confirm", confirmLabel, () =>
            work(async () => {
              const pending = backupConfirmation;
              setBackupConfirmation(null);
              if (pending.kind === "import") {
                await restore(() => applyBackupImport(pending.path));
                setBackupStatus({ ok: true, message: t("settings.backupImportDone") });
              } else if (pending.kind === "upload") {
                await uploadBackup(settings.skills);
                setBackupStatus({ ok: true, message: t("settings.backupSyncUploadDone") });
              } else if (pending.kind === "download") {
                await restore(downloadBackup);
                setBackupStatus({ ok: true, message: t("settings.backupSyncDownloadDone") });
              } else {
                patchBackupConfig({ autoSync: true });
              }
            }),
          ),
          c.action("backup-cancel", t("settings.backupCancel"), () => {
            if (backupConfirmation.kind === "auto-sync") {
              patchBackupConfig({ autoSync: false });
            }
            setBackupConfirmation(null);
          }),
        ],
      });
    }
    if (backupStatus)
      nodes.push({
        id: "backup-status",
        kind: "Banner",
        label: backupStatus.message,
        status: backupStatus.ok ? "completed" : "error",
      });
  } else if (page === "about") {
    nodes.push({
      id: "about",
      kind: "EmptyState",
      icon: "sparkles",
      label: "Xgent",
      text: props.appUpdate.result?.currentVersion ?? "",
    });
    if (props.appUpdate.message)
      nodes.push({
        id: "update-message",
        kind: "Banner",
        label: props.appUpdate.message,
        status: props.appUpdate.status === "error" ? "error" : "completed",
      });
    nodes.push(
      c.action(
        "check-updates",
        tr("Check for updates", "检查更新"),
        () => props.appUpdate.runCheck(),
        !nativeMobile,
      ),
    );
  } else {
    // Deep links to sections outside this surface return to the functional navigation.
    nodes.push(c.action("home", t("settings.title"), () => setPage("")));
  }
  c.handlers.set("close", {
    enabled: !busy,
    accepts: (value) => value === null,
    run: props.onBack,
  });
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
    { id: "mcp", icon: "puzzlepiece.extension" },
    { id: "skills", icon: "sparkles" },
    { id: "other", icon: "ellipsis.circle" },
    { id: "access", icon: "icloud" },
    { id: "about", icon: "info.circle" },
  ];
  const normalizedQuery = settingsQuery.trim().toLocaleLowerCase();
  const desktopNavigation = desktopSections
    .filter(({ id }) => visible(id))
    .filter(
      ({ id }) => !normalizedQuery || titles[id].toLocaleLowerCase().includes(normalizedQuery),
    )
    .map(
      ({ id, icon }): PresentationNode => ({
        ...row(`desktop-nav:${id}`, titles[id], icon, () => {
          setProviderId("");
          setProviderDeletePending(false);
          setPage(id);
          setError("");
        }),
        selected: page === id,
      }),
    );
  const renderedNodes: PresentationNode[] = nativeMobile
    ? nodes
    : [
        {
          id: "settings-layout",
          kind: "SettingsLayout",
          fill: true,
          children: [
            {
              id: "settings-sidebar",
              kind: "VStack",
              fill: true,
              spacing: 12,
              padding: 16,
              children: [
                { id: "settings-title", kind: "Heading", text: t("settings.title") },
                c.input(
                  "settings-search",
                  t("settings.searchPlaceholder"),
                  settingsQuery,
                  setSettingsQuery,
                ),
                { id: "settings-navigation", kind: "List", children: desktopNavigation },
                { id: "settings-sidebar-space", kind: "Spacer" },
                c.action("settings-close", t("settings.backToChat"), props.onBack, !busy),
              ],
            },
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
      document={{
        mode: "sheet",
        title: provider?.name || titles[page] || t("settings.title"),
        appearance: settings.theme,
        formFactor: nativeMobile ? "mobile" : "desktop",
        theme: createNativePresentationTheme(settings, nativeMobile),
        nodes: renderedNodes,
        dismissAction: busy ? undefined : "close",
      }}
      handlers={c.handlers}
      onError={setFailure}
    />
  );
}
