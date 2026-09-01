import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  isRetryableAssistantError,
} from "@earendil-works/pi-ai";
import { RETRYABLE_PRESET_HTTP_STATUS_CODES } from "../../settings";

export type { RetryAttemptRecord } from "@/lib/chat/retryAttempts";

/** 6 total attempts = 5 retries after the initial try — matches codex's stream_max_retries=5. */
export const DEFAULT_STREAM_RETRY_MAX_ATTEMPTS = 6;

export type RetryErrorExtension = {
  statusCodes?: number[];
  patterns?: string[];
};

const DEFAULT_RETRY_ERROR_EXTENSION: RetryErrorExtension = {
  statusCodes: [...RETRYABLE_PRESET_HTTP_STATUS_CODES],
  patterns: [],
};

const REQUIRED_RETRY_STATUS_CODES = [529];
// Native WebViews and provider adapters use different wording for the same
// transient transport failures. Keep this list narrow: authentication,
// billing, invalid-request, and model errors must still fail immediately.
const REQUIRED_RETRY_PATTERNS = [
  "bad_response_status_code",
  "bad response status code",
  "bad response",
  "load failed",
  "failed to fetch",
  "network connection was lost",
  "networkerror",
  "connection reset",
  "socket hang up",
];

let currentRetryErrorExtension: RetryErrorExtension = DEFAULT_RETRY_ERROR_EXTENSION;

export function setRetryErrorExtension(extension: RetryErrorExtension | null): void {
  const next = extension ?? DEFAULT_RETRY_ERROR_EXTENSION;
  currentRetryErrorExtension = {
    statusCodes: Array.from(new Set([...REQUIRED_RETRY_STATUS_CODES, ...(next.statusCodes ?? [])])),
    patterns: Array.from(new Set([...REQUIRED_RETRY_PATTERNS, ...(next.patterns ?? [])])),
  };
}

export function isExtensionRetryableError(
  message: AssistantMessage | undefined,
  extension: RetryErrorExtension = currentRetryErrorExtension,
): boolean {
  const errorMessage = message?.errorMessage ?? "";
  if (!errorMessage) return false;
  const codes = Array.from(
    new Set([...REQUIRED_RETRY_STATUS_CODES, ...(extension.statusCodes ?? [])]),
  );
  if (codes.length > 0) {
    const statusPattern = new RegExp(`(?:^|\\D)(?:${codes.join("|")})(?:\\D|$)`);
    if (statusPattern.test(errorMessage)) return true;
  }
  const normalizedMessage = errorMessage.toLocaleLowerCase();
  return [...REQUIRED_RETRY_PATTERNS, ...(extension.patterns ?? [])].some((pattern) => {
    const normalizedPattern = pattern.trim().toLocaleLowerCase();
    return normalizedPattern.length > 0 && normalizedMessage.includes(normalizedPattern);
  });
}

const STREAM_RETRY_BASE_DELAY_MS = 200;
const STREAM_RETRY_BACKOFF_FACTOR = 2;

export type StreamRetryConfig = {
  maxAttempts?: number;
  disabled?: boolean;
  retryExtension?: RetryErrorExtension;
  /**
   * Retry ordinal (1..maxRetries) about to be attempted, invoked before the
   * backoff sleep. `errorMessage` is the failure that triggered this retry;
   * `plannedDelayMs` is the exact backoff that will be applied.
   */
  onRetry?: (
    attempt: number,
    maxAttempts: number,
    errorMessage: string,
    plannedDelayMs?: number,
  ) => void;
  /** Invoked once a retried attempt commits its first content-bearing event. */
  onRetryRecovered?: () => void;
};

export type StreamRetryOptions = StreamRetryConfig & {
  signal?: AbortSignal;
};

type TerminalEvent = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

const COMMITTING_EVENT_TYPES = new Set<AssistantMessageEvent["type"]>([
  "text_delta",
  "thinking_delta",
  "toolcall_start",
]);

function isTerminalEvent(event: AssistantMessageEvent): event is TerminalEvent {
  return event.type === "done" || event.type === "error";
}

function terminalMessage(event: TerminalEvent) {
  return event.type === "done" ? event.message : event.error;
}

