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
  installMobileEnvironment,
  type MobileExecutionStatus,
  mobileExecutionStatus,
} from "../lib/mobileExecution";
import {
  applyMcpOpsToAppSettings,
  type CustomProvider,
  normalizeCustomProvider,
  updateCustomProviders,
  updateCustomSettings,
  updateMemorySettings,
  updateSkills,
  updateSystem,
} from "../lib/settings";
import { createUuid } from "../lib/shared/id";
import { BUILTIN_TOOL_CATALOG, BUILTIN_TOOL_CATEGORIES } from "../lib/tools/builtinToolCatalog";
import { resolveRuntimeToolCapabilities } from "../lib/tools/runtimeToolCapabilities";
import {
  createDraftModelConfig,
  fetchModelsFromApi,
  mergeFetchedModels,
} from "../pages/settings/providerUtils";
import type { SettingsPageProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import type { PresentationNode } from "./types";

/** Native navigation uses the same reducers, discovery and persistence as desktop settings. */
export function NativeSettingsPage(props: SettingsPageProps) {
  const { settings, setSettings, nativeMobile = false } = props;
  const { t, locale } = useLocale();
  const [page, setPage] = useState(
    props.initialSection === "system" ? "" : (props.initialSection ?? ""),
  );
  const [failure, setFailure] = useState<unknown>(null);
  const [status, setStatus] = useState<MobileAssistantStatus>();
  const [permissions, setPermissions] = useState<MobilePermissionStates>({});
  const [shell, setShell] = useState<MobileExecutionStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [mcpId, setMcpId] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const c = presentationControls();
  const tr = (en: string, zh: string) => (locale === "zh-CN" ? zh : en);
  const provider = settings.customProviders.find((item) => item.id === providerId);

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
    if (page === "mobileAssistant" && nativeMobile) void work(refreshPermissions);
    if (page === "mobileExecution" && nativeMobile)
      void work(async () => setShell(await mobileExecutionStatus()));
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
    toolPermissions: t("settings.toolPermissionsTitle"),
    mobileAssistant: t("settings.mobileAssistant.permissions"),
    mobileExecution: t("settings.mobile.executionDescription"),
    about: tr("About", "关于"),
  };
  const nodes: PresentationNode[] = [];
  if (page)
    nodes.push({
      ...c.action("back", tr("Back", "返回"), () => {
        if (providerId) setProviderId("");
        else setPage("");
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

  if (!page) {
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
        navigate("system", "gearshape"),
        navigate("providers", "cpu"),
        ...(nativeMobile
          ? [navigate("mobileAssistant", "hand.raised"), navigate("mobileExecution", "terminal")]
          : []),
        navigate("toolPermissions", "lock.shield"),
        navigate("mcp", "puzzlepiece.extension"),
        navigate("memory", "brain"),
        navigate("skills", "sparkles"),
        navigate("about", "info.circle"),
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
                  if (state === "denied") {
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
  } else if (page === "skills") {
    nodes.push(
      c.toggle(
        "skills-enabled",
        tr("Enable skills", "启用技能"),
        settings.skills.enabled,
        (enabled) => setSettings((previous) => updateSkills(previous, { enabled })),
      ),
    );
    nodes.push(
      c.group(
        "skills",
        titles.skills,
        settings.skills.selected.map(
          (name): PresentationNode => ({ id: "skill:" + name, kind: "Text", text: name }),
        ),
      ),
    );
  } else if (page === "mcp") {
    nodes.push(
      c.group(
        "mcp-servers",
        "MCP",
        settings.mcp.servers.map((server) =>
          c.toggle(
            "mcp:" + server.id,
            server.id,
            server.enabled,
            (enabled) =>
              setSettings((previous) =>
                applyMcpOpsToAppSettings(previous, [
                  { kind: "setEnabled", serverIds: [server.id], enabled },
                ]),
              ),
            !nativeMobile || server.transport !== "stdio",
          ),
        ),
      ),
    );
    nodes.push(
      c.group("new-mcp", tr("Connect MCP server", "连接 MCP 服务"), [
        c.input("mcp-id", tr("Name", "名称"), mcpId, setMcpId),
        c.input("mcp-url", "URL", mcpUrl, setMcpUrl),
        c.action(
          "add-mcp",
          tr("Connect", "连接"),
          () => {
            const url = new URL(mcpUrl.trim());
            if (!["https:", "http:"].includes(url.protocol))
              throw new Error("MCP requires an HTTP(S) URL");
            setSettings((previous) =>
              applyMcpOpsToAppSettings(previous, [
                {
                  kind: "upsert",
                  server: {
                    id: mcpId.trim(),
                    url: url.toString(),
                    transport: "http",
                    enabled: true,
                    command: "",
                    args: [],
                    timeoutMs: 60000,
                  },
                },
              ]),
            );
            setMcpId("");
            setMcpUrl("");
          },
          !!mcpId.trim() &&
            !!mcpUrl.trim() &&
            !settings.mcp.servers.some((server) => server.id === mcpId.trim()),
        ),
      ]),
    );
  } else if (page === "about") {
    nodes.push({ id: "about", kind: "Text", text: "Xgent" });
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
  return (
    <NativeSurface
      document={{
        mode: "sheet",
        title: provider?.name || titles[page] || t("settings.title"),
        appearance: settings.theme,
        nodes,
        dismissAction: busy ? undefined : "close",
      }}
      handlers={c.handlers}
      onError={setFailure}
    />
  );
}
