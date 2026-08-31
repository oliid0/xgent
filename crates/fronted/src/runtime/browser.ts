import type {
  RuntimeEvent,
  RuntimeFileDropEvent,
  RuntimeInvokeArgs,
  RuntimeUnlisten,
  XgentRuntime,
} from "./types";

export const LOCAL_ACCESS_CSRF_KEY = "xgent.local-access.csrf.v1";
export const LOCAL_ACCESS_SESSION_CHANGED_EVENT = "xgent:local-access-session-changed";

type RpcResponse<T> = {
  ok?: boolean;
  result?: T;
  error?: string;
};

type BrowserEventEnvelope = {
  subscriptionId?: string;
  payload?: unknown;
};

const eventHandlers = new Map<string, (payload: unknown) => void>();
let eventSource: EventSource | undefined;

function ensureEventSource() {
  if (eventSource) return;
  const source = new EventSource("/api/local-access/events", { withCredentials: true });
  source.onmessage = (message) => {
    try {
      const envelope = JSON.parse(message.data) as BrowserEventEnvelope;
      if (envelope.subscriptionId) {
        eventHandlers.get(envelope.subscriptionId)?.(envelope.payload);
      }
    } catch {
      // Keep-alives and malformed frames never affect active subscriptions.
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED && eventSource === source) {
      eventSource = undefined;
    }
  };
  eventSource = source;
}

function csrfToken() {
  return globalThis.sessionStorage?.getItem(LOCAL_ACCESS_CSRF_KEY)?.trim() ?? "";
}

async function responseError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  } catch {
    // Fall back to the HTTP status below.
  }
  return `Local access request failed with HTTP ${response.status}`;
}

async function invokeLocal<T>(command: string, args?: RuntimeInvokeArgs): Promise<T> {
  const csrf = csrfToken();
  if (!csrf) throw new Error("LOCAL_ACCESS_PAIRING_REQUIRED");
  const response = await fetch("/api/local-access/rpc", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-xgent-csrf": csrf,
    },
    body: JSON.stringify({ command, args: args ?? {} }),
  });
  if (!response.ok) {
    if (response.status === 401) {
      globalThis.sessionStorage?.removeItem(LOCAL_ACCESS_CSRF_KEY);
      globalThis.dispatchEvent?.(new Event(LOCAL_ACCESS_SESSION_CHANGED_EVENT));
    }
    throw new Error(await responseError(response));
  }
  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.ok !== true)
    throw new Error(payload.error || `Local access command failed: ${command}`);
  return payload.result as T;
}

async function invokeBrowser<T>(command: string, args?: RuntimeInvokeArgs): Promise<T> {
  if (command === "app_runtime_platform") {
    return {
      platform: /Android/i.test(navigator.userAgent)
        ? "android"
        : /iPhone|iPad|iPod/i.test(navigator.userAgent)
          ? "ios"
          : /Mac/i.test(navigator.userAgent)
            ? "macos"
            : /Windows/i.test(navigator.userAgent)
              ? "windows"
              : "linux",
    } as T;
  }
  return invokeLocal<T>(command, args);
}

async function listenBrowser<T>(
  event: string,
  handler: (event: RuntimeEvent<T>) => void,
): Promise<RuntimeUnlisten> {
  const csrf = csrfToken();
  if (!csrf) throw new Error("LOCAL_ACCESS_PAIRING_REQUIRED");
  ensureEventSource();
  const response = await fetch("/api/local-access/subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-xgent-csrf": csrf,
    },
    body: JSON.stringify({ event }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const payload = (await response.json()) as { subscriptionId?: string };
  const subscriptionId = payload.subscriptionId;
  if (!subscriptionId) throw new Error("Local access subscription did not return an id");
  eventHandlers.set(subscriptionId, (value) => handler({ payload: value as T }));
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    eventHandlers.delete(subscriptionId);
    void fetch(`/api/local-access/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "x-xgent-csrf": csrfToken() },
    });
  };
}

function unsupported(command: string): never {
  throw new Error(`Runtime command is unavailable in a browser: ${command}`);
}

export const browserRuntime: XgentRuntime = {
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
    return () => {};
  },
};
