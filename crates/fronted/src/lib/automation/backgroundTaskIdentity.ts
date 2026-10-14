import { sha256Hex } from "../trajectory/sha256";

/** Stable across retries of the exact scoped, persisted tool call. */
export function backgroundRequestId(toolCallId: string, requestScope?: string) {
  const identity = requestScope ? JSON.stringify([requestScope, toolCallId]) : toolCallId;
  const hash = sha256Hex(`xgent-background:${identity}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
