import { invoke } from "@xgent/runtime";

export type BrowserBackend = "desktop-webview" | "android-webview" | "ios-wk-webview";

export type BrowserCapabilities = {
  visibleSessions: boolean;
  domAutomation: boolean;
  javascript: boolean;
  screenshots: boolean;
  downloads: boolean;
  multipleSessions: boolean;
};

export type BrowserStatus = {
  backend: BrowserBackend;
  available: boolean;
  detail?: string | null;
  capabilities: BrowserCapabilities;
};

export type BrowserViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  scaleFactor: number;
};

export type BrowserSessionSummary = {
  sessionId: string;
  url: string;
  title?: string | null;
  visible: boolean;
  loading: boolean;
};

export type BrowserAction =
  | "navigate"
  | "reload"
  | "go_back"
  | "go_forward"
  | "screenshot"
  | "click"
  | "type"
  | "get_text"
  | "readable"
  | "scroll"
  | "hover"
  | "find_elements"
  | "page_info"
  | "backbone"
  | "execute_js";

export type BrowserActionInput = {
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
  direction?: "up" | "down";
  amount?: number;
  x?: number;
  y?: number;
  limit?: number;
  maxDepth?: number;
  maxNodes?: number;
  smooth?: boolean;
};

export type BrowserActionResponse = {
  sessionId: string;
  action: BrowserAction;
  url: string;
  title?: string | null;
  data: unknown;
  screenshotBase64?: string | null;
};

const PLUGIN_COMMAND = "plugin:browser-automation|";

export type BrowserAutomationClient = {
  status: () => Promise<BrowserStatus>;
  openSession: (request: {
    sessionId: string;
    url: string;
    viewport: BrowserViewport;
    userAgent?: string | null;
  }) => Promise<BrowserSessionSummary>;
  listSessions: () => Promise<BrowserSessionSummary[]>;
  closeSession: (sessionId: string) => Promise<BrowserSessionSummary>;
  setViewport: (sessionId: string, viewport: BrowserViewport) => Promise<BrowserSessionSummary>;
  action: (
    sessionId: string,
    action: BrowserAction,
    input?: BrowserActionInput,
    timeoutMs?: number,
  ) => Promise<BrowserActionResponse>;
};

type OpenBrowserSessionRequest = {
  sessionId: string;
  url: string;
  viewport: BrowserViewport;
  userAgent?: string | null;
};

export const localBrowserAutomationClient: BrowserAutomationClient = {
  status: () => invoke<BrowserStatus>(`${PLUGIN_COMMAND}status`),
  openSession: (request) =>
    invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}open_session`, { request }),
  listSessions: () => invoke<BrowserSessionSummary[]>(`${PLUGIN_COMMAND}list_sessions`),
  closeSession: (sessionId) =>
    invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}close_session`, {
      request: { sessionId },
    }),
  setViewport: (sessionId, viewport) =>
    invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}set_viewport`, {
      request: { sessionId, viewport },
    }),
  action: (sessionId, action, input = {}, timeoutMs = 30_000) =>
    invoke<BrowserActionResponse>(`${PLUGIN_COMMAND}action`, {
      request: { sessionId, action, input, timeoutMs },
    }),
};

function invokeOnLanComputer<T>(baseUrl: string, command: string, args: unknown) {
  return invoke<T>("lan_pc_invoke", {
    baseUrl,
    command,
    args,
  });
}

/**
 * Browser automation transport used only by agent tools when the user has
 * explicitly enabled mobile-to-PC delegation. UI browsing remains bound to
 * the local WebView controller.
 */
export function createLanPcBrowserAutomationClient(baseUrl: string): BrowserAutomationClient {
  const remote = <T>(suffix: string, args: unknown = {}) =>
    invokeOnLanComputer<T>(baseUrl, `${PLUGIN_COMMAND}${suffix}`, args);
  return {
    status: () => remote<BrowserStatus>("status"),
    openSession: (request) => remote<BrowserSessionSummary>("open_session", { request }),
    listSessions: () => remote<BrowserSessionSummary[]>("list_sessions"),
    closeSession: (sessionId) =>
      remote<BrowserSessionSummary>("close_session", { request: { sessionId } }),
    setViewport: (sessionId, viewport) =>
      remote<BrowserSessionSummary>("set_viewport", {
        request: { sessionId, viewport },
      }),
    action: (sessionId, action, input = {}, timeoutMs = 30_000) =>
      remote<BrowserActionResponse>("action", {
        request: { sessionId, action, input, timeoutMs },
      }),
  };
}

export function browserAutomationStatus() {
  return localBrowserAutomationClient.status();
}

export function openBrowserSession(request: OpenBrowserSessionRequest) {
  return localBrowserAutomationClient.openSession(request);
}

export function listBrowserSessions() {
  return localBrowserAutomationClient.listSessions();
}

export function closeBrowserSession(sessionId: string) {
  return localBrowserAutomationClient.closeSession(sessionId);
}

export function setBrowserViewport(sessionId: string, viewport: BrowserViewport) {
  return localBrowserAutomationClient.setViewport(sessionId, viewport);
}

export function runBrowserAction(
  sessionId: string,
  action: BrowserAction,
  input: BrowserActionInput = {},
  timeoutMs = 30_000,
) {
  return localBrowserAutomationClient.action(sessionId, action, input, timeoutMs);
}
