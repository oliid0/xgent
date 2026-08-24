import type {
  SshTerminalTab,
  SshTerminalTabsSnapshot,
  TerminalEvent,
  TerminalSession,
  TerminalShellOption,
  TerminalShellOptions,
  TerminalSnapshot,
  TerminalSshCreateResult,
  TerminalSshLatency,
  TerminalSshMetadata,
  TerminalSshPrompt,
} from "./types";

type RawTerminalSshMetadata = Partial<TerminalSshMetadata> & {
  host_id?: string;
  host_name?: string;
  auth_type?: string;
  reconnect_attempt?: number;
  reconnect_max_attempts?: number;
  sftp_enabled?: boolean;
};

type RawTerminalSshPrompt = Partial<TerminalSshPrompt> & {
  host_id?: string;
  host_name?: string;
  fingerprint_sha256?: string;
  key_type?: string;
  answer_echo?: boolean;
};

export type RawTerminalSession = Partial<TerminalSession> & {
  project_path_key?: string;
  created_at?: number;
  updated_at?: number;
  finished_at?: number | null;
  exit_code?: number | null;
  kind?: string;
  ssh?: RawTerminalSshMetadata | null;
};

export type RawTerminalSnapshot = {
  session?: RawTerminalSession;
  output?: string;
  outputBytes?: unknown;
  output_bytes?: unknown;
  truncated?: boolean;
  outputStartOffset?: number;
  output_start_offset?: number;
  outputEndOffset?: number;
  output_end_offset?: number;
  sshPrompt?: RawTerminalSshPrompt | null;
  ssh_prompt?: RawTerminalSshPrompt | null;
};

export type RawTerminalSshLatency = Partial<TerminalSshLatency> & {
  session_id?: string;
  latency_ms?: number;
};

type RawSshTerminalTab = Partial<SshTerminalTab> & {
  session_id?: string;
  project_path_key?: string;
  created_at?: number;
  updated_at?: number;
};

export type RawSshTerminalTabsSnapshot = Partial<SshTerminalTabsSnapshot> & {
  project_path_key?: string;
  tabs?: RawSshTerminalTab[];
};

type RawTerminalShellOption = Partial<TerminalShellOption>;

export type RawTerminalShellOptionsResponse = {
  options?: RawTerminalShellOption[];
  defaultShell?: string;
  default_shell?: string;
};

export type RawTerminalEvent = {
  kind?: string;
  sessionId?: string;
  session_id?: string;
  projectPathKey?: string;
  project_path_key?: string;
  session?: RawTerminalSession;
  sshTabs?: RawSshTerminalTabsSnapshot | null;
  ssh_tabs?: RawSshTerminalTabsSnapshot | null;
  outputStartOffset?: number;
  output_start_offset?: number;
  outputEndOffset?: number;
  output_end_offset?: number;
};

export function normalizeOptionalOffset(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

export function normalizeTerminalByteContainer(
  value: unknown,
  encodeText: (text: string) => Uint8Array = (text) => new TextEncoder().encode(text),
): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value.map((item) => Number(item) & 0xff));
  if (typeof value === "string" && value.length > 0) return encodeText(value);
  return new Uint8Array();
}

function normalizeSshMetadata(input: RawTerminalSshMetadata): TerminalSshMetadata {
  return {
    hostId: input.hostId ?? input.host_id ?? "",
    hostName: input.hostName ?? input.host_name ?? "",
    username: input.username ?? "",
    host: input.host ?? "",
    port: Number(input.port ?? 22),
    authType: input.authType ?? input.auth_type ?? "",
    status: input.status ?? "connected",
    reconnectAttempt: Number(input.reconnectAttempt ?? input.reconnect_attempt ?? 0),
    reconnectMaxAttempts: Number(input.reconnectMaxAttempts ?? input.reconnect_max_attempts ?? 3),
    sftpEnabled: input.sftpEnabled ?? input.sftp_enabled ?? false,
  };
}

export function normalizeTerminalSession(input: RawTerminalSession): TerminalSession {
  const kind = input.kind === "ssh" ? "ssh" : "local";
  return {
    id: input.id ?? "",
    projectPathKey: input.projectPathKey ?? input.project_path_key ?? "",
    cwd: input.cwd ?? "",
    shell: input.shell ?? "",
    title: input.title ?? "Terminal",
    kind,
    ssh: input.ssh ? normalizeSshMetadata(input.ssh) : null,
    pid: kind === "ssh" ? null : (input.pid ?? null),
    cols: Number(input.cols ?? 80),
    rows: Number(input.rows ?? 24),
    createdAt: Number(input.createdAt ?? input.created_at ?? 0),
    updatedAt: Number(input.updatedAt ?? input.updated_at ?? 0),
    finishedAt: input.finishedAt ?? input.finished_at ?? null,
    exitCode: input.exitCode ?? input.exit_code ?? null,
    running: input.running === true,
  };
}

function normalizeSshPrompt(input: RawTerminalSshPrompt | null | undefined) {
  if (!input) return undefined;
  const id = input.id?.trim() ?? "";
  if (!id) return undefined;
  return {
    id,
    kind: input.kind ?? "hostKey",
    hostId: input.hostId ?? input.host_id ?? "",
    hostName: input.hostName ?? input.host_name ?? "",
    host: input.host ?? "",
    port: Number(input.port ?? 22),
    message: input.message ?? "",
    fingerprintSha256: input.fingerprintSha256 ?? input.fingerprint_sha256 ?? undefined,
    keyType: input.keyType ?? input.key_type ?? undefined,
    answerEcho: input.answerEcho ?? input.answer_echo ?? false,
  } satisfies TerminalSshPrompt;
}

