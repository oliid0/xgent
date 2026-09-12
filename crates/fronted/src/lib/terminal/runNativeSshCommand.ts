import { invoke } from "@xgent/runtime";
import { tauriTerminalClient } from "./tauriTerminalClient";
import type { TerminalSshPrompt } from "./types";

/** Desktop SSH uses the existing authenticated session registry, including trust prompts. */
export async function runNativeSshCommand<T>(params: {
  hostId: string;
  workdir: string;
  projectPathKey: string;
  command: string;
  runId: string;
  signal: AbortSignal;
  prompt: (prompt: TerminalSshPrompt) => Promise<{ answer?: string; trustHostKey?: boolean }>;
}): Promise<T> {
  let sessionId: string | undefined;
  let promptId: string | undefined;
  const cancel = () => {
    if (promptId) void tauriTerminalClient.cancelSshPrompt(promptId).catch(() => undefined);
    void invoke("shell_cancel", { run_id: params.runId }).catch(() => undefined);
  };
  params.signal.throwIfAborted();
  params.signal.addEventListener("abort", cancel, { once: true });
  try {
    let result = await tauriTerminalClient.createSsh({
      cwd: params.workdir,
      projectPathKey: params.projectPathKey,
      hostId: params.hostId,
      sftpEnabled: false,
    });
    while (true) {
      sessionId = result.snapshot?.session.id;
      promptId = result.prompt?.id;
      params.signal.throwIfAborted();
      if (!result.prompt) break;
      const answer = await params.prompt(result.prompt);
      params.signal.throwIfAborted();
      result = await tauriTerminalClient.answerSshPrompt({ promptId: result.prompt.id, ...answer });
    }
    if (!sessionId) throw new Error("SSH session was not created.");
    return await invoke<T>("terminal_ssh_exec", {
      session_id: sessionId,
      command: params.command,
      timeout_ms: 300_000,
      run_id: params.runId,
    });
  } finally {
    params.signal.removeEventListener("abort", cancel);
    if (promptId) await tauriTerminalClient.cancelSshPrompt(promptId).catch(() => undefined);
    if (sessionId) await tauriTerminalClient.close(sessionId).catch(() => undefined);
  }
}
