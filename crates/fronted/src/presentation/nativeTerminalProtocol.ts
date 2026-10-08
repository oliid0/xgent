import type { TerminalStreamChunk, TerminalStreamSnapshot } from "../lib/terminal/types";

export const NATIVE_TERMINAL_OUTPUT_BYTES = 256 * 1024;
const MAX_INPUT_BYTES = 16 * 1024;

export type NativeTerminalEvent =
  | { sessionId: string; type: "input"; bytes: Uint8Array }
  | { sessionId: string; type: "resize"; cols: number; rows: number };

export function terminalBytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function parseNativeTerminalEvent(value: unknown): NativeTerminalEvent | null {
  if (typeof value !== "string" || value.length > 24 * 1024) return null;
  try {
    const event = JSON.parse(value);
    if (
      !event ||
      typeof event !== "object" ||
      typeof event.sessionId !== "string" ||
      !event.sessionId
    )
      return null;
    if (event.type === "resize") {
      if (
        Object.keys(event).some((key) => !["sessionId", "type", "cols", "rows"].includes(key)) ||
        !Number.isInteger(event.cols) ||
        event.cols < 2 ||
        event.cols > 400 ||
        !Number.isInteger(event.rows) ||
        event.rows < 1 ||
        event.rows > 200
      )
        return null;
      return { sessionId: event.sessionId, type: "resize", cols: event.cols, rows: event.rows };
    }
    if (
      event.type !== "input" ||
      typeof event.bytes !== "string" ||
      Object.keys(event).some((key) => !["sessionId", "type", "bytes"].includes(key)) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.bytes)
    )
      return null;
    const binary = atob(event.bytes);
    if (!binary.length || binary.length > MAX_INPUT_BYTES) return null;
    return {
      sessionId: event.sessionId,
      type: "input",
      bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    };
  } catch {
    return null;
  }
}

/** Offset-based replay lets native views consume each byte once across document updates. */
export class NativeTerminalOutputBuffer {
  readonly sessionId: string;
  private bytes: Uint8Array;
  private startOffset: number;
  private endOffset: number;
  private encodedBytes: string | null = null;

  constructor(snapshot: TerminalStreamSnapshot) {
    this.sessionId = snapshot.session.id;
    if (
      !Number.isSafeInteger(snapshot.outputStartOffset) ||
      snapshot.outputStartOffset < 0 ||
      !Number.isSafeInteger(snapshot.outputEndOffset) ||
      snapshot.outputEndOffset - snapshot.outputStartOffset !== snapshot.bytes.length
    ) {
      throw new Error("Invalid terminal snapshot offsets.");
    }
    this.bytes = snapshot.bytes.slice(-NATIVE_TERMINAL_OUTPUT_BYTES);
    this.endOffset = snapshot.outputEndOffset;
    this.startOffset = this.endOffset - this.bytes.length;
  }

  append(chunk: TerminalStreamChunk) {
    if (chunk.sessionId !== this.sessionId) return false;
    if (
      !Number.isSafeInteger(chunk.startOffset) ||
      !Number.isSafeInteger(chunk.endOffset) ||
      chunk.startOffset < 0 ||
      chunk.endOffset - chunk.startOffset !== chunk.bytes.length
    )
      throw new Error("Invalid terminal stream offsets.");
    if (chunk.endOffset <= this.endOffset) return false;
    if (chunk.startOffset > this.endOffset)
      throw new Error("Terminal output interrupted; reconnect to restore it.");
    const incoming = chunk.bytes.subarray(this.endOffset - chunk.startOffset);
    const retain = Math.min(this.bytes.length, NATIVE_TERMINAL_OUTPUT_BYTES - incoming.length);
    if (retain <= 0) {
      this.bytes = incoming.slice(-NATIVE_TERMINAL_OUTPUT_BYTES);
    } else {
      const next = new Uint8Array(retain + incoming.length);
      next.set(this.bytes.subarray(this.bytes.length - retain));
      next.set(incoming, retain);
      this.bytes = next;
    }
    this.endOffset = chunk.endOffset;
    this.startOffset = this.endOffset - this.bytes.length;
    this.encodedBytes = null;
    return true;
  }

  packet(enabled: boolean, generation: number) {
    this.encodedBytes ??= terminalBytesToBase64(this.bytes);
    return JSON.stringify({
      sessionId: this.sessionId,
      generation,
      startOffset: this.startOffset,
      endOffset: this.endOffset,
      bytes: this.encodedBytes,
      enabled,
    });
  }
}
