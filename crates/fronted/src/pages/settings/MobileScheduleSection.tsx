import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useLocale } from "../../i18n";
import { mobileScheduleRows } from "../../lib/connectors/connectorDataView";
import { useMobileSchedule } from "../../lib/connectors/useMobileSchedule";
import { ConnectorDataList } from "./ConnectorDataList";

export function MobileScheduleSection({ disabled = false }: { disabled?: boolean }) {
  const { t, locale } = useLocale();
  const schedule = useMobileSchedule(true);
  const busy = disabled || schedule.busy;
  return (
    <Section padding={4} width="100%">
      <VStack gap={3}>
        <Heading level={3}>{t("settings.connectors.schedule")}</Heading>
        <Selector
          label={t("settings.connectors.scheduleKind")}
          value={schedule.kind}
          onChange={(v) => schedule.setKind(v as "event" | "reminder")}
          options={[
            { value: "event", label: t("settings.mobileAssistant.calendar") },
            { value: "reminder", label: t("settings.mobileAssistant.reminders") },
          ]}
          isDisabled={busy}
          presentation="adaptive"
          size="lg"
          width="100%"
        />
        <Button
          label={t("settings.connectors.loadSchedule")}
          onClick={() => void schedule.load()}
          isDisabled={busy}
          isLoading={schedule.busy}
          size="lg"
        />
        {schedule.calendars ? (
          <>
            {schedule.calendars.truncated ? (
              <Text>{t("settings.connectors.partialCalendars")}</Text>
            ) : null}
            {schedule.calendars.calendars.length ? (
              <>
                <Selector
                  label={t("settings.connectors.destination")}
                  value={schedule.calendarId}
                  onChange={schedule.setCalendarId}
                  options={schedule.calendars.calendars.map((c) => ({
                    value: c.id,
                    label: c.title.trim() || t("settings.connectors.unnamedList"),
                    description: c.source,
                  }))}
                  placeholder={t("settings.connectors.chooseDestination")}
                  isDisabled={busy}
                  hasSearch
                  presentation="adaptive"
                  size="lg"
                  width="100%"
                />
                <TextInput
                  label={t("settings.connectors.recordTitle")}
                  size="lg"
                  value={schedule.title}
                  onChange={schedule.setTitle}
                  isDisabled={busy}
                  width="100%"
                />
                <TextInput
                  label={t("settings.connectors.recordDay")}
                  size="lg"
                  value={schedule.day}
                  onChange={schedule.setDay}
                  isDisabled={busy}
                  width="100%"
                />
                <TextInput
                  label={t("settings.connectors.recordTime")}
                  size="lg"
                  value={schedule.time}
                  onChange={schedule.setTime}
                  isDisabled={busy}
                  width="100%"
                />
                {schedule.kind === "reminder" ? (
                  <Selector
                    label={t("settings.connectors.recurrence")}
                    value={schedule.recurrence}
                    onChange={(v) => schedule.setRecurrence(v as "none" | "daily" | "weekly")}
                    options={["none", "daily", "weekly"].map((value) => ({
                      value,
                      label: t(`settings.connectors.repeat.${value}`),
                    }))}
                    isDisabled={busy}
                    presentation="adaptive"
                    size="lg"
                    width="100%"
                  />
                ) : (
                  <Selector
                    label={t("settings.connectors.duration")}
                    value={String(schedule.duration)}
                    onChange={(v) => schedule.setDuration(Number(v))}
                    options={[15, 30, 60, 90, 120].map((n) => ({
                      value: String(n),
                      label: String(n),
                    }))}
                    isDisabled={busy}
                    presentation="adaptive"
                    size="lg"
                    width="100%"
                  />
                )}
                <Button
                  label={t("settings.connectors.saveSchedule")}
                  onClick={() => void schedule.save()}
                  isDisabled={busy || !schedule.canSave}
                  size="lg"
                />
              </>
            ) : (
              <Text>{t("settings.connectors.noCalendars")}</Text>
            )}
          </>
        ) : null}
        {schedule.error ? (
          <Banner status="error" title={schedule.error} collapsible={false} />
        ) : null}
        {schedule.receipt ? (
          <Banner
            status="success"
            title={t("settings.connectors.savedSchedule")}
            collapsible={false}
          />
        ) : null}
        {schedule.records ? (
          <>
            <Text type="supporting" color="secondary">
              {t("settings.connectors.scheduleRecords")}
            </Text>
            {schedule.records.length ? (
              <ConnectorDataList
                rows={mobileScheduleRows(schedule.records, schedule.kind, t, locale)}
              />
            ) : (
              <Text>{t("settings.connectors.noScheduleRecords")}</Text>
            )}
          </>
        ) : null}
      </VStack>
    </Section>
  );
}
