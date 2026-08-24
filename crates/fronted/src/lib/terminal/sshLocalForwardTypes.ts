export type SshLocalForwardStatus = "active" | "stopped" | "failed";

export type SshLocalForwardRecord = {
  id: string;
  sessionId: string;
  projectPathKey: string;
  localHost: string;
  localPort: number;
  address: string;
  remoteHost: string;
  remotePort: number;
  status: SshLocalForwardStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
};

export type SshLocalForwardSnapshot = {
  forwards: SshLocalForwardRecord[];
  revision: number;
};

export type SshLocalForwardAction = {
  forward: SshLocalForwardRecord;
  revision: number;
};

export type SshLocalForwardEvent = SshLocalForwardAction & {
  kind: "started" | "stopped" | "failed";
};

export type RawSshLocalForwardSnapshot = unknown;
export type RawSshLocalForwardAction = unknown;
export type RawSshLocalForwardEvent = unknown;

export type SshLocalForwardClient = {
  list: (params?: {
    sessionId?: string;
    projectPathKey?: string;
  }) => Promise<SshLocalForwardSnapshot>;
  start: (params: {
    sessionId: string;
    projectPathKey?: string;
    remoteHost: string;
    remotePort: number;
    localPort?: number;
  }) => Promise<SshLocalForwardAction>;
  stop: (params: { forwardId: string; sessionId?: string }) => Promise<SshLocalForwardAction>;
  checkLocalPort: (port: number) => Promise<boolean>;
  subscribe: (listener: (event: SshLocalForwardEvent) => void) => Promise<() => void>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringField(value: Record<string, unknown>, camel: string, snake: string) {
  const found = value[camel] ?? value[snake];
  return typeof found === "string" ? found : "";
}

function numberField(value: Record<string, unknown>, camel: string, snake: string) {
  const found = value[camel] ?? value[snake];
  return typeof found === "number" && Number.isFinite(found) ? found : 0;
}

function normalizeForward(value: unknown): SshLocalForwardRecord {
  const raw = record(value);
  const status = stringField(raw, "status", "status");
  return {
    id: stringField(raw, "id", "id"),
    sessionId: stringField(raw, "sessionId", "session_id"),
    projectPathKey: stringField(raw, "projectPathKey", "project_path_key"),
    localHost: stringField(raw, "localHost", "local_host") || "127.0.0.1",
    localPort: numberField(raw, "localPort", "local_port"),
    address: stringField(raw, "address", "address"),
    remoteHost: stringField(raw, "remoteHost", "remote_host"),
    remotePort: numberField(raw, "remotePort", "remote_port"),
    status: status === "stopped" || status === "failed" ? status : "active",
    createdAt: numberField(raw, "createdAt", "created_at"),
    updatedAt: numberField(raw, "updatedAt", "updated_at"),
    ...(stringField(raw, "error", "error") ? { error: stringField(raw, "error", "error") } : {}),
  };
}

export function normalizeSshLocalForwardSnapshot(value: unknown): SshLocalForwardSnapshot {
  const raw = record(value);
  return {
    forwards: Array.isArray(raw.forwards) ? raw.forwards.map(normalizeForward) : [],
    revision: numberField(raw, "revision", "revision"),
  };
}

export function normalizeSshLocalForwardAction(value: unknown): SshLocalForwardAction {
  const raw = record(value);
  return {
    forward: normalizeForward(raw.forward),
    revision: numberField(raw, "revision", "revision"),
  };
}

export function normalizeSshLocalForwardEvent(value: unknown): SshLocalForwardEvent {
  const raw = record(value);
  const action = normalizeSshLocalForwardAction(raw);
  const kind = stringField(raw, "kind", "kind");
  return {
    ...action,
    kind: kind === "stopped" || kind === "failed" ? kind : "started",
  };
}
