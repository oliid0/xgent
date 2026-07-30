import { invoke } from "@xagent/runtime";

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

export function browserAutomationStatus() {
  return invoke<BrowserStatus>(`${PLUGIN_COMMAND}status`);
}

export function openBrowserSession(request: {
  sessionId: string;
  url: string;
  viewport: BrowserViewport;
  userAgent?: string | null;
}) {
  return invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}open_session`, { request });
}

export function listBrowserSessions() {
  return invoke<BrowserSessionSummary[]>(`${PLUGIN_COMMAND}list_sessions`);
}

export function closeBrowserSession(sessionId: string) {
  return invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}close_session`, {
    request: { sessionId },
  });
}

export function setBrowserViewport(sessionId: string, viewport: BrowserViewport) {
  return invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}set_viewport`, {
    request: { sessionId, viewport },
  });
}

export function runBrowserAction(
  sessionId: string,
  action: BrowserAction,
  input: BrowserActionInput = {},
  timeoutMs = 30_000,
) {
  return invoke<BrowserActionResponse>(`${PLUGIN_COMMAND}action`, {
    request: { sessionId, action, input, timeoutMs },
  });
}
