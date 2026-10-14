import type { Context, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { sha256Hex } from "../trajectory/sha256";
import { backend } from "./backend";
import { captureBackgroundLease } from "./backgroundLease";
import { backgroundResumeBinding, verifyBackgroundResumeReceipt } from "./backgroundResumeReceipt";
import { BackgroundChildLaunchPending, BackgroundCloudLaunchPending } from "./backgroundWaiting";
import type { BackgroundExecutionLease, BeginBackgroundOperationResponse } from "./types";

const RECEIPT_FULL_BYTES = 128 * 1024;
const RECEIPT_DETAIL_BYTES = 32 * 1024;
const RECEIPT_TEXT_CHARS = 16 * 1024;
const CONTEXT_BYTES = 4 * 1024 * 1024;
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** Large images/output retain a digest and an explicit omission marker. Never
 * substitute a truncated receipt for evidence that an external action succeeded. */
export function backgroundReceipt(result: ToolResultMessage): ToolResultMessage {
  const serialized = JSON.stringify(result);
  if (byteLength(serialized) <= RECEIPT_FULL_BYTES) return JSON.parse(serialized);
  const digest = sha256Hex(serialized);
  const excerpt = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .slice(0, RECEIPT_TEXT_CHARS);
  const details = result.details === undefined ? undefined : JSON.stringify(result.details);
  return {
    role: "toolResult",
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    isError: result.isError,
    timestamp: result.timestamp,
    content: [
      {
        type: "text",
        text: `${excerpt}\n[Persisted receipt excerpt; full result omitted due to size. SHA-256: ${digest}. Re-read source data if needed; do not replay external writes.]`,
      },
    ],
    details: {
      receiptHash: digest,
      receiptTruncated: true,
      outcomeUncertain:
        result.details &&
        typeof result.details === "object" &&
        result.details.outcomeUncertain === true
          ? true
          : undefined,
      originalDetails:
        details && byteLength(details) <= RECEIPT_DETAIL_BYTES ? result.details : undefined,
    },
  };
}

/** Persistence barriers surround every delegated local tool invocation. */
export function createBackgroundExecutionJournal(
  executionId: string,
  context: Context,
  parentSignal: AbortSignal,
  options: {
    isReadOnly?: (call: ToolCall) => boolean;
    lease?: BackgroundExecutionLease;
    revision?: number;
    isTaskStateOnly?: (call: ToolCall) => boolean;
    recoverCloudStart?: (callId: string) => Promise<ToolResultMessage | null>;
    recoverSubagentBatch?: (call: ToolCall) => Promise<ToolResultMessage | null>;
    recoverBackgroundResume?: (call: ToolCall) => Promise<ToolResultMessage | null>;
    verifySubagentBatchReadOnly?: (call: ToolCall, receipt: ToolResultMessage) => Promise<boolean>;
    deferUnconfirmedCloudStart?: boolean;
    deferUnconfirmedChildStart?: boolean;
  } = {},
) {
  const lease = captureBackgroundLease(options.lease);
  const controller = new AbortController();
  const abort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", abort, { once: true });
  if (parentSignal.aborted) abort();
  let failure: Error | undefined;
  let revision = options.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
    throw new Error("Invalid restored background checkpoint revision");
  let compacting = false;
  let queue = Promise.resolve();
  let systemPrompt = context.systemPrompt;
  const messages: Message[] = [...context.messages];
  const calls = new Map<string, { binding: string; result: Promise<Message> }>();

  function fail(error: unknown): Error {
    failure ??= error instanceof Error ? error : new Error(String(error));
    controller.abort(failure);
    return failure;
  }
  function check() {
    if (failure) throw failure;
    controller.signal.throwIfAborted();
  }
  async function flush() {
    await queue;
    check();
  }
  function persistContext() {
    try {
      const serialized = JSON.stringify({ systemPrompt, messages });
      if (byteLength(serialized) > CONTEXT_BYTES)
        throw new Error(
          "Background context exceeded 4 MiB; execution stopped before another action. Compact context before continuing.",
        );
      // Capture the exact snapshot now, before later callbacks change messages.
      const snapshot = JSON.parse(serialized);
      queue = queue
        .then(async () => {
          check();
          const next = revision + 1;
          const saved = await backend.saveBackgroundCheckpoint(executionId, next, snapshot, lease);
          if (saved !== next)
            throw new Error("Background checkpoint acknowledgement does not match its revision");
          revision = saved;
        })
        .catch((error) => {
          fail(error);
        });
    } catch (error) {
      fail(error);
    }
  }
  function noteMessage(message: Message) {
    if (failure || controller.signal.aborted) return;
    if (compacting) {
      fail(new Error("Background message arrived while replacing its context checkpoint"));
      return;
    }
    try {
      const persisted = message.role === "toolResult" ? backgroundReceipt(message) : message;
      if (persisted.role === "toolResult") {
        const index = messages.findIndex(
          (candidate) =>
            candidate.role === "toolResult" && candidate.toolCallId === persisted.toolCallId,
        );
        if (index >= 0) messages[index] = persisted;
        else messages.push(persisted);
      } else messages.push(persisted);
      persistContext();
    } catch (error) {
      fail(error);
    }
  }

  async function checkpointContext(next: Pick<Context, "systemPrompt" | "messages">) {
    await flush();
    if (compacting)
      throw fail(new Error("Background checkpoint arrived during context compaction"));
    try {
      // The runner may reconcile hosted-search/tool messages or replace its
      // context. Persist its canonical message list, not just callback events.
      const persisted = next.messages.map((message) =>
        message.role === "toolResult" ? backgroundReceipt(message) : message,
      );
      systemPrompt = next.systemPrompt;
      messages.splice(0, messages.length, ...persisted);
      persistContext();
    } catch (error) {
      fail(error);
    }
    await flush();
  }

  async function recoverCloudStart(call: ToolCall) {
    if (
      call.name !== "CloudTaskManager" ||
      (call.arguments as { action?: string } | undefined)?.action !== "start" ||
      !options.recoverCloudStart
    )
      return null;
    const result = await options.recoverCloudStart(call.id);
    if (!result) return null;
    const details = result.details;
    if (
      result.role !== "toolResult" ||
      result.toolCallId !== call.id ||
      result.toolName !== call.name ||
      result.isError !== false ||
      details?.kind !== "cloud_task_manager" ||
      details.action !== "start" ||
      ![details.taskId, details.owner, details.repository].every(
        (value) => typeof value === "string" && value.trim(),
      )
    )
      throw new Error("Native cloud recovery returned a mismatched start receipt");
    return result;
  }

  async function recoverBackgroundResume(call: ToolCall) {
    const binding = backgroundResumeBinding(call, executionId);
    if (!binding || !options.recoverBackgroundResume) return null;
    check();
    const result = await options.recoverBackgroundResume(call);
    check();
    if (!result) return null;
    if (
      result.role !== "toolResult" ||
      result.toolCallId !== call.id ||
      result.toolName !== call.name ||
      result.isError !== false ||
      result.details?.kind !== "background_task" ||
      result.details.action !== "resume" ||
      result.details.reconciledResume !== true ||
      result.details.result?.peerId !== binding.peerId ||
      result.details.result?.result?.status !== "response_accepted" ||
      result.details.outcomeUncertain === true
    )
      throw new Error("Native response recovery returned a mismatched acceptance receipt");
    verifyBackgroundResumeReceipt(result.details.result.result.receipt, binding);
    return result;
  }

  async function provenReadOnlyBatch(call: ToolCall, result: ToolResultMessage) {
    if (call.name !== "Agent" || !result.isError || result.details?.outcomeUncertain === true)
      return false;
    try {
      return (await options.verifySubagentBatchReadOnly?.(call, result)) === true;
    } catch {
      // Unavailable native evidence cannot authorize a retry/continuation.
      return false;
    }
  }

  async function invokeOperation(
    call: ToolCall,
    signal: AbortSignal | undefined,
    execute: () => Promise<Message>,
  ): Promise<Message> {
    await flush();
    if (compacting) throw fail(new Error("Background operation started during context compaction"));
    let intent: BeginBackgroundOperationResponse;
    try {
      intent = await backend.beginBackgroundOperation(
        executionId,
        call.id,
        call.name,
        call.arguments,
        lease,
      );
    } catch (error) {
      throw fail(
        new Error(
          `Operation ${call.id} intent could not be confirmed; no further actions were started. Inspect persisted operations before retrying. ${String(error)}`,
        ),
      );
    }
    if (intent.status === "uncertain") {
      if (call.name === "OriginalDeviceTask") {
        try {
          const result = await backend.planOriginalDevice(executionId, call.id, lease);
          if (
            result?.role !== "toolResult" ||
            result.toolCallId !== call.id ||
            result.toolName !== call.name ||
            result.details?.kind !== "original_device_planning" ||
            (result.isError && result.details?.knownNoEffect !== true)
          )
            throw new Error("Original native planning recovery changed its intent or effect proof");
          return result;
        } catch (error) {
          throw fail(
            new Error(`Original native planning intent could not be recovered: ${String(error)}`),
          );
        }
      }
      try {
        const recovered = await recoverBackgroundResume(call);
        if (recovered) {
          await backend.completeBackgroundOperation(
            executionId,
            call.id,
            backgroundReceipt(recovered),
            lease,
          );
          return recovered;
        }
      } catch (error) {
        if (
          options.deferUnconfirmedChildStart &&
          call.name === "BackgroundTask" &&
          (call.arguments as { action?: string })?.action === "resume"
        )
          throw fail(
            new BackgroundChildLaunchPending({
              role: "toolResult",
              toolCallId: call.id,
              toolName: call.name,
              isError: true,
              timestamp: Date.now(),
              content: [
                {
                  type: "text",
                  text: `Original child response evidence is unavailable; native ownership must be inspected without resending. ${String(error)}`,
                },
              ],
              details: { outcomeUncertain: true },
            }),
          );
        throw fail(
          new Error(
            `Original response could not be reconciled; no response was resent. ${String(error)}`,
          ),
        );
      }
      if (
        options.deferUnconfirmedChildStart &&
        call.name === "BackgroundTask" &&
        ["submit", "resume"].includes((call.arguments as { action?: string })?.action ?? "")
      )
        throw fail(
          new BackgroundChildLaunchPending({
            role: "toolResult",
            toolCallId: call.id,
            toolName: call.name,
            isError: true,
            timestamp: Date.now(),
            content: [
              {
                type: "text",
                text: "Original child submission has an intent without acceptance. Native recovery must inspect its reserved owner; no task was resent.",
              },
            ],
            details: { outcomeUncertain: true },
          }),
        );
      if (call.name === "Agent" && options.recoverSubagentBatch) {
        try {
          const recovered = await options.recoverSubagentBatch(call);
          if (recovered) {
            if (
              recovered.role !== "toolResult" ||
              recovered.toolCallId !== call.id ||
              recovered.toolName !== call.name ||
              typeof recovered.isError !== "boolean"
            )
              throw new Error("Subordinate recovery returned a mismatched terminal batch receipt");
            const failedMutation =
              recovered.isError && !(await provenReadOnlyBatch(call, recovered));
            const receipt = failedMutation
              ? {
                  ...recovered,
                  details: {
                    ...(recovered.details && typeof recovered.details === "object"
                      ? recovered.details
                      : {}),
                    outcomeUncertain: true,
                  },
                }
              : recovered;
            await backend.completeBackgroundOperation(
              executionId,
              call.id,
              backgroundReceipt(receipt),
              lease,
            );
            if (failedMutation)
              throw new Error(
                "Recovered subordinate failures may have external effects; inspect their exact saved reports before continuing. No agents were replayed.",
              );
            return receipt;
          }
        } catch (error) {
          throw fail(
            new Error(
              `Original subordinate batch could not be reconciled; no agents were replayed. ${String(error)}`,
            ),
          );
        }
      }
      try {
        const recovered = await recoverCloudStart(call);
        if (recovered) {
          await backend.completeBackgroundOperation(
            executionId,
            call.id,
            backgroundReceipt(recovered),
            lease,
          );
          return recovered;
        }
      } catch (error) {
        throw fail(
          new Error(
            `Original cloud start could not be reconciled; no dispatch was replayed. ${String(error)}`,
          ),
        );
      }
      throw fail(
        new Error(
          `Operation ${call.id} (${call.name}) has a persisted intent without a receipt. Its external outcome is unknown; reconcile it before continuing.`,
        ),
      );
    }
    if (intent.status === "returned") {
      let result = intent.result as ToolResultMessage | undefined;
      if (
        result?.role !== "toolResult" ||
        result.toolCallId !== call.id ||
        result.toolName !== call.name
      )
        throw fail(new Error("Stored operation receipt does not match the requested call"));
      if (
        call.name === "Agent" &&
        result.details?.receiptTruncated === true &&
        result.details?.outcomeUncertain !== true &&
        options.recoverSubagentBatch
      ) {
        try {
          const full = await options.recoverSubagentBatch(call);
          if (
            !full ||
            full.role !== "toolResult" ||
            full.toolCallId !== call.id ||
            full.toolName !== call.name ||
            full.isError !== result.isError ||
            sha256Hex(JSON.stringify(full)) !== result.details.receiptHash
          )
            throw new Error("Original subordinate report does not match its frozen receipt digest");
          result = full;
        } catch (error) {
          throw fail(
            new Error(
              `Stored subordinate report could not be restored; no agents were replayed. ${String(error)}`,
            ),
          );
        }
      }
      if (
        result.isError &&
        !(await provenReadOnlyBatch(call, result)) &&
        options.isReadOnly?.(call) !== true &&
        options.isTaskStateOnly?.(call) !== true
      ) {
        if (
          options.deferUnconfirmedChildStart &&
          call.name === "BackgroundTask" &&
          ["submit", "resume"].includes((call.arguments as { action?: string })?.action ?? "") &&
          result.details?.outcomeUncertain === true
        )
          throw fail(new BackgroundChildLaunchPending(backgroundReceipt(result)));
        if (
          options.deferUnconfirmedCloudStart &&
          call.name === "CloudTaskManager" &&
          (call.arguments as { action?: string } | undefined)?.action === "start" &&
          result.details?.outcomeUncertain === true
        )
          throw fail(new BackgroundCloudLaunchPending(backgroundReceipt(result)));
        throw fail(
          new Error(
            `Operation ${call.id} has a failed write receipt; reconcile its external outcome before continuing.`,
          ),
        );
      }
      return result;
    }
    if (intent.status !== "execute") throw fail(new Error("Unknown background operation decision"));
    const readOnly = options.isReadOnly?.(call) === true;
    let result: Message;
    let invocationError: unknown;
    try {
      check();
      signal?.throwIfAborted();
      result = await execute();
    } catch (error) {
      invocationError = error;
      result = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        isError: true,
        timestamp: Date.now(),
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        details: {
          outcomeUncertain: !readOnly,
          instruction: readOnly
            ? "This host-classified read failed. Use its actual error to investigate or choose another authorized observation; it is not success evidence."
            : "Inspect the external system before retrying this operation.",
        },
      };
    }
    if (result.role === "toolResult" && result.isError) {
      try {
        const recovered = await recoverBackgroundResume(call);
        if (recovered) {
          result = recovered;
          invocationError = undefined;
        }
      } catch (error) {
        result = {
          ...result,
          details: { ...result.details, resumeRecoveryError: String(error).slice(0, 1024) },
        };
      }
      try {
        const recovered = await recoverCloudStart(call);
        if (recovered) {
          result = recovered;
          invocationError = undefined;
        }
      } catch (error) {
        result = {
          ...result,
          details: { ...result.details, cloudRecoveryError: String(error).slice(0, 1024) },
        };
      }
    }
    if (
      result.role !== "toolResult" ||
      result.toolCallId !== call.id ||
      result.toolName !== call.name
    )
      throw fail(
        new Error(
          "Tool returned an invalid operation receipt; inspect the persisted intent before retrying",
        ),
      );
    const batchIsReadOnly = await provenReadOnlyBatch(call, result);
    const failedWrite =
      result.isError && !batchIsReadOnly && !readOnly && options.isTaskStateOnly?.(call) !== true;
    if (failedWrite) {
      result = {
        ...result,
        details: {
          ...(result.details && typeof result.details === "object" ? result.details : {}),
          outcomeUncertain: true,
          instruction:
            "A tool error does not prove that external effects did not occur. Inspect the external system before retrying this write.",
        },
      };
    }
    if (
      failedWrite &&
      options.deferUnconfirmedCloudStart &&
      call.name === "CloudTaskManager" &&
      (call.arguments as { action?: string } | undefined)?.action === "start"
    )
      throw fail(new BackgroundCloudLaunchPending(backgroundReceipt(result)));
    if (
      failedWrite &&
      options.deferUnconfirmedChildStart &&
      call.name === "BackgroundTask" &&
      ["submit", "resume"].includes((call.arguments as { action?: string })?.action ?? "")
    )
      throw fail(new BackgroundChildLaunchPending(backgroundReceipt(result)));
    try {
      // This receipt remains useful even if the user cancelled during execution.
      await backend.completeBackgroundOperation(
        executionId,
        call.id,
        backgroundReceipt(result),
        lease,
      );
    } catch (error) {
      throw fail(
        new Error(
          `Operation ${call.id} returned but its receipt could not be confirmed. Do not replay it. ${String(error)}`,
        ),
      );
    }
    if (invocationError !== undefined && !readOnly)
      throw fail(
        new Error(
          `Operation ${call.id} threw during execution; its recorded error does not prove that external effects were rolled back. ${String(invocationError)}`,
        ),
      );
    if (failedWrite)
      throw fail(
        new Error(
          `Operation ${call.id} (${call.name}) returned a write error. Its external outcome may be uncertain; no further actions were started. Inspect its recorded receipt before retrying.`,
        ),
      );
    if (readOnly && result.isError) {
      // A saved read failure can inform another model step. Cancellation and
      // parallel operation failure still win, even after its receipt returned.
      check();
      signal?.throwIfAborted();
    }
    return result;
  }

  persistContext();
  return {
    signal: controller.signal,
    noteMessage,
    checkpointContext,
    checkpointMessages: (next: Message[]) => checkpointContext({ systemPrompt, messages: next }),
    async compactContext(next: Pick<Context, "systemPrompt" | "messages">, summary: unknown) {
      await flush();
      if (compacting)
        throw fail(new Error("Concurrent background context compaction is not permitted"));
      compacting = true;
      try {
        const serialized = JSON.stringify({
          systemPrompt: next.systemPrompt,
          messages: next.messages.map((message) =>
            message.role === "toolResult" ? backgroundReceipt(message) : message,
          ),
        });
        if (byteLength(serialized) > CONTEXT_BYTES)
          throw new Error("Compacted context exceeds the checkpoint limit");
        const snapshot = JSON.parse(serialized);
        const saved = await backend.compactBackgroundContext(
          executionId,
          revision,
          snapshot,
          summary,
          lease,
        );
        if (saved !== revision + 1)
          throw new Error("Background compaction acknowledgement does not match its revision");
        check();
        revision = saved;
        systemPrompt = snapshot.systemPrompt;
        messages.splice(0, messages.length, ...snapshot.messages);
      } catch (error) {
        throw fail(error);
      } finally {
        compacting = false;
      }
    },
    flush,
    async settle() {
      // Cancellation stops new calls, but a sibling already handed to a native
      // port can still return a receipt. Retain it before the host parks/revokes
      // this lease; never infer that abort rolled back the remote submission.
      await Promise.allSettled([...calls.values()].map((call) => call.result));
      await queue;
    },
    throwIfFailed: check,
    execute(
      call: ToolCall,
      signal: AbortSignal | undefined,
      execute: () => Promise<Message>,
    ): Promise<Message> {
      let binding: string;
      try {
        check();
        binding = JSON.stringify({ name: call.name, arguments: call.arguments });
      } catch (error) {
        return Promise.reject(fail(error));
      }
      const previous = calls.get(call.id);
      if (previous) {
        if (previous.binding !== binding)
          return Promise.reject(fail(new Error("Tool call ID was reused for different arguments")));
        return previous.result;
      }
      const result = invokeOperation(call, signal, execute);
      calls.set(call.id, { binding, result });
      return result;
    },
    dispose() {
      parentSignal.removeEventListener("abort", abort);
    },
  };
}