export function normalizeTerminalSnapshot(
  input: RawTerminalSnapshot,
  normalizeBytes = normalizeTerminalByteContainer,
): TerminalSnapshot {
  if (!input.session) throw new Error("Terminal response did not include a session");
  return {
    session: normalizeTerminalSession(input.session),
    output: input.output ?? "",
    outputBytes: normalizeBytes(input.outputBytes ?? input.output_bytes),
    truncated: input.truncated === true,
    outputStartOffset: normalizeOptionalOffset(input.outputStartOffset ?? input.output_start_offset),
    outputEndOffset: normalizeOptionalOffset(input.outputEndOffset ?? input.output_end_offset),
  };
}

export function normalizeTerminalSshCreateResult(
  input: RawTerminalSnapshot,
  normalizeBytes = normalizeTerminalByteContainer,
): TerminalSshCreateResult {
  return {
    snapshot: input.session ? normalizeTerminalSnapshot(input, normalizeBytes) : undefined,
    prompt: normalizeSshPrompt(input.sshPrompt ?? input.ssh_prompt),
  };
}

export function normalizeTerminalSshLatency(input: RawTerminalSshLatency): TerminalSshLatency {
  const latencyMs = Number(input.latencyMs ?? input.latency_ms ?? 0);
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) {
    throw new Error("SSH latency response did not include latency");
  }
  return { sessionId: input.sessionId ?? input.session_id ?? "", latencyMs: Math.round(latencyMs) };
}

export function normalizeTerminalShellOptions(
  input: RawTerminalShellOptionsResponse,
): TerminalShellOptions {
  const options = (input.options ?? [])
    .map((option) => ({
      id: option.id?.trim() ?? "",
      label: option.label?.trim() ?? "",
      command: option.command?.trim() ?? "",
    }))
    .filter((option) => option.id && option.label);
  return {
    options,
    defaultShell: input.defaultShell ?? input.default_shell ?? options[0]?.id ?? "default",
  };
}

function normalizeSshTerminalTab(input: RawSshTerminalTab): SshTerminalTab {
  return {
    id: input.id ?? "",
    sessionId: input.sessionId ?? input.session_id ?? "",
    projectPathKey: input.projectPathKey ?? input.project_path_key ?? "",
    kind: input.kind === "sftp" ? "sftp" : "bash",
    createdAt: Number(input.createdAt ?? input.created_at ?? 0),
    updatedAt: Number(input.updatedAt ?? input.updated_at ?? 0),
  };
}

export function normalizeSshTerminalTabsSnapshot(
  input: RawSshTerminalTabsSnapshot | null | undefined,
): SshTerminalTabsSnapshot {
  return {
    projectPathKey: input?.projectPathKey ?? input?.project_path_key ?? "",
    tabs: (input?.tabs ?? []).map(normalizeSshTerminalTab).filter((tab) => tab.id && tab.sessionId),
    revision: Number(input?.revision ?? 0),
  };
}

export function normalizeTerminalEvent(input: RawTerminalEvent): TerminalEvent | null {
  if (!input.session && !input.sshTabs && !input.ssh_tabs) return null;
  const session = input.session ? normalizeTerminalSession(input.session) : undefined;
  const sshTabs = normalizeSshTerminalTabsSnapshot(input.sshTabs ?? input.ssh_tabs);
  return {
    kind: input.kind ?? "",
    sessionId: input.sessionId ?? input.session_id ?? session?.id,
    projectPathKey:
      input.projectPathKey ??
      input.project_path_key ??
      session?.projectPathKey ??
      sshTabs.projectPathKey,
    session,
    outputStartOffset: normalizeOptionalOffset(input.outputStartOffset ?? input.output_start_offset),
    outputEndOffset: normalizeOptionalOffset(input.outputEndOffset ?? input.output_end_offset),
    sshTabs: input.sshTabs || input.ssh_tabs ? sshTabs : undefined,
  };
}

export function buildTerminalCreatePayload(params: {
  cwd: string;
  projectPathKey: string;
  shell?: string;
  title?: string;
  cols?: number;
  rows?: number;
}) {
  return {
    cwd: params.cwd,
    project_path_key: params.projectPathKey,
    shell: params.shell,
    title: params.title,
    cols: params.cols,
    rows: params.rows,
  };
}

export function buildTerminalSshCreatePayload(params: {
  cwd: string;
  projectPathKey: string;
  hostId: string;
  title?: string;
  cols?: number;
  rows?: number;
  sftpEnabled?: boolean;
}) {
  return {
    cwd: params.cwd,
    project_path_key: params.projectPathKey,
    ssh_host_id: params.hostId,
    title: params.title,
    cols: params.cols,
    rows: params.rows,
    sftp_enabled: params.sftpEnabled ?? false,
  };
}

export function buildTerminalSshPromptAnswerPayload(params: {
  promptId: string;
  answer?: string;
  trustHostKey?: boolean;
}) {
  return {
    prompt_id: params.promptId,
    prompt_answer: params.answer,
    trust_host_key: params.trustHostKey,
  };
}
