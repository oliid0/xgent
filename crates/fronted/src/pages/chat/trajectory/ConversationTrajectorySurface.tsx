import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible, CollapsibleGroup } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { invoke } from "@xagent/runtime";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { Circle, RefreshCw } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  desktopLiveTrajectoryEvents,
  desktopTrajectoryReloadVersion,
  subscribeDesktopLiveTrajectory,
} from "../../../lib/trajectory/liveTrajectory";
import type { TrajectoryEvent, TrajectoryUsage } from "../../../lib/trajectory/types";
import {
  groupTrajectoryEvents,
  mergeTrajectoryEvents,
  parseTrajectoryEvents,
} from "../../../lib/trajectory/viewModel";

type TrajectoryEventsResponse = {
  conversationId: string;
  eventsJson: string;
  segmentCount: number;
  truncated: boolean;
};

function textField(event: TrajectoryEvent, key: string) {
  const value = event[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberField(event: TrajectoryEvent, key: string) {
  const value = event[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function statusVariant(
  event: TrajectoryEvent,
): "success" | "warning" | "error" | "accent" | "neutral" {
  if (event.err || event.st === "error") return "error";
  if (event.st === "aborted") return "warning";
  if (event.st === "complete" || event.k === "tool_end" || event.k === "turn_end") {
    return "success";
  }
  if (event.k === "tool_start" || event.k === "first_token") return "accent";
  return "neutral";
}

function usageText(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as TrajectoryUsage;
  const parts = [
    typeof usage.input === "number" ? `in ${usage.input}` : undefined,
    typeof usage.output === "number" ? `out ${usage.output}` : undefined,
    typeof usage.cacheRead === "number" ? `cache ${usage.cacheRead}` : undefined,
    typeof usage.totalTokens === "number" ? `total ${usage.totalTokens}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function eventDetails(event: TrajectoryEvent): string[] {
  const details: Array<string | undefined> = [];
  if (event.k === "user") details.push(textField(event, "tx"));
  if (event.k === "context") details.push(textField(event, "src"), textField(event, "tx"));
  if (event.k === "header") details.push(textField(event, "ch"), textField(event, "hid"));
  if (event.k === "step_start" || event.k === "first_token" || event.k === "step_end") {
    const step = numberField(event, "s");
    if (step !== undefined) details.push(`step ${step}`);
  }
  if (event.k === "step_end") {
    details.push(
      [textField(event, "p"), textField(event, "m")].filter(Boolean).join(" / ") || undefined,
      textField(event, "api"),
      textField(event, "sr"),
      usageText(event.u),
      textField(event, "err"),
    );
  }
  if (event.k === "retry") {
    const attempt = numberField(event, "n");
    const max = numberField(event, "max");
    const delay = numberField(event, "delay");
    details.push(
      attempt === undefined ? undefined : `${attempt}${max === undefined ? "" : ` / ${max}`}`,
      delay === undefined ? undefined : `${delay} ms`,
      textField(event, "err"),
    );
  }
  if (event.k === "tool_start") details.push(textField(event, "n"), textField(event, "a"));
  if (event.k === "tool_end") details.push(textField(event, "sum"));
  if (event.k === "compaction_end") {
    const before = numberField(event, "before");
    const after = numberField(event, "after");
    details.push(
      before === undefined && after === undefined
        ? undefined
        : `${before ?? "?"} → ${after ?? "?"}`,
      textField(event, "err"),
    );
  }
  if (event.k === "turn_end") details.push(textField(event, "err"));
  return details.filter((detail): detail is string => Boolean(detail));
}

function eventLabel(event: TrajectoryEvent, translate: (key: string) => string) {
  const key = `chat.trajectory.event.${event.k}`;
  const translated = translate(key);
  return translated === key ? event.k.replaceAll("_", " ") : translated;
}

function TrajectoryEventRow({ event }: { event: TrajectoryEvent }) {
  const { t } = useLocale();
  const label = eventLabel(event, t);
  const details = eventDetails(event);
  const timestamp = new Date(event.at).toISOString();

  return (
    <Collapsible
      defaultIsOpen={false}
      trigger={
        <HStack gap={3} width="100%" vAlign="center">
          <StatusDot variant={statusVariant(event)} label={label} />
          <Timestamp value={timestamp} format="time" size="3xs" />
        </HStack>
      }
    >
      <VStack gap={2} paddingInlineStart={4} paddingBlockEnd={2}>
        {details.map((detail, index) => (
          <Text key={`${event.k}-detail-${index}`} type="supporting" color="secondary">
            {detail}
          </Text>
        ))}
        <CodeBlock
          code={JSON.stringify(event, null, 2)}
          language="json"
          title={t("chat.trajectory.details")}
          size="sm"
          width="100%"
          maxHeight="var(--xagent-trajectory-code-height)"
          container="section"
        />
      </VStack>
    </Collapsible>
  );
}

export function ConversationTrajectorySurface(props: { conversationId: string }) {
  const { t } = useLocale();
  const [persistedEvents, setPersistedEvents] = useState<TrajectoryEvent[]>([]);
  const [segmentCount, setSegmentCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const liveEvents = useSyncExternalStore(subscribeDesktopLiveTrajectory, () =>
    desktopLiveTrajectoryEvents(props.conversationId),
  );
  const reloadVersion = useSyncExternalStore(subscribeDesktopLiveTrajectory, () =>
    desktopTrajectoryReloadVersion(props.conversationId),
  );

  useEffect(() => {
    const conversationId = props.conversationId.trim();
    let cancelled = false;
    if (!conversationId) {
      setPersistedEvents([]);
      setSegmentCount(0);
      setTruncated(false);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    void invoke<TrajectoryEventsResponse>("trajectory_get_events", { conversationId })
      .then((response) => {
        if (cancelled) return;
        setPersistedEvents(parseTrajectoryEvents(response.eventsJson));
        setSegmentCount(Math.max(0, Math.trunc(response.segmentCount)));
        setTruncated(response.truncated);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setPersistedEvents([]);
        setSegmentCount(0);
        setTruncated(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [props.conversationId, refreshNonce, reloadVersion]);

  const events = useMemo(
    () => mergeTrajectoryEvents(persistedEvents, liveEvents),
    [liveEvents, persistedEvents],
  );
  const groups = useMemo(() => groupTrajectoryEvents(events), [events]);
  const refresh = () => setRefreshNonce((value) => value + 1);

  return (
    <Layout
      height="fill"
      contentWidth="var(--xagent-content-width-xl)"
      header={
        <LayoutHeader hasDivider>
          <HStack gap={3} width="100%" hAlign="between" vAlign="center">
            <VStack gap={0.5}>
              <Heading level={2}>{t("chat.trajectory.title")}</Heading>
              <Text type="supporting" color="secondary">
                {t("chat.trajectory.summary")
                  .replace("{events}", String(events.length))
                  .replace("{segments}", String(segmentCount))}
              </Text>
            </VStack>
            <IconButton
              label={t("chat.trajectory.refresh")}
              tooltip={t("chat.trajectory.refresh")}
              icon={<RefreshCw />}
              variant="ghost"
              isLoading={loading}
              isDisabled={loading}
              onClick={refresh}
            />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent>
          <Section padding={3}>
            <VStack gap={4}>
              {truncated ? (
                <Banner status="warning" title={t("chat.trajectory.truncated")} />
              ) : null}
              {error ? (
                <Banner
                  status="error"
                  title={t("chat.trajectory.loadFailed")}
                  description={error}
                  endContent={
                    <Button
                      label={t("chat.trajectory.refresh")}
                      variant="secondary"
                      size="sm"
                      onClick={refresh}
                    />
                  }
                />
              ) : loading && events.length === 0 ? (
                <Spinner label={t("chat.trajectory.loading")} size="md" />
              ) : groups.length === 0 ? (
                <EmptyState
                  icon={<Circle />}
                  title={t("chat.trajectory.empty")}
                  description={t("chat.trajectory.emptyHint")}
                  actions={
                    <Button
                      label={t("chat.trajectory.refresh")}
                      variant="secondary"
                      onClick={refresh}
                    />
                  }
                />
              ) : (
                <VStack gap={5}>
                  {groups.map((group) => (
                    <VStack key={group.key} gap={2}>
                      <Text type="label" color="secondary">
                        {group.turn === null
                          ? t("chat.trajectory.standalone")
                          : t("chat.trajectory.turn").replace("{turn}", String(group.turn))}
                      </Text>
                      <CollapsibleGroup type="multiple" hasDividers>
                        {group.events.map((event, eventIndex) => (
                          <TrajectoryEventRow
                            key={`${group.key}-${event.k}-${event.at}-${eventIndex}`}
                            event={event}
                          />
                        ))}
                      </CollapsibleGroup>
                    </VStack>
                  ))}
                </VStack>
              )}
            </VStack>
          </Section>
        </LayoutContent>
      }
    />
  );
}
