import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  type BrowserHumanAssistanceCompletion,
  BrowserSessionController,
  browserSessionController,
  normalizeBrowserAddress,
} from "../browser/browserSessionController";
import type {
  BrowserAction,
  BrowserActionInput,
  BrowserActionResponse,
} from "../browserAutomation";
import { createLanPcBrowserAutomationClient } from "../browserAutomation";
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
  "press_key",
  "get_text",
  "get_readable",
  "scroll",
  "hover",
  "find_elements",
  "get_page_info",
  "get_backbone",
  "snapshot",
  "wait_for_selector",
  "wait_for_dom_stable",
  "execute_js",
] as const;

type BrowserUseAction = (typeof BROWSER_ACTIONS)[number];

type BrowserUseArguments = {
  action?: BrowserUseAction;
  session_id?: string;
  url?: string;
  selector?: string;
  ref?: string;
  text?: string;
  key?: string;
  submit?: boolean;
  script?: string;
  direction?: "up" | "down" | "left" | "right";
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
  ref: Type.Optional(
    Type.String({
      description:
        "Stable element reference (for example e12) returned by snapshot, get_backbone, or find_elements. Prefer ref over a CSS selector.",
    }),
  ),
  text: Type.Optional(Type.String({ description: "Text to enter for action=type." })),
  key: Type.Optional(Type.String({ description: "Keyboard key for action=press_key." })),
  submit: Type.Optional(
    Type.Boolean({ description: "Submit the containing form after action=type." }),
  ),
  script: Type.Optional(
    Type.String({
      description: "Synchronous JavaScript body for execute_js. Return a JSON-serializable value.",
    }),
  ),
  direction: Type.Optional(
    Type.Union([
      Type.Literal("up"),
      Type.Literal("down"),
      Type.Literal("left"),
      Type.Literal("right"),
    ]),
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
    ref: args.ref,
    text: args.text,
    key: args.key,
    submit: args.submit,
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
    case "snapshot":
      return "snapshot";
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
  controller: BrowserSessionController,
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
  let latestError: unknown = null;

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Cancelled");
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    try {
      latest = await controller.action(
        "page_info",
        {},
        { sessionId, timeoutMs: Math.min(5_000, remainingMs) },
      );
      latestError = null;
    } catch (error) {
      // A document swap can cancel an in-flight evaluation. CDP clients wait
      // for the next lifecycle event; WebView-backed platforms retry after the
      // new document becomes evaluable instead of failing the tool call.
      latestError = error;
      stableCount = 0;
      previous = "";
      await abortableDelay(Math.min(200, Math.max(0, deadline - Date.now())), signal);
      continue;
    }
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
    await abortableDelay(Math.min(200, Math.max(0, deadline - Date.now())), signal);
  }

  return {
    stable: false,
    elapsedMs: Date.now() - startedAt,
    page: (latest?.data ?? {}) as PageInfo,
    error:
      latestError instanceof Error
        ? latestError.message
        : latestError
          ? String(latestError)
          : undefined,
  };
}

async function waitForSelector(
  controller: BrowserSessionController,
  sessionId: string,
  selector: string,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const normalizedTimeout = Math.min(30_000, Math.max(500, timeoutMs));
  const startedAt = Date.now();
  const deadline = startedAt + normalizedTimeout;
  let latestError: unknown = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Cancelled");
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    let response: BrowserActionResponse;
    try {
      response = await controller.action(
        "find_elements",
        { selector, limit: 1 },
        { sessionId, timeoutMs: Math.min(5_000, remainingMs) },
      );
      latestError = null;
    } catch (error) {
      latestError = error;
      await abortableDelay(Math.min(200, Math.max(0, deadline - Date.now())), signal);
      continue;
    }
    const data = (response.data ?? {}) as { count?: number; elements?: unknown[] };
    if ((data.count ?? 0) > 0) {
      return { found: true, elapsedMs: Date.now() - startedAt, ...data };
    }
    await abortableDelay(Math.min(200, Math.max(0, deadline - Date.now())), signal);
  }
  return {
    found: false,
    elapsedMs: Date.now() - startedAt,
    selector,
    error:
      latestError instanceof Error
        ? latestError.message
        : latestError
          ? String(latestError)
          : undefined,
  };
}

function formatResult(action: BrowserUseAction, sessionId: string, result: unknown) {
  const encoded = JSON.stringify(result, null, 2) ?? "null";
  const body =
    encoded.length > 24_000 ? `${encoded.slice(0, 24_000)}\n… browser result truncated` : encoded;
  if (
    result &&
    typeof result === "object" &&
    "handoff" in result &&
    result.handoff === "human_assistance_completed"
  ) {
    return `browser_use paused for the user's live assistance in tab "${sessionId}". Continue from the fresh post-assistance snapshot below; do not repeat the superseded action.\n${body}`;
  }
  return `browser_use ${action} succeeded in tab "${sessionId}".\n${body}`;
}

