import type { ToolCall } from "@earendil-works/pi-ai";
import { backgroundRequestId } from "./backgroundTaskIdentity";
import type { BackgroundResumeReceipt, ResumeBackgroundTaskInput } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Unknown routing cannot prove which device accepted a response. */
export function backgroundResumeBinding(call: ToolCall, requestScope: string | undefined) {
  const args = call.arguments as Record<string, unknown> | undefined;
  if (
    call.name !== "BackgroundTask" ||
    args?.action !== "resume" ||
    !requestScope ||
    typeof args.peer_id !== "string" ||
    !uuid.test(args.peer_id.trim()) ||
    typeof args.request_id !== "string" ||
    !uuid.test(args.request_id.trim()) ||
    typeof args.wait_id !== "string" ||
    !uuid.test(args.wait_id) ||
    typeof args.response !== "string" ||
    !args.response.trim() ||
    new TextEncoder().encode(args.response).length > 32 * 1024
  )
    return null;
  return {
    peerId: args.peer_id.trim(),
    input: {
      requestId: args.request_id.trim(),
      waitId: args.wait_id,
      resumeId: backgroundRequestId(call.id, requestScope),
      response: args.response,
    } satisfies ResumeBackgroundTaskInput,
  };
}

/** This proves acceptance of this response, never completion of child work. */
export function verifyBackgroundResumeReceipt(
  value: unknown,
  binding: NonNullable<ReturnType<typeof backgroundResumeBinding>>,
): BackgroundResumeReceipt {
  const receipt = value as Partial<BackgroundResumeReceipt> | null;
  if (
    !receipt ||
    receipt.version !== 1 ||
    receipt.hostId !== binding.peerId ||
    typeof receipt.executionId !== "string" ||
    !uuid.test(receipt.executionId) ||
    !Number.isSafeInteger(receipt.acceptedAt) ||
    (receipt.acceptedAt ?? -1) < 0 ||
    !receipt.input ||
    receipt.input.requestId !== binding.input.requestId ||
    receipt.input.waitId !== binding.input.waitId ||
    receipt.input.resumeId !== binding.input.resumeId ||
    receipt.input.response !== binding.input.response ||
    Object.keys(receipt.input).length !== 4
  )
    throw new Error("Native resume receipt does not match the original device, task and response");
  return {
    version: 1,
    hostId: receipt.hostId,
    executionId: receipt.executionId,
    acceptedAt: receipt.acceptedAt!,
    input: { ...binding.input },
  };
}
