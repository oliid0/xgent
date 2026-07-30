import type {
  Tool,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";

import type {
  BrowserAction,
  BrowserActionInput,
  BrowserActionResponse,
} from "../browserAutomation";
import {
  browserSessionController,
  normalizeBrowserAddress,
} from "../browser/browserSessionController";
import {
  type BuiltinToolBundle,
  type BuiltinToolExecutionContext,
  createBuiltinMetadataMap,
} from "./builtinTypes";

const BROWSER_ACTIONS = [
  "open",
  "navigate",
  "new_tab",
  "list_tabs",
  "close_tab",
  "show",
  "hide",
  "reload",
  "go_back",
  "go_forward",
  "screenshot",
  "click",
  "type",
  "get_text",
  "get_readable",
  "scroll",
  "hover",
  "find_elements",
  "get_page_info",
  "get_backbone",
  "wait_for_dom_stable",
  "execute_js",
] as const;

type BrowserUseAction = (typeof BROWSER_ACTIONS)[number];

type BrowserUseArguments = {
  action?: BrowserUseAction;
  session_id?: string;
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
  direction?: "up" | "down";
  amount?: number;
  coordinate_x?: number;
  coordinate_y?: number;
  limit?: number;
  max_depth?: number;
  max_nodes?: number;
  smooth?: boolean;
  timeout?: number;
};

type PageInfo = {
  readyState?: string;
  title?: string;
  url?: string;
  scrollWidth?: number;
  scrollHeight?: number;
};

const BROWSER_PARAMETERS = Type.Object({
  action: Type.Union(BROWSER_ACTIONS.map((action) => Type.Literal(action))),
  session_id: Type.Optional(
    Type.String({
      description:
        "Browser tab id. Omit to continue in the current main tab. Reuse the returned id for follow-up actions.",
    }),
  ),
  url: Type.Optional(
    Type.String({
      description: "HTTP(S) URL or a search phrase for open, navigate, or new_tab.",
    }),
  ),
  selector: Type.Optional(
    Type.String({
      description:
        "CSS selector for click, type, get_text, scroll, hover, or find_elements. Use selectors returned by find_elements/get_backbone.",
    }),
  ),
  text: Type.Optional(Type.String({ description: "Text to enter for action=type." })),
  script: Type.Optional(
    Type.String({
      description:
        "Synchronous JavaScript body for execute_js. Return a JSON-serializable value.",
    }),
  ),
  direction: Type.Optional(
    Type.Union([Type.Literal("up"), Type.Literal("down")]),
  ),
  amount: Type.Optional(
    Type.Number({ minimum: 1, maximum: 10_000, description: "Scroll distance in CSS pixels." }),
  ),
  coordinate_x: Type.Optional(Type.Number({ description: "Viewport X coordinate for click." })),
  coordinate_y: Type.Optional(Type.Number({ description: "Viewport Y coordinate for click." })),
  limit: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100, description: "Maximum matching elements." }),
  ),
  max_depth: Type.Optional(
    Type.Number({ minimum: 1, maximum: 8, description: "Maximum DOM backbone depth." }),
  ),
  max_nodes: Type.Optional(
    Type.Number({ minimum: 10, maximum: 800, description: "Maximum DOM backbone nodes." }),
  ),
  smooth: Type.Optional(Type.Boolean({ description: "Use smooth scrolling." })),
  timeout: Type.Optional(
    Type.Number({
      minimum: 500,
      maximum: 30_000,
      description: "Milliseconds for wait_for_dom_stable or the native browser action.",
    }),
  ),
});

function asArguments(value: unknown): BrowserUseArguments {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as BrowserUseArguments;
}

function requiredAction(value: unknown): BrowserUseAction {
  if (typeof value !== "string" || !BROWSER_ACTIONS.includes(value as BrowserUseAction)) {
    throw new Error("browser_use action is invalid.");
  }
  return value as BrowserUseAction;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`browser_use ${label} is required.`);
  }
  return value.trim();
}

function actionInput(args: BrowserUseArguments): BrowserActionInput {
  return {
    url: args.url,
    selector: args.selector,
    text: args.text,
    script: args.script,
    direction: args.direction,
    amount: args.amount,
    x: args.coordinate_x,
    y: args.coordinate_y,
    limit: args.limit,
    maxDepth: args.max_depth,
    maxNodes: args.max_nodes,
    smooth: args.smooth,
  };
}

function runtimeAction(action: BrowserUseAction): BrowserAction {
  switch (action) {
    case "get_readable":
      return "readable";
    case "get_page_info":
      return "page_info";
    case "get_backbone":
      return "backbone";
    default:
      return action as BrowserAction;
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new Error("Cancelled"));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function pageFingerprint(info: PageInfo) {
  return [
    info.readyState ?? "",
    info.url ?? "",
    info.title ?? "",
    info.scrollWidth ?? 0,
    info.scrollHeight ?? 0,
  ].join("|");
}

async function waitForDomStable(
  sessionId: string,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const normalizedTimeout = Math.min(30_000, Math.max(500, timeoutMs));
  const startedAt = Date.now();
  const deadline = startedAt + normalizedTimeout;
  let stableCount = 0;
  let previous = "";
  let latest: BrowserActionResponse | null = null;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Cancelled");
    latest = await browserSessionController.action(
      "page_info",
      {},
      { sessionId, timeoutMs: Math.min(5_000, timeoutMs) },
    );
    const info = (latest.data ?? {}) as PageInfo;
    const fingerprint = pageFingerprint(info);
    const complete = info.readyState === "complete" || info.readyState === "interactive";
    stableCount = complete && fingerprint === previous ? stableCount + 1 : 0;
    previous = fingerprint;
    if (stableCount >= 2) {
      return {
        stable: true,
        elapsedMs: Date.now() - startedAt,
        page: info,
      };
    }
    await abortableDelay(200, signal);
  }

  return {
    stable: false,
    elapsedMs: Date.now() - startedAt,
    page: (latest?.data ?? {}) as PageInfo,
  };
}