function isRetryableTerminal(
  terminal: TerminalEvent | undefined,
  extension: RetryErrorExtension | undefined,
): terminal is Extract<TerminalEvent, { type: "error" }> {
  if (terminal?.type !== "error") return false;
  return (
    isRetryableAssistantError(terminalMessage(terminal)) ||
    isExtensionRetryableError(terminalMessage(terminal), extension)
  );
}

/** Codex-style backoff: base * factor^(attempt-1) * uniform(0.9, 1.1), uncapped. */
export function computeStreamRetryBackoffMs(attempt: number): number {
  const base = STREAM_RETRY_BASE_DELAY_MS * STREAM_RETRY_BACKOFF_FACTOR ** (attempt - 1);
  return base * (0.9 + Math.random() * 0.2);
}

/**
 * The cancellation terminal a consumer must see when the user stops the run
 * during a retry backoff. It reuses the failed attempt's model identity so the
 * record keeps saying which provider/model the cancelled round belonged to.
 */
function buildAbortedAssistantMessage(previous: AssistantMessage | undefined): AssistantMessage {
  return {
    ...(previous ?? {}),
    role: "assistant",
    content: previous?.content ?? [],
    stopReason: "aborted",
    errorMessage: "Cancelled",
  } as AssistantMessage;
}

function sleepWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wraps a fresh-stream factory with attempt-scoped retry for transient
 * provider/transport failures.
 *
 * Events are buffered per attempt until the first content-bearing event
 * ("committed": text_delta / thinking_delta / toolcall_start) is observed. An
 * attempt that ends in error before committing, classified retryable by
 * pi-ai's `isRetryableAssistantError`, is discarded wholesale and replaced by
 * a fresh `factory()` call after a codex-style backoff — the caller never
 * sees the failed attempt's events. Once committed, or once retries are
 * exhausted/disabled, events pass straight through untouched. `onRetry` /
 * `onRetryRecovered` let callers surface an ephemeral "reconnecting" status
 * in place of the frozen UI, mirroring codex's TUI behavior. A stop during the
 * backoff ends the stream with an `aborted` terminal, never with the failed
 * attempt's transport error.
 *
 * The pump below runs eagerly (not gated on the returned stream being
 * iterated) because pi-ai's own stream factories start their network work as
 * soon as they're called, independent of consumer iteration — some callers
 * only await `.result()` without ever iterating events, and that pattern must
 * keep working through this wrapper.
 */