async function postAssistanceHandoff(
  controller: BrowserSessionController,
  sessionId: string,
  requestedAction: BrowserUseAction,
  observedSequence: number,
  requestedActionExecuted: boolean,
  signal?: AbortSignal,
  context?: BuiltinToolExecutionContext,
) {
  let completion: BrowserHumanAssistanceCompletion | undefined =
    controller.getSnapshot().completedHumanAssistance[sessionId];
  if ((completion?.sequence ?? 0) <= observedSequence) completion = undefined;

  if (controller.isHumanAssistanceActive(sessionId)) {
    context?.emitToolStatus?.("Browser · waiting for your assistance");
    completion =
      (await controller.waitForHumanAssistance(sessionId, 5 * 60_000, signal)) ?? completion;
  }
  if (!completion || completion.sequence <= observedSequence) return null;

  context?.emitToolStatus?.("Browser · reading the assisted page");
  const freshSnapshot = await controller.action("snapshot", {}, { sessionId, timeoutMs: 10_000 });
  return {
    handoff: "human_assistance_completed",
    humanAssistance: {
      sequence: completion.sequence,
      startedAt: completion.startedAt,
      finishedAt: completion.finishedAt,
    },
    requestedAction,
    requestedActionExecuted,
    instruction:
      "The user manually operated this same live browser tab. Continue from freshState and do not repeat an action the user already completed.",
    freshState: {
      sessionId,
      url: freshSnapshot.url,
      title: freshSnapshot.title,
      snapshot: freshSnapshot.data,
    },
  };
}

export type BrowserUseToolsOptions = {
  delegateToLanPc?: {
    enabled: boolean;
    baseUrl: string;
  };
};