function formatResult(
  action: BrowserUseAction,
  sessionId: string,
  result: unknown,
) {
  const encoded = JSON.stringify(result, null, 2);
  const body =
    encoded.length > 24_000
      ? `${encoded.slice(0, 24_000)}\n… browser result truncated`
      : encoded;
  return `browser_use ${action} succeeded in tab "${sessionId}".\n${body}`;
}

export function createBrowserUseTools(): BuiltinToolBundle {
  const tool: Tool = {
    name: "browser_use",
    description:
      "Operate Xgent's embedded browser. It shares the same live WebView tab with the user on PC, Android, and iOS; it is not a separate browser extension. Use navigate/open, then inspect with get_page_info, get_readable, find_elements, or get_backbone before clicking/typing. Reuse session_id for follow-up actions. Prefer selectors returned by the browser over guessed coordinates. Use screenshot when visual inspection is necessary. Use wait_for_dom_stable after navigation or actions that cause a page transition.",
    parameters: BROWSER_PARAMETERS,
  };

  async function executeToolCall(
    toolCall: ToolCall,
    signal?: AbortSignal,
    context?: BuiltinToolExecutionContext,
  ): Promise<ToolResultMessage> {
    const timestamp = Date.now();
    const args = asArguments(toolCall.arguments);
    let action: BrowserUseAction | undefined;
    let sessionId = args.session_id?.trim() || "main";
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      if (toolCall.name !== "browser_use") throw new Error(`Unknown tool: ${toolCall.name}`);
      action = requiredAction(args.action);
      context?.emitToolStatus?.(`Browser · ${action}`);

      let result: unknown;
      let screenshotBase64: string | null | undefined;
      if (action === "list_tabs") {
        await browserSessionController.initialize();
        result = await browserSessionController.refreshSessions();
      } else if (action === "new_tab") {
        const session = args.session_id?.trim()
          ? await browserSessionController.ensureSession({
              sessionId,
              url: normalizeBrowserAddress(args.url || ""),
            })
          : await browserSessionController.newSession(
              normalizeBrowserAddress(args.url || ""),
            );
        sessionId = session.sessionId;
        result = session;
      } else if (action === "open") {
        const session = await browserSessionController.ensureSession({
          sessionId,
          url: normalizeBrowserAddress(requiredString(args.url, "url")),
        });
        result = {
          session,
          dom: await waitForDomStable(
            sessionId,
            Math.min(8_000, Math.max(1_500, args.timeout ?? 5_000)),
            signal,
          ),
        };
      } else if (action === "close_tab") {
        await browserSessionController.closeSession(sessionId);
        result = { closed: true, sessionId };
      } else if (action === "show") {
        await browserSessionController.ensureSession({ sessionId });
        browserSessionController.openPanel(sessionId);
        result = { visible: true, sessionId };
      } else if (action === "hide") {
        browserSessionController.closePanel();
        result = { visible: false, sessionId };
      } else if (action === "wait_for_dom_stable") {
        await browserSessionController.ensureSession({ sessionId });
        result = await waitForDomStable(sessionId, args.timeout ?? 8_000, signal);
      } else {
        if (action === "navigate") {
          args.url = normalizeBrowserAddress(requiredString(args.url, "url"));
        }
        if (action === "type") requiredString(args.selector, "selector");
        if (action === "click" && !args.selector && (args.coordinate_x == null || args.coordinate_y == null)) {
          throw new Error("browser_use click requires selector or coordinate_x + coordinate_y.");
        }
        if (action === "execute_js") requiredString(args.script, "script");

        const response = await browserSessionController.action(
          runtimeAction(action),
          actionInput(args),
          { sessionId, timeoutMs: args.timeout },
        );
        screenshotBase64 = response.screenshotBase64;
        const browserResult = screenshotBase64
          ? {
              ...response,
              screenshotBase64: undefined,
              screenshot: {
                mimeType: "image/png",
                encodedBytes: Math.floor((screenshotBase64.length * 3) / 4),
              },
            }
          : response;
        if (action === "navigate") {
          result = {
            ...browserResult,
            dom: await waitForDomStable(
              sessionId,
              Math.min(8_000, Math.max(1_500, args.timeout ?? 5_000)),
              signal,
            ),
          };
        } else {
          result = browserResult;
        }
      }

      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          { type: "text", text: formatResult(action, sessionId, result) },
          ...(screenshotBase64
            ? [{ type: "image" as const, data: screenshotBase64, mimeType: "image/png" }]
            : []),
        ],
        details: {
          kind: "browser_use",
          action,
          sessionId,
          result,
        },
        isError: false,
        timestamp,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: "text", text: `browser_use failed: ${message}` }],
        details: {
          kind: "browser_use",
          action,
          sessionId,
        },
        isError: true,
        timestamp,
      };
    } finally {
      context?.emitToolStatus?.(null);
    }
  }

  return {
    groupId: "browser",
    tools: [tool],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        "browser_use",
        {
          groupId: "browser",
          kind: "browser_use",
          isReadOnly: false,
          displayCategory: "browser",
        },
      ],
    ]),
  };
}
