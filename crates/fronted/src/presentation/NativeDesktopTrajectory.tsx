import { invoke } from "@xgent/runtime";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale } from "../i18n";
import { safeStringify } from "../lib/chat/messages/uiMessages";
import type { AppSettings } from "../lib/settings";
import {
  desktopLiveTrajectoryEvents,
  desktopTrajectoryReloadVersion,
  subscribeDesktopLiveTrajectory,
} from "../lib/trajectory/liveTrajectory";
import type { TrajectoryEvent } from "../lib/trajectory/types";
import {
  buildTrajectoryTimeline,
  mergeTrajectoryEvents,
  parseTrajectoryEvents,
} from "../lib/trajectory/viewModel";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import type { PresentationNode } from "./types";

type NativeTrajectoryEventsResponse = {
  eventsJson: string;
  segmentCount: number;
  truncated: boolean;
};

function nativeTrajectoryEventLabel(event: TrajectoryEvent, translate: (key: string) => string) {
  const key = `chat.trajectory.event.${event.k}`;
  const translated = translate(key);
  return translated === key ? event.k.replaceAll("_", " ") : translated;
}

function nativeTrajectoryEventStatus(
  event: TrajectoryEvent,
): "pending" | "running" | "completed" | "error" {
  if (event.err || event.st === "error") return "error";
  if (event.k.endsWith("_start") || event.k === "first_token") return "running";
  if (event.st === "complete" || event.k.endsWith("_end")) return "completed";
  return "pending";
}

export default function NativeDesktopTrajectory(props: {
  conversationId: string;
  settings: AppSettings;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useLocale();
  const [persistedTrajectoryEvents, setPersistedTrajectoryEvents] = useState<TrajectoryEvent[]>([]);
  const [trajectoryLoading, setTrajectoryLoading] = useState(false);
  const [trajectoryError, setTrajectoryError] = useState("");
  const [trajectorySegments, setTrajectorySegments] = useState(0);
  const [trajectoryTruncated, setTrajectoryTruncated] = useState(false);
  const [trajectoryRefreshNonce, setTrajectoryRefreshNonce] = useState(0);
  const liveTrajectoryEvents = useSyncExternalStore(subscribeDesktopLiveTrajectory, () =>
    desktopLiveTrajectoryEvents(props.conversationId),
  );
  const trajectoryReloadVersion = useSyncExternalStore(subscribeDesktopLiveTrajectory, () =>
    desktopTrajectoryReloadVersion(props.conversationId),
  );
  const trajectoryEvents = useMemo(
    () => mergeTrajectoryEvents(persistedTrajectoryEvents, liveTrajectoryEvents),
    [liveTrajectoryEvents, persistedTrajectoryEvents],
  );
  const trajectoryTimeline = useMemo(
    () => buildTrajectoryTimeline(trajectoryEvents),
    [trajectoryEvents],
  );

  useEffect(() => {
    const conversationId = props.conversationId.trim();
    let cancelled = false;
    if (!conversationId) {
      setPersistedTrajectoryEvents([]);
      setTrajectorySegments(0);
      setTrajectoryTruncated(false);
      setTrajectoryLoading(false);
      setTrajectoryError("");
      return;
    }
    setTrajectoryLoading(true);
    setTrajectoryError("");
    void invoke<NativeTrajectoryEventsResponse>("trajectory_get_events", { conversationId })
      .then((response) => {
        if (cancelled) return;
        setPersistedTrajectoryEvents(parseTrajectoryEvents(response.eventsJson));
        setTrajectorySegments(Math.max(0, Math.trunc(response.segmentCount)));
        setTrajectoryTruncated(response.truncated);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPersistedTrajectoryEvents([]);
        setTrajectoryError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setTrajectoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.conversationId, trajectoryRefreshNonce, trajectoryReloadVersion]);

  const trajectoryControls = presentationControls();
  trajectoryControls.handlers.set("close", {
    enabled: true,
    accepts: (value) => value === null,
    run: props.onClose,
  });
  const trajectoryNodes: PresentationNode[] = [
    {
      id: "trajectory-header",
      kind: "HStack",
      children: [
        {
          id: "trajectory-summary",
          kind: "Text",
          text: t("chat.trajectory.summary")
            .replace("{events}", String(trajectoryEvents.length))
            .replace("{segments}", String(trajectorySegments)),
        },
        { id: "trajectory-header-space", kind: "Spacer" },
        {
          ...trajectoryControls.action(
            "trajectory-refresh",
            t("chat.trajectory.refresh"),
            () => setTrajectoryRefreshNonce((value) => value + 1),
            !trajectoryLoading,
          ),
          kind: "IconButton",
          icon: "arrow.clockwise",
        },
      ],
    },
    ...(trajectoryTruncated
      ? [
          {
            id: "trajectory-truncated",
            kind: "Banner" as const,
            status: "paused" as const,
            text: t("chat.trajectory.truncated"),
          },
        ]
      : []),
    ...(trajectoryError
      ? [
          {
            id: "trajectory-error",
            kind: "Banner" as const,
            status: "error" as const,
            label: t("chat.trajectory.loadFailed"),
            text: trajectoryError,
          },
        ]
      : trajectoryLoading
        ? [
            {
              id: "trajectory-loading",
              kind: "StatusDot" as const,
              status: "running" as const,
              label: t("chat.trajectory.loading"),
            },
          ]
        : trajectoryTimeline.length === 0
          ? [
              {
                id: "trajectory-empty",
                kind: "EmptyState" as const,
                icon: "point.3.connected.trianglepath.dotted",
                label: t("chat.trajectory.empty"),
                text: t("chat.trajectory.emptyHint"),
              },
            ]
          : [
              {
                id: "trajectory-events",
                kind: "List" as const,
                children: trajectoryTimeline.map((item) => ({
                  id: `trajectory:${item.id}`,
                  kind: "Section" as const,
                  label: nativeTrajectoryEventLabel(item.event, t),
                  children: [
                    {
                      id: `trajectory:${item.id}:status`,
                      kind: "StatusDot" as const,
                      status: nativeTrajectoryEventStatus(item.event),
                      label: t(`chat.trajectory.lane.${item.lane}`),
                      text:
                        item.durationMs <= 0
                          ? undefined
                          : item.durationMs < 1_000
                            ? `${Math.round(item.durationMs)} ms`
                            : `${(item.durationMs / 1_000).toFixed(1)} s`,
                    },
                    {
                      id: `trajectory:${item.id}:raw`,
                      kind: "CodeBlock" as const,
                      language: "json",
                      text: safeStringify(item.event).slice(0, 8_000),
                    },
                  ],
                })),
              },
            ]),
  ];

  return (
    <NativeSurface
      document={{
        mode: "sidebar",
        title: t("chat.trajectory.title"),
        appearance: props.settings.theme,
        formFactor: "desktop",
        theme: createNativePresentationTheme(props.settings, false, "workspaceTools"),
        dismissAction: "close",
        nodes: trajectoryNodes,
      }}
      handlers={trajectoryControls.handlers}
      onError={props.onError}
    />
  );
}
