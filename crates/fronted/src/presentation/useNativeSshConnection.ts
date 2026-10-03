import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalClient, TerminalSnapshot, TerminalSshPrompt } from "../lib/terminal/types";

type SshAnswer = { answer?: string; trustHostKey?: boolean };

/** Uses the same host-key and authentication exchange as the desktop SSH registry. */
export function useNativeSshConnection(client: TerminalClient, scopeKey: string, open: boolean) {
  const [prompt, setPrompt] = useState<TerminalSshPrompt | null>(null);
  const [answer, setAnswerState] = useState("");
  const answerRef = useRef("");
  const setAnswer = useCallback((value: string) => {
    answerRef.current = value;
    setAnswerState(value);
  }, []);
  const [connecting, setConnecting] = useState(false);
  const [answering, setAnswering] = useState(false);
  const scope = useRef({ key: scopeKey, open, revision: 0 });
  const previous = useRef({ key: scopeKey, open });
  if (previous.current.key !== scopeKey || previous.current.open !== open) {
    previous.current = { key: scopeKey, open };
    scope.current = { key: scopeKey, open, revision: scope.current.revision + 1 };
  }
  const revision = scope.current.revision;
  const isCurrentScope = () =>
    scope.current.open && scope.current.key === scopeKey && scope.current.revision === revision;
  const sequence = useRef(0);
  const active = useRef(false);
  const pending = useRef<{
    id: string;
    submitted: boolean;
    resolve: (answer: SshAnswer | null) => void;
  } | null>(null);

  const retire = useCallback(() => {
    sequence.current += 1;
    active.current = false;
    setAnswer("");
    const waiting = pending.current;
    pending.current = null;
    waiting?.resolve(null);
    if (waiting)
      void client.cancelSshPrompt(waiting.id).catch((error: unknown) => {
        console.error("SSH prompt cancellation failed", error);
      });
  }, [client, setAnswer]);
  useEffect(() => {
    scope.current.open = open;
    setPrompt(null);
    setAnswer("");
    setConnecting(false);
    setAnswering(false);
    return () => {
      scope.current.open = false;
      retire();
    };
  }, [scopeKey, open, retire, setAnswer]);

  const connect = async (
    params: Parameters<TerminalClient["createSsh"]>[0],
  ): Promise<TerminalSnapshot | null> => {
    if (active.current || !isCurrentScope()) return null;
    const token = ++sequence.current;
    const current = () => isCurrentScope() && sequence.current === token;
    active.current = true;
    setConnecting(true);
    try {
      let result = await client.createSsh(params);
      while (true) {
        if (!current()) {
          if (result.prompt) await client.cancelSshPrompt(result.prompt.id);
          if (result.snapshot)
            await client.close(result.snapshot.session.id, result.snapshot.session.projectPathKey);
          return null;
        }
        if (result.snapshot) return result.snapshot;
        if (!result.prompt)
          throw new Error("SSH connection did not return a session or authentication prompt.");
        const question = result.prompt;
        setPrompt(question);
        setAnswer("");
        setAnswering(false);
        const response = await new Promise<SshAnswer | null>((resolve) => {
          pending.current = { id: question.id, submitted: false, resolve };
        });
        if (!response || !current()) return null;
        setAnswering(true);
        result = await client.answerSshPrompt({ promptId: question.id, ...response });
        if (pending.current?.id === question.id) pending.current = null;
      }
    } finally {
      if (sequence.current === token) {
        active.current = false;
        const waiting = pending.current;
        pending.current = null;
        if (waiting)
          void client.cancelSshPrompt(waiting.id).catch((error: unknown) => {
            console.error("SSH prompt cleanup failed", error);
          });
        setPrompt(null);
        setAnswer("");
        setConnecting(false);
        setAnswering(false);
      }
    }
  };

  return {
    prompt,
    answer,
    setAnswer: (value: string) => {
      if (isCurrentScope() && pending.current && !pending.current.submitted) setAnswer(value);
    },
    connecting,
    answering,
    connect,
    submit: () => {
      const waiting = pending.current;
      if (!isCurrentScope() || !prompt || !waiting || waiting.id !== prompt.id || waiting.submitted)
        return;
      const response = answerRef.current;
      waiting.submitted = true;
      // Retire the UI answer immediately, including saved passwords/passphrases.
      setAnswer("");
      setAnswering(true);
      waiting.resolve(prompt.kind === "hostKey" ? { trustHostKey: true } : { answer: response });
    },
    cancel: () => {
      if (!isCurrentScope()) return;
      retire();
      setPrompt(null);
      setAnswer("");
      setConnecting(false);
      setAnswering(false);
    },
    retire: () => {
      if (!isCurrentScope()) return;
      scope.current.open = false;
      retire();
    },
  };
}
