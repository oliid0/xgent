import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Section, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { isTauriRuntime } from "@xgent/runtime";
import { useLocale } from "../../i18n";
import { useAgentStartup } from "../../lib/automation/useAgentStartup";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";

export function AgentStartupSection() {
  const active = isTauriRuntime() && !isNativeMobileRuntime();
  const startup = useAgentStartup(active);
  return active ? <AgentStartupContent startup={startup} /> : null;
}

export function AgentStartupContent({ startup }: { startup: ReturnType<typeof useAgentStartup> }) {
  const { t } = useLocale();
  return (
    <Section padding={3} width="100%">
      <VStack gap={3} width="100%">
        <Heading level={3}>{t("agentStartup.title")}</Heading>
        <Button
          size="lg"
          label={t("agentStartup.refresh")}
          onClick={() => void startup.refresh()}
          isLoading={startup.busy}
          isDisabled={startup.busy}
        />
        <VStack gap={2} aria-busy={startup.busy} aria-live="polite">
          {startup.error ? (
            <Banner status="error" title={startup.error} collapsible={false} />
          ) : null}
          {startup.data ? (
            <>
              {startup.data.supported && startup.data.registered !== null ? (
                <Switch
                  label={t("agentStartup.enable")}
                  value={startup.data.registered}
                  onChange={(enabled) => void startup.setRegistered(enabled)}
                  isDisabled={startup.busy}
                />
              ) : (
                <Text wordBreak="break-word">
                  {t(`agentStartup.${startup.data.reason ?? "plugin_unavailable"}`)}
                </Text>
              )}
              <Text wordBreak="break-word">
                {t(startup.data.workerReady ? "agentStartup.ready" : "agentStartup.notReady")}
              </Text>
              {startup.data.backgroundLaunch ? (
                <Text type="supporting">{t("agentStartup.backgroundLaunch")}</Text>
              ) : null}
              <Text type="supporting" color="secondary" wordBreak="break-word">
                {t("agentStartup.observed")}: {new Date(startup.data.observedAtMs).toLocaleString()}
              </Text>
            </>
          ) : !startup.busy && !startup.error ? (
            <Text>{t("agentStartup.notRead")}</Text>
          ) : null}
        </VStack>
      </VStack>
    </Section>
  );
}
