import type { SttProviderId, SttSettings } from "../settings";

export type SttSecretField =
  | "apiKey"
  | "secretId"
  | "secretKey"
  | "accessToken"
  | "baiduApiKey";

export type SttConnectionTestResult =
  | "connected"
  | "connected_no_speech"
  | "timeout"
  | "authentication_failed"
  | "network_failed"
  | "protocol_failed";

export type SttConnectionTestResponse = {
  result: SttConnectionTestResult;
  message?: string;
};

export type SttSettingsService = {
  runtimeLabel: string;
  secretRevealMode: "value" | "unsupported";
  revealSecret: (provider: SttProviderId, field: SttSecretField) => Promise<string>;
  get: () => Promise<SttSettings>;
  update: (settings: SttSettings) => Promise<SttSettings>;
  test: (provider: SttProviderId) => Promise<SttConnectionTestResponse>;
};

export type SttRuntimeEvent =
  | { type: "ready"; sessionId: string }
  | { type: "partial"; sessionId: string; text: string }
  | { type: "final"; sessionId: string; text: string }
  | { type: "error"; sessionId: string; code: string; message: string }
  | { type: "closed"; sessionId: string };

export type SttTransportOpenOptions = {
  sessionId: string;
  provider: SttProviderId;
  onEvent: (event: SttRuntimeEvent) => void;
};

export type SttTransport = {
  requestPermission: () => Promise<void>;
  open: (options: SttTransportOpenOptions) => Promise<void>;
  sendAudio: (sessionId: string, sequence: number, pcm: Uint8Array) => Promise<void>;
  stop: (sessionId: string) => Promise<void>;
  cancel: (sessionId: string) => Promise<void>;
  dispose: () => void;
};