export function createBrowserUseTools(options: BrowserUseToolsOptions = {}): BuiltinToolBundle {
  const lanDelegation = options.delegateToLanPc;
  const observedAssistanceSequences = new WeakMap<BrowserSessionController, Map<string, number>>();
  const observedAssistanceSequence = (controller: BrowserSessionController, sessionId: string) =>
    observedAssistanceSequences.get(controller)?.get(sessionId) ?? 0;
  const markAssistanceObserved = (
    controller: BrowserSessionController,
    sessionId: string,
    sequence: number,
  ) => {
    const sessions = observedAssistanceSequences.get(controller) ?? new Map<string, number>();
    sessions.set(sessionId, sequence);
    observedAssistanceSequences.set(controller, sessions);
  };
  const remoteController =
    lanDelegation?.enabled && lanDelegation.baseUrl.trim()
      ? new BrowserSessionController(
          createLanPcBrowserAutomationClient(lanDelegation.baseUrl.trim()),
        )
      : null;
  let resolvedController: Promise<BrowserSessionController> | null = null;
  const resolveController = () => {
    if (!remoteController) return Promise.resolve(browserSessionController);
    resolvedController ??= remoteController.initialize().then((state) => {
      if (state.status?.available && !state.error) return remoteController;
      return browserSessionController;
    });
    return resolvedController;
  };
  const tool: Tool = {
    name: "browser_use",
    description:
      "Operate Xgent's embedded browser. It shares one live native WebView tab with the user on Windows, macOS, Linux, iOS, and Android; it is not a separate browser extension. Use open/navigate, then snapshot to receive stable element refs. Click, type, press keys, hover, or scroll with ref whenever possible. Reuse session_id for follow-up actions. When the user finishes an explicit takeover, the tool returns a fresh human_assistance_completed snapshot; continue from it and do not repeat the superseded action. Use wait_for_selector or wait_for_dom_stable after page changes and screenshot when visual layout matters.",
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
    let controller: BrowserSessionController | null = null;
    let assistanceSequenceAtStart = 0;
    let respectsHumanAssistance = false;
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      if (toolCall.name !== "browser_use") throw new Error(`Unknown tool: ${toolCall.name}`);
      action = requiredAction(args.action);
      context?.emitToolStatus?.(`Browser · ${action}`);
      controller = await resolveController();
      const activeController = controller;
      const delegated = activeController !== browserSessionController;
      const revealAgentSession = () => {
        if (!delegated) activeController.openPanel(sessionId, "agent");
      };

      respectsHumanAssistance = !["list_tabs", "new_tab", "close_tab", "show", "hide"].includes(
        action,
      );
      assistanceSequenceAtStart = observedAssistanceSequence(controller, sessionId);

      let result: unknown;
      let screenshotBase64: string | null | undefined;
      const assistedBeforeAction = respectsHumanAssistance
        ? await postAssistanceHandoff(
            controller,
            sessionId,
            action,
            assistanceSequenceAtStart,
            false,
            signal,
            context,
          )
        : null;
      if (assistedBeforeAction) {
        result = assistedBeforeAction;
        markAssistanceObserved(
          controller,
          sessionId,
          assistedBeforeAction.humanAssistance.sequence,
        );
      } else if (action === "list_tabs") {
        await controller.initialize();
        result = await controller.refreshSessions();
      } else if (action === "new_tab") {
        const session = args.session_id?.trim()
          ? await controller.ensureSession({
              sessionId,
              url: normalizeBrowserAddress(args.url || ""),
            })
          : await controller.newSession(normalizeBrowserAddress(args.url || ""));
        sessionId = session.sessionId;
        revealAgentSession();
        result = session;
      } else if (action === "open") {
        const session = await controller.ensureSession({
          sessionId,
          url: normalizeBrowserAddress(requiredString(args.url, "url")),
        });
        revealAgentSession();
        await abortableDelay(250, signal);
        result = {
          session,
          dom: await waitForDomStable(
            controller,
            sessionId,
            Math.min(8_000, Math.max(1_500, args.timeout ?? 5_000)),
            signal,
          ),
        };
      } else if (action === "close_tab") {
        await controller.closeSession(sessionId);
        result = { closed: true, sessionId };
      } else if (action === "show") {
        await controller.ensureSession({ sessionId });
        if (delegated) {
          result = { visible: false, delegated: true, sessionId };
        } else {
          controller.openPanel(sessionId);
          result = { visible: true, delegated: false, sessionId };
        }
      } else if (action === "hide") {
        if (!delegated) controller.closePanel();
        result = { visible: false, delegated, sessionId };
      } else if (action === "wait_for_dom_stable") {
        await controller.ensureSession({ sessionId });
        revealAgentSession();
        result = await waitForDomStable(controller, sessionId, args.timeout ?? 8_000, signal);
      } else if (action === "wait_for_selector") {
        await controller.ensureSession({ sessionId });
        revealAgentSession();
        result = await waitForSelector(
          controller,
          sessionId,
          requiredString(args.selector, "selector"),
          args.timeout ?? 8_000,
          signal,
        );
      } else {
        if (action === "navigate") {
          args.url = normalizeBrowserAddress(requiredString(args.url, "url"));
        }
        if (action === "type" && !args.selector && !args.ref) {
          throw new Error("browser_use type requires ref or selector.");
        }
        if (action === "press_key") requiredString(args.key, "key");
        if (
          action === "click" &&
          !args.selector &&
          !args.ref &&
          (args.coordinate_x == null || args.coordinate_y == null)
        ) {
          throw new Error(
            "browser_use click requires ref, selector, or coordinate_x + coordinate_y.",
          );
        }
        if (action === "execute_js") requiredString(args.script, "script");

        await controller.ensureSession({ sessionId });
        revealAgentSession();
        const response = await controller.action(runtimeAction(action), actionInput(args), {
          sessionId,
          timeoutMs: args.timeout,
        });
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
        if (
          action === "navigate" ||
          action === "reload" ||
          action === "go_back" ||
          action === "go_forward" ||
          action === "click" ||
          action === "type" ||
          action === "press_key"
        ) {
          await abortableDelay(250, signal);
          result = {
            ...browserResult,
            dom: await waitForDomStable(
              controller,
              sessionId,
              Math.min(8_000, Math.max(1_500, args.timeout ?? 5_000)),
              signal,
            ),
          };
        } else {
          result = browserResult;
        }
      }

      if (respectsHumanAssistance && !assistedBeforeAction) {
        const assistedAfterAction = await postAssistanceHandoff(
          controller,
          sessionId,
          action,
          assistanceSequenceAtStart,
          true,
          signal,
          context,
        );
        if (assistedAfterAction) {
          result = assistedAfterAction;
          screenshotBase64 = undefined;
          markAssistanceObserved(
            controller,
            sessionId,
            assistedAfterAction.humanAssistance.sequence,
          );
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
      if (controller && action && respectsHumanAssistance) {
        try {
          const assistedAfterError = await postAssistanceHandoff(
            controller,
            sessionId,
            action,
            assistanceSequenceAtStart,
            false,
            signal,
            context,
          );
          if (assistedAfterError) {
            markAssistanceObserved(
              controller,
              sessionId,
              assistedAfterError.humanAssistance.sequence,
            );
            return {
              role: "toolResult",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [
                { type: "text", text: formatResult(action, sessionId, assistedAfterError) },
              ],
              details: {
                kind: "browser_use",
                action,
                sessionId,
                result: assistedAfterError,
              },
              isError: false,
              timestamp,
            };
          }
        } catch {
          // If reading the assisted page also fails, preserve the original
          // correlated browser error below rather than reporting false success.
        }
      }
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
