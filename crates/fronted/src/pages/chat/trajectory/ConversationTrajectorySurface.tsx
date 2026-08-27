import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  StackItem,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token, type TokenColor } from "@astryxdesign/core/Token";
import { invoke } from "@xagent/runtime";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { Activity, Circle, RefreshCw } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  desktopLiveTrajectoryEvents,
  desktopTrajectoryReloadVersion,
  subscribeDesktopLiveTrajectory,
} from "../../../lib/trajectory/liveTrajectory";
import {
  composeTrajectorySystemPrompt,
  type TrajectorySectionInput,
  trajectorySectionSlotAt,
} from "../../../lib/trajectory/sections";
import type {
  TrajectoryEvent,
  TrajectorySection,
  TrajectoryUsage,
} from "../../../lib/trajectory/types";
import {
  buildTrajectoryTimeline,
  mergeTrajectoryEvents,
  parseTrajectoryEvents,
  type TrajectoryLane,
  type TrajectoryTimelineItem,
} from "../../../lib/trajectory/viewModel";

type TrajectoryEventsResponse = {
  conversationId: string;
  eventsJson: string;
  segmentCount: number;
  truncated: boolean;
};

type TrajectorySectionResponse = TrajectorySection & { bytes: number };

type TrajectoryDetailsTab = "overview" | "input" | "system" | "tools" | "usage" | "raw";

