import type {
  TerminalStreamChunk,
  TerminalStreamHandle,
  TerminalStreamInputState,
  TerminalStreamSnapshot,
} from "./types";

const INPUT_FLUSH_BYTES = 4 * 1024;
const INPUT_FLUSH_MS = 8;
const INPUT_HIGH_WATER_BYTES = 256 * 1024;
const INPUT_LOW_WATER_BYTES = 128 * 1024;

type StreamTransport = {
  initialTransportReady?: boolean;
  sendInput(bytes: Uint8Array): Promise<void>;
  sendResize(size: { cols: number; rows: number }): Promise<void>;
  onInputSendError?: (
    error: unknown,
    bytes: Uint8Array,
    buffer: TerminalStreamBuffer,
  ) => void;
};

export class TerminalStreamBuffer implements TerminalStreamHandle {
  private disposed = false;
  private readonly outputListeners = new Set<(chunk: TerminalStreamChunk) => void>();
  private readonly inputStateListeners = new Set<(state: TerminalStreamInputState) => void>();
  private readonly queuedOutput: TerminalStreamChunk[] = [];
  private inputQueue: Uint8Array[] = [];
  private inputBytes = 0;
  private inputTimer: number | null = null;
  private resizeTimer: number | null = null;
  private latestResize: { cols: number; rows: number } | null = null;
  private inputPausedReason: TerminalStreamInputState["reason"] | null = null;

  constructor(
    public snapshot: TerminalStreamSnapshot,
    private readonly transport: StreamTransport,
  ) {
    if (transport.initialTransportReady === false) this.inputPausedReason = "offline";
  }

  accept(chunk: TerminalStreamChunk) {
    if (this.disposed || chunk.sessionId !== this.snapshot.session.id) return;
    if (this.outputListeners.size === 0) {
      this.queuedOutput.push(chunk);
      return;
    }
    for (const listener of this.outputListeners) listener(chunk);
  }

  write(data: Uint8Array) {
    if (this.disposed || data.byteLength === 0 || this.inputPausedReason) return false;
    if (this.inputBytes + data.byteLength > INPUT_HIGH_WATER_BYTES) {
      this.pauseInput("slow");
      if (this.inputBytes > 0) this.flushInput();
      return false;
    }
    this.inputQueue.push(data.slice());
    this.inputBytes += data.byteLength;
    this.emitInputState();
    if (this.inputBytes >= INPUT_FLUSH_BYTES) {
      this.flushInput();
    } else if (this.inputTimer === null) {
      this.inputTimer = window.setTimeout(() => this.flushInput(), INPUT_FLUSH_MS);
    }
    return true;
  }

  resize(cols: number, rows: number) {
    if (this.disposed) return;
    this.latestResize = {
      cols: Math.max(20, Math.min(400, Math.round(cols))),
      rows: Math.max(6, Math.min(200, Math.round(rows))),
    };
    if (this.resizeTimer === null) {
      this.resizeTimer = window.setTimeout(() => this.flushResize(), 16);
    }
  }

  subscribeOutput(listener: (chunk: TerminalStreamChunk) => void) {
    this.outputListeners.add(listener);
    for (const chunk of this.queuedOutput.splice(0)) listener(chunk);
    return () => this.outputListeners.delete(listener);
  }

  subscribeInputState(listener: (state: TerminalStreamInputState) => void) {
    this.inputStateListeners.add(listener);
    listener(this.inputState());
    return () => this.inputStateListeners.delete(listener);
  }

  pauseInput(reason: NonNullable<TerminalStreamInputState["reason"]>) {
    this.inputPausedReason = reason;
    this.emitInputState();
  }

  dispose() {
    if (this.disposed) return;
    this.flushInput();
    this.disposed = true;
    if (this.inputTimer !== null) window.clearTimeout(this.inputTimer);
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.inputTimer = null;
    this.resizeTimer = null;
    this.outputListeners.clear();
    this.inputStateListeners.clear();
    this.queuedOutput.length = 0;
    this.inputPausedReason = "closed";
  }

  private flushInput() {
    if (this.inputTimer !== null) window.clearTimeout(this.inputTimer);
    this.inputTimer = null;
    if (this.inputBytes === 0) {
      this.clearInputPaused();
      return;
    }
    const bytes = new Uint8Array(this.inputBytes);
    let offset = 0;
    for (const chunk of this.inputQueue) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.inputQueue = [];
    this.inputBytes = 0;
    this.emitInputState();
    void this.transport
      .sendInput(bytes)
      .then(() => this.clearInputPaused())
      .catch((error) => {
        this.transport.onInputSendError?.(error, bytes, this);
        if (!this.transport.onInputSendError) this.pauseInput("closed");
      });
  }

  private flushResize() {
    if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
    this.resizeTimer = null;
    const size = this.latestResize;
    this.latestResize = null;
    if (size) void this.transport.sendResize(size).catch(() => undefined);
  }

  private inputState(): TerminalStreamInputState {
    return {
      paused: this.inputPausedReason !== null,
      queuedBytes: this.inputBytes,
      highWaterBytes: INPUT_HIGH_WATER_BYTES,
      reason: this.inputPausedReason ?? undefined,
    };
  }

  private emitInputState() {
    const state = this.inputState();
    for (const listener of this.inputStateListeners) listener(state);
  }

  private clearInputPaused() {
    if (this.inputPausedReason === null || this.inputBytes > INPUT_LOW_WATER_BYTES) return;
    this.inputPausedReason = null;
    this.emitInputState();
  }
}
