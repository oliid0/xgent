import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useLocale } from "../../i18n";
import { connectorObservationTime } from "../../lib/connectors/connectorDataView";
import { mobileHomeRows } from "../../lib/connectors/mobileHomeView";
import type { useMobileHome } from "../../lib/connectors/useMobileHome";
import { ConnectorDataList } from "./ConnectorDataList";

export function MobileHomeSection({
  home,
  disabled,
}: {
  home: ReturnType<typeof useMobileHome>;
  disabled: boolean;
}) {
  const { t, locale } = useLocale();
  return (
    <Section padding={4} width="100%">
      <VStack gap={3}>
        <Heading level={3}>{t("settings.mobileAssistant.home")}</Heading>
        <Button
          label={t("settings.connectors.readHome")}
          onClick={() => void home.refresh()}
          isLoading={home.busy && !home.powerBusy}
          isDisabled={disabled || home.busy}
          size="lg"
        />
        <VStack gap={2} aria-live="polite" aria-busy={home.busy}>
          {home.error ? <Banner status="error" title={home.error} collapsible={false} /> : null}
          {home.data ? (
            <>
              <Text type="supporting" color="secondary" wordBreak="break-word">
                {t("settings.connectors.homeObserved")} ·{" "}
                {connectorObservationTime(home.data.observedAtMs, locale)}
              </Text>
              {home.data.truncated ? (
                <Text type="supporting" color="secondary" wordBreak="break-word">
                  {t("settings.connectors.homeTruncated")}
                </Text>
              ) : null}
              {home.data.records.length ? (
                <ConnectorDataList
                  rows={mobileHomeRows(home.data, t, {
                    busy: disabled || home.busy,
                    powerActionId: home.powerActionId,
                    setPower: home.setPower,
                  })}
                />
              ) : (
                <Text>{t("settings.connectors.noHome")}</Text>
              )}
            </>
          ) : !home.busy && !home.error ? (
            <Text type="supporting" color="secondary">
              {t("settings.connectors.homeNotRead")}
            </Text>
          ) : null}
        </VStack>
      </VStack>
    </Section>
  );
}
