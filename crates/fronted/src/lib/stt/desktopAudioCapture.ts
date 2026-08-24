import type { SttProviderId } from "../settings";
import { createUuid } from "../shared/id";
import { desktopSttTransport } from "./desktopSttTransport";
import type { SttRuntimeEvent } from "./types";

export type DesktopSttCapture = {
  sessionId: string;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
};

function pcm16Mono(input: Float32Array, inputRate: number, outputRate = 16_000) {
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const buffer = new ArrayBuffer(outputLength * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      sum += input[sourceIndex] ?? 0;
    }
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export async function startDesktopSttCapture(options: {
  provider: SttProviderId;
  onReady?: () => void;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onClosed: () => void;
}): Promise<DesktopSttCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("当前系统 WebView 不支持麦克风采集。");
  }
  await desktopSttTransport.requestPermission();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  const sessionId = `stt-${createUuid()}`;
  let sequence = 0;
  let settled = false;
  let sendQueue = Promise.resolve();

  const cleanupAudio = () => {
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
      silentGain.disconnect();
    } catch {
      // Nodes may already be disconnected by a provider-close callback.
    }
    for (const track of stream.getTracks()) track.stop();
    void audioContext.close().catch(() => undefined);
  };

  const settle = () => {
    if (settled) return;
    settled = true;
    cleanupAudio();
    options.onClosed();
  };

  const handleEvent = (event: SttRuntimeEvent) => {
    if (event.sessionId !== sessionId) return;
    if (event.type === "ready") options.onReady?.();
    if (event.type === "partial") options.onPartial?.(event.text);
    if (event.type === "final" && event.text.trim()) options.onFinal(event.text.trim());
    if (event.type === "error") {
      options.onError(event.message);
      settle();
    }
    if (event.type === "closed") settle();
  };

  try {
    await desktopSttTransport.open({ sessionId, provider: options.provider, onEvent: handleEvent });
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    processor.onaudioprocess = (event) => {
      if (settled) return;
      const pcm = pcm16Mono(event.inputBuffer.getChannelData(0), audioContext.sampleRate);
      const currentSequence = sequence;
      sequence += 1;
      sendQueue = sendQueue
        .then(() => desktopSttTransport.sendAudio(sessionId, currentSequence, pcm))
        .catch((error) => {
          options.onError(error instanceof Error ? error.message : String(error));
          settle();
        });
    };
  } catch (error) {
    settle();
    throw error;
  }

  return {
    sessionId,
    async stop() {
      if (settled) return;
      cleanupAudio();
      await sendQueue;
      await desktopSttTransport.stop(sessionId);
      window.setTimeout(settle, 3_000);
    },
    async cancel() {
      if (settled) return;
      cleanupAudio();
      try {
        await desktopSttTransport.cancel(sessionId);
      } finally {
        settle();
      }
    },
  };
}
