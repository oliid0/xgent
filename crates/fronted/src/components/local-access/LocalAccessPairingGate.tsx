import { isBrowserRuntime } from "@xagent/runtime";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import {
  LOCAL_ACCESS_CSRF_KEY,
  LOCAL_ACCESS_SESSION_CHANGED_EVENT,
} from "../../runtime/browser";

type SessionResponse = {
  authenticated?: boolean;
  csrfToken?: string;
  error?: string;
};

async function readJson(response: Response): Promise<SessionResponse> {
  try {
    return (await response.json()) as SessionResponse;
  } catch {
    return {};
  }
}

export function LocalAccessPairingGate({ children }: { children: ReactNode }) {
  const browser = isBrowserRuntime();
  const [state, setState] = useState<"checking" | "pairing" | "ready">(
    browser ? "checking" : "ready",
  );
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => navigator.userAgent.slice(0, 64));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const checkSession = useCallback(async () => {
    if (!browser) return;
    try {
      const response = await fetch("/api/local-access/session", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = await readJson(response);
      if (!response.ok || payload.authenticated !== true || !payload.csrfToken) {
        sessionStorage.removeItem(LOCAL_ACCESS_CSRF_KEY);
        setState("pairing");
        return;
      }
      sessionStorage.setItem(LOCAL_ACCESS_CSRF_KEY, payload.csrfToken);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState("pairing");
    }
  }, [browser]);

  useEffect(() => {
    void checkSession();
    const refresh = () => void checkSession();
    window.addEventListener(LOCAL_ACCESS_SESSION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(LOCAL_ACCESS_SESSION_CHANGED_EVENT, refresh);
  }, [checkSession]);

  async function pair(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/local-access/pair", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), deviceName: deviceName.trim() }),
      });
      const payload = await readJson(response);
      if (!response.ok || !payload.csrfToken) {
        throw new Error(payload.error || `Pairing failed with HTTP ${response.status}`);
      }
      sessionStorage.setItem(LOCAL_ACCESS_CSRF_KEY, payload.csrfToken);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!browser || state === "ready") return children;
  if (state === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        正在验证设备…
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <form
        onSubmit={pair}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div>
          <h1 className="text-lg font-semibold">连接到 XAgent</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            输入电脑端“本地访问与移动端”设置中显示的六位配对码。
          </p>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span>设备名称</span>
          <input
            value={deviceName}
            maxLength={64}
            onChange={(event) => setDeviceName(event.currentTarget.value)}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span>配对码</span>
          <input
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, ""))}
            className="h-12 w-full rounded-lg border border-border bg-background px-3 text-center text-2xl tracking-[0.35em] outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || code.length !== 6 || !deviceName.trim()}
          className="h-10 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "正在连接…" : "连接"}
        </button>
      </form>
    </main>
  );
}
