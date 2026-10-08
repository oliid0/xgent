import { useEffect, useState } from "react";
import { tauriTerminalClient } from "./tauriTerminalClient";
import type { TerminalShellOption } from "./types";

type ShellDiscovery = {
  status: "loading" | "ready" | "error";
  options: TerminalShellOption[];
  error?: string;
};

/** Both settings renderers retain discovery failures and offer the same retry. */
export function useTerminalShellDiscovery(enabled: boolean) {
  const [shell, setShell] = useState<ShellDiscovery>({ status: "loading", options: [] });
  const [request] = useState(() => ({ active: enabled, revision: 0 }));

  async function refresh() {
    if (!request.active) return;
    const revision = ++request.revision;
    setShell({ status: "loading", options: [] });
    try {
      const result = await tauriTerminalClient.shellOptions();
      if (request.active && request.revision === revision) {
        setShell({ status: "ready", options: result.options });
      }
    } catch (cause) {
      if (request.active && request.revision === revision) {
        setShell({
          status: "error",
          options: [],
          error: cause instanceof Error ? cause.message : String(cause),
        });
        throw cause;
      }
    }
  }

  useEffect(() => {
    request.active = enabled;
    if (enabled) void refresh().catch(() => undefined);
    return () => {
      request.active = false;
      request.revision++;
    };
  }, [enabled]);

  return { shell, refresh };
}
