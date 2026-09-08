import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { invoke, isBrowserRuntime } from "@xgent/runtime";
import { useEffect, useState } from "react";
import { useLocale } from "../../i18n";

type Status = {
  enabled: boolean;
  installed: boolean;
  target: string;
  version: string | null;
  permissionsRequired: boolean;
};

export function ComputerUseSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<Status>();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    if (isBrowserRuntime()) {
      setSupported(false);
      return;
    }
    void invoke<{ platform: string }>("app_runtime_platform")
      .then(async ({ platform }) => {
        if (disposed) return;
        if (!["windows", "linux", "macos"].includes(platform)) {
          setSupported(false);
          return;
        }
        setSupported(true);
        const next = await invoke<Status>("cua_status");
        if (!disposed) setStatus(next);
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
    };
  }, []);

  async function run(command: "cua_status" | "cua_set_enabled", enabled?: boolean) {
    setBusy(true);
    setError("");
    try {
      setStatus(await invoke<Status>(command, enabled === undefined ? {} : { enabled }));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (supported === false && !error) return <Text>{t("settings.cua.unavailable")}</Text>;
  return (
    <Section padding={4} width="100%">
      <VStack gap={3}>
        <Heading level={3}>{t("settings.cua.title")}</Heading>
        <Text type="supporting" color="secondary">
          {t("settings.cua.description")}
        </Text>
        <Switch
          label={t("settings.cua.enable")}
          value={status?.enabled ?? false}
          isDisabled={busy || !status}
          onChange={(enabled) => void run("cua_set_enabled", enabled)}
        />
        <Text type="supporting">
          {status
            ? `${t("settings.cua.installed")} · ${status.target} · ${status.version}`
            : t("settings.cua.loading")}
        </Text>
        {status?.permissionsRequired && status.enabled ? (
          <Text type="supporting">{t("settings.cua.permissions")}</Text>
        ) : null}
        {busy ? <Text role="status">{t("settings.cua.working")}</Text> : null}
        {error ? (
          <VStack gap={2}>
            <Text role="alert">{error}</Text>
            <Button
              label={t("settings.cua.refresh")}
              isDisabled={busy}
              onClick={() => void run("cua_status")}
            />
          </VStack>
        ) : null}
      </VStack>
    </Section>
  );
}
