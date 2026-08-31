import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Theme } from "@astryxdesign/core/theme";
import { isBrowserRuntime } from "@xagent/runtime";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LOCAL_ACCESS_CSRF_KEY, LOCAL_ACCESS_SESSION_CHANGED_EVENT } from "../../runtime/browser";
import { xgentCompactTheme, xgentTheme } from "../../theme/xgentTheme";

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
  const compactViewport = useMediaQuery("(max-width: 768px)");
  const theme = compactViewport ? xgentCompactTheme : xgentTheme;
  const [state, setState] = useState<"checking" | "pairing" | "ready">(
    browser ? "checking" : "ready",
  );
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => navigator.userAgent.slice(0, 64));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionCheckRef = useRef<Promise<void> | null>(null);

  const checkSession = useCallback(() => {
    if (!browser) return Promise.resolve();
    if (sessionCheckRef.current) return sessionCheckRef.current;
    const request = (async () => {
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
    })();
    sessionCheckRef.current = request;
    void request.finally(() => {
      if (sessionCheckRef.current === request) sessionCheckRef.current = null;
    });
    return request;
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
      <Theme theme={theme} mode="system">
        <Center minHeight="100dvh" width="100%">
          <VStack gap={3} hAlign="center">
            <Spinner aria-label="正在验证设备" />
            <Text type="body" color="secondary">
              正在验证设备…
            </Text>
          </VStack>
        </Center>
      </Theme>
    );
  }
  return (
    <Theme theme={theme} mode="system">
      <Center
        minHeight="100dvh"
        width="100%"
        padding={6}
        style={{
          paddingBlockStart: "max(var(--spacing-6), env(safe-area-inset-top, 0px))",
          paddingBlockEnd: "max(var(--spacing-6), env(safe-area-inset-bottom, 0px))",
          paddingInlineStart: "max(var(--spacing-6), env(safe-area-inset-left, 0px))",
          paddingInlineEnd: "max(var(--spacing-6), env(safe-area-inset-right, 0px))",
        }}
      >
        <Card width="100%" maxWidth="var(--xagent-content-width-sm)" padding={6} elevation="high">
          <VStack as="form" gap={4} onSubmit={pair}>
            <VStack gap={1}>
              <Heading level={1}>连接到 XAgent</Heading>
              <Text type="body" color="secondary">
                输入电脑端“本地与局域网访问”设置中显示的六位配对码。
              </Text>
            </VStack>
            <FormLayout>
              <TextInput
                label="设备名称"
                value={deviceName}
                onChange={(value) => setDeviceName(value.slice(0, 64))}
                width="100%"
                isRequired
              />
              <TextInput
                label="配对码"
                value={code}
                onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
                width="100%"
                isRequired
              />
            </FormLayout>
            {error ? <Banner status="error" title={error} collapsible={false} /> : null}
            <Button
              type="submit"
              label={busy ? "正在连接…" : "连接"}
              variant="primary"
              width="100%"
              isLoading={busy}
              isDisabled={busy || code.length !== 6 || !deviceName.trim()}
            />
          </VStack>
        </Card>
      </Center>
    </Theme>
  );
}
