import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { isBrowserRuntime } from "@xagent/runtime";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { LOCAL_ACCESS_CSRF_KEY, LOCAL_ACCESS_SESSION_CHANGED_EVENT } from "../../runtime/browser";

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
      <Center minHeight="100vh" width="100%">
        <VStack gap={3} hAlign="center">
          <Spinner aria-label="正在验证设备" />
          <Text type="body" color="secondary">
            正在验证设备…
          </Text>
        </VStack>
      </Center>
    );
  }
  return (
    <Center minHeight="100vh" width="100%" padding={6}>
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
  );
}