export function withStreamRetry(
  factory: () => AssistantMessageEventStream,
  options?: StreamRetryOptions,
): AssistantMessageEventStream {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? DEFAULT_STREAM_RETRY_MAX_ATTEMPTS);
  const disabled = options?.disabled ?? false;
  const signal = options?.signal;

  const output = createAssistantMessageEventStream();
  const firstSource = factory();

  void (async () => {
    let attempt = 1;
    let source = firstSource;
    let hasRetried = false;
    let replayTarget: { contentIndex: number; text: string } | undefined;
    let visibleFailure: Extract<TerminalEvent, { type: "error" }> | undefined;

    while (true) {
      let committed = false;
      let retrySafe = true;
      let committedText = replayTarget?.text ?? "";
      let committedTextIndex = replayTarget?.contentIndex;
      let replayCursor = 0;
      let replaying = replayTarget !== undefined;
      let replayDiverged = false;
      const buffered: AssistantMessageEvent[] = [];
      let terminal: TerminalEvent | undefined;

      for await (const event of source) {
        if (replaying && replayTarget) {
          if (event.type === "text_delta") {
            if (event.contentIndex !== replayTarget.contentIndex) {
              replayDiverged = true;
              break;
            }
            const remaining = replayTarget.text.slice(replayCursor);
            const replayLength = Math.min(remaining.length, event.delta.length);
            if (event.delta.slice(0, replayLength) !== remaining.slice(0, replayLength)) {
              replayDiverged = true;
              break;
            }
            replayCursor += replayLength;
            if (replayCursor < replayTarget.text.length) continue;

            replaying = false;
            committed = true;
            hasRetried = false;
            options?.onRetryRecovered?.();
            const suffix = event.delta.slice(replayLength);
            if (suffix) {
              committedText += suffix;
              output.push({ ...event, delta: suffix });
            }
            continue;
          }

          if (isTerminalEvent(event)) {
            terminal = event;
            if (event.type === "done") replayDiverged = true;
            break;
          }
          if (
            event.type === "thinking_start" ||
            event.type === "thinking_delta" ||
            event.type === "thinking_end" ||
            event.type === "toolcall_start" ||
            event.type === "toolcall_delta" ||
            event.type === "toolcall_end" ||
            event.type === "text_end"
          ) {
            replayDiverged = true;
            break;
          }
          // The replacement stream's start/text_start describes content that
          // is already visible, so it is intentionally suppressed.
          continue;
        }

        if (!committed && COMMITTING_EVENT_TYPES.has(event.type)) {
          committed = true;
          for (const bufferedEvent of buffered.splice(0)) output.push(bufferedEvent);
          if (hasRetried) {
            hasRetried = false;
            options?.onRetryRecovered?.();
          }
        }
        if (event.type === "text_delta") {
          if (committedTextIndex === undefined) {
            committedTextIndex = event.contentIndex;
          } else if (committedTextIndex !== event.contentIndex) {
            retrySafe = false;
          }
          committedText += event.delta;
        } else if (
          event.type === "thinking_start" ||
          event.type === "thinking_delta" ||
          event.type === "thinking_end" ||
          event.type === "toolcall_start" ||
          event.type === "toolcall_delta" ||
          event.type === "toolcall_end"
        ) {
          retrySafe = false;
        }
        if (isTerminalEvent(event)) terminal = event;
        if (committed && !isTerminalEvent(event)) {
          output.push(event);
        } else {
          buffered.push(event);
        }
      }

      if (replayDiverged && visibleFailure) {
        output.push(visibleFailure);
        output.end(terminalMessage(visibleFailure));
        return;
      }

      const mayReplayVisibleText =
        (committed || replaying) &&
        retrySafe &&
        committedText.length > 0 &&
        committedTextIndex !== undefined;
      if (
        isRetryableTerminal(terminal, options?.retryExtension) &&
        (!committed || mayReplayVisibleText) &&
        !disabled &&
        attempt < maxAttempts
      ) {
          if (mayReplayVisibleText && committedTextIndex !== undefined) {
            replayTarget = { contentIndex: committedTextIndex, text: committedText };
            visibleFailure = terminal;
          }
          const errorMessage = terminalMessage(terminal)?.errorMessage || "Unknown error";
          attempt += 1;
          const plannedDelayMs = Math.round(computeStreamRetryBackoffMs(attempt - 1));
          options?.onRetry?.(attempt - 1, maxAttempts - 1, errorMessage, plannedDelayMs);
          hasRetried = true;
          try {
            await sleepWithAbort(plannedDelayMs, signal);
            source = factory();
            continue;
          } catch {
            // Stopped mid-backoff: the terminal must say "aborted", not replay
            // the prior attempt's transport error. Handing the consumer that
            // error instead loses the fact that the user stopped the run — the
            // abort branches upstream never fire, so nothing records the
            // cancellation and the status row falls back to a spinner.
            if (signal?.aborted) {
              const aborted = buildAbortedAssistantMessage(
                terminalMessage(terminal) as AssistantMessage | undefined,
              );
              output.push({ type: "error", reason: "aborted", error: aborted });
              output.end(aborted);
              return;
            }
            // The next attempt failed to start — surface the prior attempt's
            // real failure below instead of hanging the consumer on a retry
            // that will never happen.
          }
      }

      if (replaying && visibleFailure) {
        output.push(visibleFailure);
        output.end(terminalMessage(visibleFailure));
        return;
      }
      if (!committed) {
        for (const bufferedEvent of buffered) output.push(bufferedEvent);
      } else if (terminal) {
        output.push(terminal);
      }
      // Some streams (notably minimal test doubles) never yield a terminal
      // done/error event through iteration and only expose the final message
      // via result(). output.end() is idempotent once a terminal event has
      // already been pushed above, so this also safety-nets that case.
      output.end(await source.result());
      return;
    }
  })();

  return output;
}
