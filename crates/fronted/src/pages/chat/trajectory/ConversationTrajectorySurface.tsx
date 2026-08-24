import { invoke } from "@xagent/runtime";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  RefreshCw,
  Wrench,
  XCircle,
} from "../../../components/icons";
import { Button } from "../../../components/ui/button";
import { useLocale } from "../../../i18n";
import { cn } from "../../../lib/shared/utils";
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

function statusTone(event: TrajectoryEvent) {
  if (event.err || event.st === "error") return "error";
  if (event.st === "aborted") return "aborted";
  if (event.st === "complete" || event.k === "tool_end" || event.k === "turn_end") {
    return "complete";
  }
  return "neutral";
}

function EventStatusIcon({ event }: { event: TrajectoryEvent }) {
  const tone = statusTone(event);
  if (tone === "error") return <XCircle className="h-4 w-4" />;
  if (tone === "aborted") return <AlertTriangle className="h-4 w-4" />;
  if (tone === "complete") return <CheckCircle2 className="h-4 w-4" />;
  if (event.k === "tool_start") return <Wrench className="h-4 w-4" />;
  return <Circle className="h-3.5 w-3.5" />;
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
  return parts.length > 0 ? parts.join(" \u00b7 ") : undefined;
}

function eventDetails(event: TrajectoryEvent): string[] {
  const details: Array<string | undefined> = [];
  if (event.k === "user") details.push(textField(event, "tx"));
  if (event.k === "context") details.push(textField(event, "src"), textField(event, "tx"));
  if (event.k === "header") {
    details.push(textField(event, "ch"), textField(event, "hid"));
  }
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
  if (event.k === "tool_start") {
    details.push(textField(event, "n"), textField(event, "a"));
  }
  if (event.k === "tool_end") details.push(textField(event, "sum"));
  if (event.k === "compaction_end") {
    const before = numberField(event, "before");
    const after = numberField(event, "after");
    details.push(
      before === undefined && after === undefined
        ? undefined
        : `${before ?? "?"} \u2192 ${after ?? "?"}`,
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
  const { t, locale } = useLocale();
  const tone = statusTone(event);
  const details = eventDetails(event);
  const time = new Date(event.at).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="relative flex min-w-0 gap-3 pb-3 last:pb-0">
      <div
        className={cn(
          "relative z-10 mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background",
          tone === "complete" && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
          tone === "error" && "border-destructive/40 text-destructive",
          tone === "aborted" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
          tone === "neutral" && "border-border text-muted-foreground",
        )}
      >
        <EventStatusIcon event={event} />
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 shadow-sm">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-foreground">
            {eventLabel(event, t)}
          </span>
          <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{time}</time>
        </div>
        {details.length > 0 ? (
          <div className="mt-1.5 space-y-1">
            {details.map((detail, index) => (
              <div
                key={`${event.k}-detail-${index}`}
                className="break-words text-xs leading-5 text-muted-foreground"
              >
                {detail}
              </div>
            ))}
          </div>
        ) : null}
        <details className="mt-1.5 text-[11px] text-muted-foreground">
          <summary className="min-h-7 cursor-pointer select-none py-1 leading-5">
            {t("chat.trajectory.details")}
          </summary>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/60 p-2 font-mono text-[10px] leading-4 text-foreground/80">
            {JSON.stringify(event, null, 2)}
          </pre>
        </details>
      </div>
    </div>
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

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">
            {t("chat.trajectory.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("chat.trajectory.summary")
              .replace("{events}", String(events.length))
              .replace("{segments}", String(segmentCount))}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 rounded-xl sm:h-8 sm:w-8"
          disabled={loading}
          onClick={() => setRefreshNonce((value) => value + 1)}
          title={t("chat.trajectory.refresh")}
          aria-label={t("chat.trajectory.refresh")}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5">
        <div className="mx-auto w-full max-w-4xl">
          {truncated ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("chat.trajectory.truncated")}</span>
            </div>
          ) : null}
          {error ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-4 text-center">
              <XCircle className="h-7 w-7 text-destructive" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t("chat.trajectory.loadFailed")}
                </p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : loading && events.length === 0 ? (
            <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("chat.trajectory.loading")}
            </div>
          ) : groups.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 px-6 text-center">
              <Circle className="h-7 w-7 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">{t("chat.trajectory.empty")}</p>
              <p className="max-w-md text-xs leading-5 text-muted-foreground">
                {t("chat.trajectory.emptyHint")}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group.key} className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.turn === null
                        ? t("chat.trajectory.standalone")
                        : t("chat.trajectory.turn").replace("{turn}", String(group.turn))}
                    </span>
                    <span className="h-px min-w-4 flex-1 bg-border/70" />
                  </div>
                  <div className="relative before:absolute before:bottom-4 before:left-3.5 before:top-4 before:w-px before:bg-border/70">
                    {group.events.map((event, eventIndex) => (
                      <TrajectoryEventRow
                        key={`${group.key}-${event.k}-${event.at}-${eventIndex}`}
                        event={event}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
