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
  | "press_key"
  | "get_text"
  | "readable"
  | "scroll"
  | "hover"
  | "find_elements"
  | "page_info"
  | "backbone"
  | "snapshot"
  | "execute_js"
  | "recover";

export type BrowserActionInput = {
  url?: string;
  selector?: string;
  ref?: string;
  text?: string;
  key?: string;
  submit?: boolean;
  script?: string;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  x?: number;
  y?: number;
  limit?: number;
  maxDepth?: number;
  maxNodes?: number;
  smooth?: boolean;
};

export type BrowserActionResponse = {
  requestId: string;
  sessionId: string;
  action: BrowserAction;
  url: string;
  title?: string | null;
  data: unknown;
  screenshotBase64?: string | null;
  lifecycle: {
    commandCompleted: boolean;
    navigationStarted: boolean;
    navigationFinished: boolean;
    recovered: boolean;
  };
};

const PLUGIN_COMMAND = "plugin:browser-automation|";
const DEFAULT_BROWSER_INVOKE_TIMEOUT_MS = 30_000;
const BROWSER_INVOKE_GRACE_MS = 2_000;
let browserRequestSequence = 0;

export function createBrowserRequestId() {
  browserRequestSequence = (browserRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `browser-${Date.now().toString(36)}-${browserRequestSequence.toString(36)}`;
}

function assertBrowserResponse(
  response: BrowserActionResponse,
  requestId: string,
): BrowserActionResponse {
  if (response.requestId !== requestId) {
    throw new Error(
      `Embedded browser response mismatch: expected ${requestId}, received ${response.requestId || "no request id"}.`,
    );
  }
  if (response.lifecycle?.commandCompleted !== true) {
    throw new Error(`Embedded browser request ${requestId} returned without command completion.`);
  }
  return response;
}

function withBrowserInvokeTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = DEFAULT_BROWSER_INVOKE_TIMEOUT_MS,
) {
  const normalizedTimeout = Math.max(500, Math.min(90_000, timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} did not return within ${normalizedTimeout} ms.`));
    }, normalizedTimeout);
    operation.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

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
  status: () =>
    withBrowserInvokeTimeout(
      invoke<BrowserStatus>(`${PLUGIN_COMMAND}status`),
      "Embedded browser status",
      10_000,
    ),
  openSession: (request) =>
    withBrowserInvokeTimeout(
      invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}open_session`, { request }),
      "Embedded browser session creation",
    ),
  listSessions: () =>
    withBrowserInvokeTimeout(
      invoke<BrowserSessionSummary[]>(`${PLUGIN_COMMAND}list_sessions`),
      "Embedded browser tab listing",
      10_000,
    ),
  closeSession: (sessionId) =>
    withBrowserInvokeTimeout(
      invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}close_session`, {
        request: { sessionId },
      }),
      "Embedded browser tab close",
      10_000,
    ),
  setViewport: (sessionId, viewport) =>
    withBrowserInvokeTimeout(
      invoke<BrowserSessionSummary>(`${PLUGIN_COMMAND}set_viewport`, {
        request: { sessionId, viewport },
      }),
      "Embedded browser viewport update",
      10_000,
    ),
  action: (sessionId, action, input = {}, timeoutMs = 30_000) => {
    const requestId = createBrowserRequestId();
    return withBrowserInvokeTimeout(
      invoke<BrowserActionResponse>(`${PLUGIN_COMMAND}action`, {
        request: {
          requestId,
          sessionId,
          action,
          input,
          timeoutMs,
        },
      }),
      `Embedded browser ${action}`,
      timeoutMs + BROWSER_INVOKE_GRACE_MS,
    ).then((response) => assertBrowserResponse(response, requestId));
  },
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
  const remote = <T>(
    suffix: string,
    args: unknown = {},
    timeoutMs = DEFAULT_BROWSER_INVOKE_TIMEOUT_MS,
  ) =>
    withBrowserInvokeTimeout(
      invokeOnLanComputer<T>(baseUrl, `${PLUGIN_COMMAND}${suffix}`, args),
      `Paired computer browser ${suffix}`,
      timeoutMs,
    );
  return {
    status: () => remote<BrowserStatus>("status", {}, 10_000),
    openSession: (request) => remote<BrowserSessionSummary>("open_session", { request }),
    listSessions: () => remote<BrowserSessionSummary[]>("list_sessions", {}, 10_000),
    closeSession: (sessionId) =>
      remote<BrowserSessionSummary>("close_session", { request: { sessionId } }, 10_000),
    setViewport: (sessionId, viewport) =>
      remote<BrowserSessionSummary>("set_viewport", { request: { sessionId, viewport } }, 10_000),
    action: (sessionId, action, input = {}, timeoutMs = 30_000) => {
      const requestId = createBrowserRequestId();
      return remote<BrowserActionResponse>(
        "action",
        {
          request: {
            requestId,
            sessionId,
            action,
            input,
            timeoutMs,
          },
        },
        timeoutMs + BROWSER_INVOKE_GRACE_MS,
      ).then((response) => assertBrowserResponse(response, requestId));
    },
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
