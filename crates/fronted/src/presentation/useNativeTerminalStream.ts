import { useEffect, useRef, useState } from "react";
import type { TerminalClient, TerminalSession, TerminalStreamHandle } from "../lib/terminal/types";
import {
  NATIVE_TERMINAL_OUTPUT_BYTES,
  NativeTerminalOutputBuffer,
  parseNativeTerminalEvent,
} from "./nativeTerminalProtocol";

export function useNativeTerminalStream(
  client: TerminalClient,
  session: TerminalSession | null,
  open: boolean,
) {
  const [outputState, setOutputState] = useState({ sessionId: "", packet: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef<{
    sessionId: string;
    handle: TerminalStreamHandle;
    enabled: boolean;
  } | null>(null);
  const generation = useRef(0);
  const scope = useRef({ open, sessionId: session?.id });
  const previous = useRef({ open, sessionId: session?.id });
  if (previous.current.open !== open || previous.current.sessionId !== session?.id) {
    previous.current = { open, sessionId: session?.id };
    scope.current = { open, sessionId: session?.id };
  }
  const running = useRef(session?.running === true);
  running.current = session?.running === true;

  useEffect(() => {
    let disposed = false;
    let handle: TerminalStreamHandle | null = null;
    let unsubscribeOutput: (() => void) | undefined;
    let unsubscribeInput: (() => void) | undefined;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const currentGeneration = ++generation.current;
    active.current = null;
    setOutputState({ sessionId: "", packet: "" });
    setError("");
    setLoading(open && Boolean(session));
    const current = () =>
      !disposed && scope.current.open && scope.current.sessionId === session?.id;
    if (open && session) {
      void client.stream
        .attach(session, { maxBytes: NATIVE_TERMINAL_OUTPUT_BYTES })
        .then((attached) => {
          if (!current()) {
            attached.dispose();
            return;
          }
          handle = attached;
          const output = new NativeTerminalOutputBuffer(attached.snapshot);
          let paused = false;
          const publish = () => {
            if (publishTimer !== undefined) clearTimeout(publishTimer);
            publishTimer = undefined;
            if (!current() || active.current?.handle !== attached) return;
            active.current.enabled = !paused && running.current;
            setOutputState({
              sessionId: session.id,
              packet: output.packet(active.current.enabled, currentGeneration),
            });
          };
          active.current = { sessionId: session.id, handle: attached, enabled: running.current };
          publish();
          unsubscribeInput = attached.subscribeInputState((state) => {
            if (!current() || active.current?.handle !== attached) return;
            paused = state.paused;
            setError(paused ? `Terminal input paused (${state.reason ?? "slow"}).` : "");
            publish();
          });
          unsubscribeOutput = attached.subscribeOutput((chunk) => {
            if (!current() || active.current?.handle !== attached) return;
            try {
              if (output.append(chunk) && publishTimer === undefined)
                publishTimer = setTimeout(publish, 16);
            } catch (failure) {
              if (publishTimer !== undefined) clearTimeout(publishTimer);
              publishTimer = undefined;
              active.current = null;
              setOutputState({
                sessionId: session.id,
                packet: output.packet(false, currentGeneration),
              });
              setError(failure instanceof Error ? failure.message : String(failure));
              attached.dispose();
            }
          });
        })
        .catch((failure: unknown) => {
          if (current()) {
            active.current = null;
            handle?.dispose();
            setError(failure instanceof Error ? failure.message : String(failure));
          }
        })
        .finally(() => {
          if (current()) setLoading(false);
        });
    }
    return () => {
      disposed = true;
      if (active.current?.handle === handle) active.current = null;
      if (publishTimer !== undefined) clearTimeout(publishTimer);
      unsubscribeOutput?.();
      unsubscribeInput?.();
      handle?.dispose();
    };
  }, [client, session?.id, session?.running, open, retry]);

  const dispatch = (value: unknown) => {
    const event = parseNativeTerminalEvent(value);
    const target = active.current;
    if (
      !event ||
      !target ||
      !scope.current.open ||
      event.sessionId !== scope.current.sessionId ||
      event.sessionId !== target.sessionId
    ) {
      throw new Error("This terminal session is no longer available.");
    }
    if (event.type === "resize") target.handle.resize(event.cols, event.rows);
    else if (!target.enabled || !running.current || !target.handle.write(event.bytes)) {
      throw new Error("Terminal input is paused or the session has ended.");
    }
  };
  return {
    packet: open && outputState.sessionId === session?.id ? outputState.packet : "",
    error,
    loading,
    dispatch,
    retire: () => {
      scope.current.open = false;
      active.current?.handle.dispose();
      active.current = null;
    },
    accepts: (value: unknown) => {
      const event = parseNativeTerminalEvent(value);
      return Boolean(event && session && event.sessionId === session.id);
    },
    reconnect: () => setRetry((value) => value + 1),
  };
}