const LANE_TOKEN_COLORS: Record<TrajectoryLane, TokenColor> = {
  user: "blue",
  context: "cyan",
  model: "purple",
  tool: "green",
  transport: "teal",
  warning: "orange",
  compaction: "pink",
  system: "gray",
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
  if (event.k === "retry" || event.k === "failover") return "warning";
  if (event.st === "complete" || event.k === "tool_end" || event.k === "turn_end") {
    return "success";
  }
  if (event.k === "tool_start" || event.k === "first_token" || event.k === "step_start") {
    return "accent";
  }
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
      textField(event, "p"),
      delay === undefined ? undefined : `${delay} ms`,
      textField(event, "err"),
    );
  }
  if (event.k === "failover") {
    const attempt = numberField(event, "n");
    const from = textField(event, "from");
    const to = textField(event, "to");
    details.push(
      attempt === undefined ? undefined : `#${attempt}`,
      from || to ? `${from ?? "?"} → ${to ?? "?"}` : undefined,
      textField(event, "err"),
    );
  }
  if (event.k === "transport") {
    const headers = Array.isArray(event.hn)
      ? event.hn.filter((value): value is string => typeof value === "string").join(", ")
      : undefined;
    details.push(
      textField(event, "p"),
      textField(event, "o"),
      event.sp === true ? "system proxy" : event.sp === false ? "direct" : undefined,
      event.fu === true ? "full URL" : undefined,
      headers,
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

function durationLabel(durationMs: number) {
  if (durationMs <= 0) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  return `${(durationMs / 60_000).toFixed(1)} min`;
}

function laneLabel(lane: TrajectoryLane, translate: (key: string) => string) {
  const key = `chat.trajectory.lane.${lane}`;
  const value = translate(key);
  return value === key ? lane : value;
}

function eventSectionRefs(event: TrajectoryEvent): string[] {
  if (event.k !== "header" || !Array.isArray(event.sec)) return [];
  return event.sec.filter(
    (sectionId): sectionId is string => typeof sectionId === "string" && sectionId.trim() !== "",
  );
}

function headerForItem(
  item: TrajectoryTimelineItem,
  events: readonly TrajectoryEvent[],
): TrajectoryEvent | undefined {
  const directHeaderId =
    item.event.k === "header"
      ? textField(item.event, "hid")
      : (textField(item.event, "hid") ?? textField(item.endEvent ?? item.event, "hid"));
  const stepHost =
    directHeaderId || item.turn === null || item.step === null
      ? undefined
      : events.find(
          (event) =>
            event.k === "step_start" &&
            numberField(event, "t") === item.turn &&
            numberField(event, "s") === item.step,
        );
  const headerId = directHeaderId ?? (stepHost ? textField(stepHost, "hid") : undefined);
  if (!headerId) return undefined;
  return events.find((event) => event.k === "header" && textField(event, "hid") === headerId);
}

function sectionsForHeader(
  header: TrajectoryEvent | undefined,
  sections: ReadonlyMap<string, TrajectorySection>,
): TrajectorySectionInput {
  if (!header || !Array.isArray(header.sec)) return {};
  const input: TrajectorySectionInput = {};
  for (const [index, sectionId] of header.sec.entries()) {
    if (typeof sectionId !== "string") continue;
    const section = sections.get(sectionId);
    const slot = trajectorySectionSlotAt(index);
    if (section && slot) input[slot] = section.content;
  }
  return input;
}

function inputText(item: TrajectoryTimelineItem) {
  if (item.event.k === "user" || item.event.k === "context") {
    return textField(item.event, "tx");
  }
  if (item.event.k === "tool_start") return textField(item.event, "a");
  return undefined;
}

function TimelineTrack({ item, label }: { item: TrajectoryTimelineItem; label: string }) {
  return (
    <HStack
      className="xagent-trajectory-track"
      aria-label={`${label}, ${durationLabel(item.durationMs)}`}
    >
      <HStack
        className="xagent-trajectory-bar"
        data-lane={item.lane}
        aria-hidden="true"
        style={{
          insetInlineStart: `${item.offsetPercent}%`,
          inlineSize: `${item.widthPercent}%`,
        }}
      />
    </HStack>
  );
}

function TrajectoryDetails({
  item,
  events,
  sections,
}: {
  item: TrajectoryTimelineItem;
  events: readonly TrajectoryEvent[];
  sections: ReadonlyMap<string, TrajectorySection>;
}) {
  const { t } = useLocale();
  const [tab, setTab] = useState<TrajectoryDetailsTab>("overview");
  const label = eventLabel(item.event, t);
  const details = eventDetails(item.endEvent ?? item.event);
  const header = headerForItem(item, events);
  const headerSections = sectionsForHeader(header, sections);
  const systemPrompt = composeTrajectorySystemPrompt(headerSections);
  const tools = headerSections.toolCatalog;
  const usage = (item.endEvent ?? item.event).u;
  const input = inputText(item);
  const availableTabs = useMemo(() => {
    const next: Array<{ id: TrajectoryDetailsTab; label: string }> = [
      { id: "overview", label: t("chat.trajectory.overview") },
    ];
    if (input) next.push({ id: "input", label: t("chat.trajectory.input") });
    if (systemPrompt) next.push({ id: "system", label: t("chat.trajectory.systemPrompt") });
    if (tools) next.push({ id: "tools", label: t("chat.trajectory.tools") });
    if (usage && typeof usage === "object") {
      next.push({ id: "usage", label: t("chat.trajectory.usage") });
    }
    next.push({ id: "raw", label: t("chat.trajectory.details") });
    return next;
  }, [input, systemPrompt, t, tools, usage]);

  useEffect(() => {
    if (!availableTabs.some((candidate) => candidate.id === tab)) setTab("overview");
  }, [availableTabs, tab]);

  const code = (() => {
    if (tab === "input") return input ?? "";
    if (tab === "system") return systemPrompt ?? "";
    if (tab === "tools") return tools ?? "";
    if (tab === "usage") return JSON.stringify(usage, null, 2);
    return JSON.stringify(
      item.endEvent ? { start: item.event, end: item.endEvent } : item.event,
      null,
      2,
    );
  })();

  return (
    <VStack height="100%" minHeight={0} gap={3}>
      <VStack gap={1}>
        <HStack gap={2} vAlign="center">
          <StatusDot variant={statusVariant(item.endEvent ?? item.event)} label={label} />
          <Token label={laneLabel(item.lane, t)} color={LANE_TOKEN_COLORS[item.lane]} size="sm" />
        </HStack>
        <Heading level={3}>{label}</Heading>
        <Text type="supporting" color="secondary">
          {durationLabel(item.durationMs)}
        </Text>
      </VStack>
      <TabList
        value={tab}
        onChange={(value) => setTab(value as TrajectoryDetailsTab)}
        size="sm"
        role="tablist"
        hasDivider
      >
        {availableTabs.map((candidate) => (
          <Tab
            key={candidate.id}
            value={candidate.id}
            label={candidate.label}
            panelId={`trajectory-${candidate.id}`}
          />
        ))}
      </TabList>
      <StackItem size="fill" isScrollable>
        {tab === "overview" ? (
          <VStack id="trajectory-overview" role="tabpanel" gap={3}>
            <List density="compact" hasDividers>
              <ListItem
                label={t("chat.trajectory.started")}
                endContent={
                  <Timestamp
                    value={new Date(item.startAt).toISOString()}
                    format="time"
                    size="3xs"
                  />
                }
              />
              <ListItem
                label={t("chat.trajectory.duration")}
                endContent={durationLabel(item.durationMs)}
              />
              {item.turn !== null ? (
                <ListItem label={t("chat.trajectory.turnLabel")} endContent={String(item.turn)} />
              ) : null}
              {item.step !== null ? (
                <ListItem label={t("chat.trajectory.stepLabel")} endContent={String(item.step)} />
              ) : null}
            </List>
            {details.length > 0 ? (
              <VStack gap={1}>
                {details.map((detail) => (
                  <Text key={`${item.id}-${detail}`} type="supporting" color="secondary">
                    {detail}
                  </Text>
                ))}
              </VStack>
            ) : null}
          </VStack>
        ) : (
          <CodeBlock
            code={code}
            language={tab === "raw" || tab === "usage" || tab === "tools" ? "json" : "text"}
            title={availableTabs.find((candidate) => candidate.id === tab)?.label}
            size="sm"
            width="100%"
            maxHeight="var(--xagent-trajectory-code-height)"
            container="section"
          />
        )}
      </StackItem>
    </VStack>
  );
}

export function ConversationTrajectorySurface(props: { conversationId: string }) {
  const { t } = useLocale();
  const compact = useMediaQuery("(max-width: 900px), (pointer: coarse) and (hover: none)");
  const [persistedEvents, setPersistedEvents] = useState<TrajectoryEvent[]>([]);
  const [sections, setSections] = useState<ReadonlyMap<string, TrajectorySection>>(new Map());
  const [segmentCount, setSegmentCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [search, setSearch] = useState("");
  const [scale, setScale] = useState<"actual" | "sequence">("actual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const sectionIds = useMemo(() => [...new Set(events.flatMap(eventSectionRefs))].sort(), [events]);
  const sectionRequestKey = sectionIds.join("\u0000");

  useEffect(() => {
    const conversationId = props.conversationId.trim();
    const requestedSectionIds = sectionRequestKey ? sectionRequestKey.split("\u0000") : [];
    let cancelled = false;
    if (!conversationId || requestedSectionIds.length === 0) {
      setSections(new Map());
      return () => {
        cancelled = true;
      };
    }

    void invoke<TrajectorySectionResponse[]>("trajectory_get_sections", {
      conversationId,
      sectionIds: requestedSectionIds,
    })
      .then((response) => {
        if (cancelled) return;
        setSections(new Map(response.map((section) => [section.sectionId, section])));
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        console.warn("[trajectory] failed to load prompt sections", reason);
        setSections(new Map());
      });

    return () => {
      cancelled = true;
    };
  }, [props.conversationId, sectionRequestKey]);
  const timeline = useMemo(() => buildTrajectoryTimeline(events, scale), [events, scale]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return timeline;
    return timeline.filter((item) =>
      `${eventLabel(item.event, t)} ${laneLabel(item.lane, t)} ${JSON.stringify(item.event)}`
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [search, t, timeline]);
  const grouped = useMemo(() => {
    const groups = new Map<string, { key: string; turn: number | null; items: typeof filtered }>();
    for (const item of filtered) {
      const key = item.turn === null ? "standalone" : `turn-${item.turn}`;
      const group = groups.get(key) ?? { key, turn: item.turn, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [filtered]);
  const selected = timeline.find((item) => item.id === selectedId) ?? null;
  const refresh = () => setRefreshNonce((value) => value + 1);

  useEffect(() => {
    if (selectedId && !timeline.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [selectedId, timeline]);

  const content = (
    <LayoutContent isScrollable padding={3}>
      <VStack gap={4}>
        {truncated ? <Banner status="warning" title={t("chat.trajectory.truncated")} /> : null}
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
        ) : grouped.length === 0 ? (
          <EmptyState
            icon={<Circle />}
            title={search ? t("chat.trajectory.noMatches") : t("chat.trajectory.empty")}
            description={search ? undefined : t("chat.trajectory.emptyHint")}
            actions={
              search ? (
                <Button
                  label={t("chat.trajectory.clearSearch")}
                  variant="secondary"
                  onClick={() => setSearch("")}
                />
              ) : (
                <Button
                  label={t("chat.trajectory.refresh")}
                  variant="secondary"
                  onClick={refresh}
                />
              )
            }
          />
        ) : (
          <VStack gap={5}>
            {compact && selected ? (
              <TrajectoryDetails item={selected} events={events} sections={sections} />
            ) : null}
            <HStack gap={2} wrap="wrap" aria-label={t("chat.trajectory.legend")}>
              {(
                ["user", "context", "model", "tool", "transport", "warning", "compaction"] as const
              ).map((lane) => (
                <Token
                  key={lane}
                  label={laneLabel(lane, t)}
                  color={LANE_TOKEN_COLORS[lane]}
                  size="sm"
                />
              ))}
            </HStack>
            {grouped.map((group) => (
              <VStack key={group.key} gap={2}>
                <HStack hAlign="between" vAlign="center">
                  <Text type="label" color="secondary" weight="semibold">
                    {group.turn === null
                      ? t("chat.trajectory.standalone")
                      : t("chat.trajectory.turn").replace("{turn}", String(group.turn))}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {String(group.items.length)}
                  </Text>
                </HStack>
                <List density="compact" hasDividers>
                  {group.items.map((item) => {
                    const label = eventLabel(item.event, t);
                    const details = eventDetails(item.endEvent ?? item.event);
                    return (
                      <ListItem
                        key={item.id}
                        label={label}
                        description={details[0]}
                        isSelected={selectedId === item.id}
                        startContent={
                          <Token
                            label={laneLabel(item.lane, t)}
                            color={LANE_TOKEN_COLORS[item.lane]}
                            size="sm"
                            isLabelHidden
                          />
                        }
                        endContent={
                          <HStack gap={3} vAlign="center">
                            <TimelineTrack item={item} label={label} />
                            <Text
                              type="supporting"
                              color="secondary"
                              className="xagent-trajectory-duration"
                            >
                              {durationLabel(item.durationMs)}
                            </Text>
                          </HStack>
                        }
                        onClick={() =>
                          setSelectedId((current) => (current === item.id ? null : item.id))
                        }
                      />
                    );
                  })}
                </List>
              </VStack>
            ))}
          </VStack>
        )}
      </VStack>
    </LayoutContent>
  );

  return (
    <Layout
      height="fill"
      padding={0}
      className="xagent-trajectory-surface"
      header={
        <LayoutHeader hasDivider>
          <VStack gap={3} width="100%">
            <HStack gap={3} width="100%" hAlign="between" vAlign="center">
              <HStack gap={2} vAlign="center">
                <Activity aria-hidden="true" />
                <VStack gap={0}>
                  <Heading level={2}>{t("chat.trajectory.title")}</Heading>
                  <Text type="supporting" color="secondary">
                    {t("chat.trajectory.summary")
                      .replace("{events}", String(events.length))
                      .replace("{segments}", String(segmentCount))}
                  </Text>
                </VStack>
              </HStack>
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
            <HStack gap={2} width="100%" hAlign="between" vAlign="center" wrap="wrap">
              <StackItem size="fill">
                <TextInput
                  type="text"
                  value={search}
                  onChange={setSearch}
                  label={t("chat.trajectory.search")}
                  isLabelHidden
                  placeholder={t("chat.trajectory.search")}
                  startIcon="search"
                  hasClear
                  width="100%"
                />
              </StackItem>
              <SegmentedControl
                value={scale}
                onChange={(value) => setScale(value as "actual" | "sequence")}
                label={t("chat.trajectory.scale")}
                size="sm"
              >
                <SegmentedControlItem value="actual" label={t("chat.trajectory.actualTime")} />
                <SegmentedControlItem value="sequence" label={t("chat.trajectory.sequence")} />
              </SegmentedControl>
            </HStack>
          </VStack>
        </LayoutHeader>
      }
      content={content}
      end={
        !compact && selected ? (
          <LayoutPanel
            width="var(--xagent-trajectory-details-width)"
            hasDivider
            padding={4}
            isScrollable={false}
            label={t("chat.trajectory.details")}
          >
            <TrajectoryDetails item={selected} events={events} sections={sections} />
          </LayoutPanel>
        ) : undefined
      }
    />
  );
}
