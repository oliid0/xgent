import type {
  RuntimeEvent,
  RuntimeFileDropEvent,
  RuntimeInvokeArgs,
  RuntimeUnlisten,
  XAgentRuntime,
} from "./types";

const SETTINGS_KEY = "xagent.browser-runtime-settings.v1";
const GATEWAY_TOKEN_KEY = "xagent.gateway.token";

type BrowserRuntimeSettings = {
  providers?: unknown;
  system?: unknown;
  mcp?: unknown;
  agents?: unknown;
  ssh?: unknown;
  remote?: unknown;
  memory?: unknown;
};

type GatewayStatus = {
  online: boolean;
  enabled: boolean;
  configured: boolean;
  gatewayUrl?: string;
  lastError?: string | null;
  [key: string]: unknown;
};

function readSettings(): BrowserRuntimeSettings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as BrowserRuntimeSettings)
      : {};
  } catch {
    return {};
  }
}

function writeSettings(settings: BrowserRuntimeSettings) {
  globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function saveSettingsField(field: keyof BrowserRuntimeSettings, value: unknown) {
  writeSettings({ ...readSettings(), [field]: value });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function gatewayConnection() {
  const remote = asRecord(readSettings().remote);
  const configuredUrl = typeof remote.gatewayUrl === "string" ? remote.gatewayUrl.trim() : "";
  const gatewayUrl = (configuredUrl || globalThis.location?.origin || "").replace(/\/$/, "");
  const configuredToken = typeof remote.token === "string" ? remote.token.trim() : "";
  const token =
    configuredToken || globalThis.localStorage?.getItem(GATEWAY_TOKEN_KEY)?.trim() || "";
  return { gatewayUrl, token };
}

async function readGatewayStatus(): Promise<GatewayStatus> {
  const { gatewayUrl, token } = gatewayConnection();
  if (!gatewayUrl || !token) {
    return {
      online: false,
      enabled: false,
      configured: false,
      gatewayUrl,
      lastError: "Gateway URL or token is not configured",
    };
  }

  try {
    const response = await fetch(`${gatewayUrl}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Gateway status request failed with HTTP ${response.status}`);
    }
    const payload = asRecord(await response.json());
    return {
      ...payload,
      online: payload.online === true,
      enabled: true,
      configured: true,
      gatewayUrl,
      lastError: null,
    };
  } catch (error) {
    return {
      online: false,
      enabled: true,
      configured: true,
      gatewayUrl,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

function unsupported(command: string): never {
  throw new Error(`Runtime command is unavailable in a browser: ${command}`);
}

async function invokeBrowser<T>(command: string, args?: RuntimeInvokeArgs): Promise<T> {
  const payload = args?.payload;
  switch (command) {
    case "settings_load_all":
      return { ...readSettings(), defaultWorkdir: "" } as T;
    case "settings_save_providers":
      saveSettingsField("providers", payload);
      return undefined as T;
    case "settings_save_system":
      saveSettingsField("system", payload);
      return undefined as T;
    case "settings_save_mcp":
      saveSettingsField("mcp", payload);
      return undefined as T;
    case "settings_save_agents":
      saveSettingsField("agents", payload);
      return undefined as T;
    case "settings_save_remote":
      saveSettingsField("remote", payload);
      return undefined as T;
    case "settings_save_memory":
      saveSettingsField("memory", payload);
      return undefined as T;
    case "settings_apply_ssh_patch": {
      const browserPayload = args?.browserPayload;
      if (browserPayload !== undefined) saveSettingsField("ssh", browserPayload);
      return { ssh: browserPayload ?? readSettings().ssh } as T;
    }
    case "app_runtime_platform":
      return {
        platform: /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? "macos"
          : /Windows/i.test(navigator.userAgent)
            ? "windows"
            : "linux",
      } as T;
    case "gateway_status":
      return (await readGatewayStatus()) as T;
    case "proxy_get_server_info": {
      const { gatewayUrl, token } = gatewayConnection();
      return { baseUrl: gatewayUrl, token } as T;
    }
    case "app_set_close_window_behavior":
    case "gateway_publish_settings_sync":
    case "system_ensure_builtin_skills":
      return undefined as T;
    default:
      return unsupported(command);
  }
}

async function listenBrowser<T>(
  event: string,
  handler: (event: RuntimeEvent<T>) => void,
): Promise<RuntimeUnlisten> {
  if (event !== "gateway:status") return () => {};

  let disposed = false;
  const publish = async () => {
    const payload = await readGatewayStatus();
    if (!disposed) handler({ payload: payload as T });
  };
  void publish();
  const interval = globalThis.setInterval(() => void publish(), 5_000);
  return () => {
    disposed = true;
    globalThis.clearInterval(interval);
  };
}

export const browserRuntime: XAgentRuntime = {
  invoke: invokeBrowser,
  listen: listenBrowser,

  async openUrl(url: string) {
    const opened = globalThis.open(url, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  },

  async revealItemInDir() {
    unsupported("reveal_item_in_dir");
  },

  async homeDir() {
    return "";
  },

  async listenFileDrop(_handler: (event: RuntimeFileDropEvent) => void) {
    // Browser file drops expose File objects rather than native paths. The
    // shared composer handles those through its file input/drop surface.
    return () => {};
  },
};
