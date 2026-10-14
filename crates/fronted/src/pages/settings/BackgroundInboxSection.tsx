import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Section, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { getLanPcCommandHostConfig, isBrowserRuntime } from "@xgent/runtime";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  MoreHorizontal,
  RefreshCw,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import { backend } from "../../lib/automation/backend";
import { saveInboxArtifact } from "../../lib/automation/backgroundInboxArtifacts";
import { readInboxSnapshot } from "../../lib/automation/backgroundInboxSnapshot";
import type {
  BackgroundArtifact,
  BackgroundInboxItem,
  BackgroundResultResponse,
  BackgroundSubmissionItem,
  BackgroundTaskRecord,
} from "../../lib/automation/types";
import { useInboxChildren } from "../../lib/automation/useInboxChildren";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { presentationControls } from "../../presentation/controls";
import { inboxChildNodes } from "../../presentation/inboxChildNodes";
import { NativeSettingsContent } from "../../presentation/NativeSettingsContent";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import { mobileBranchReviewNodes } from "./mobileBranchReviewNodes";
import type { SettingsSectionProps } from "./types";
import { useMobileBranchReview } from "./useMobileBranchReview";

export function BackgroundInboxSection(
  props: SettingsSectionProps & { onBack: () => void; nativePresentationMode?: "root" | "sheet" },
) {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<BackgroundInboxItem[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [unread, setUnread] = useState(true);
  const [selection, setSelection] = useState<{
    item: BackgroundInboxItem;
    result: BackgroundTaskRecord;
  } | null>(null);
  const mobileReview = useMobileBranchReview(
    !isBrowserRuntime() && isNativeMobileRuntime() ? (selection?.item.id ?? null) : null,
    selection?.item.requestId ?? "",
    selection?.item.sourceHostId ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedPaths, setSavedPaths] = useState<Record<string, string>>({});
  const [response, setResponse] = useState("");
  const [stagedResponse, setStagedResponse] = useState<BackgroundResultResponse | null>(null);
  const [currentResult, setCurrentResult] = useState<BackgroundTaskRecord | null>(null);
  const childView = useInboxChildren(
    selection?.item.id ?? null,
    currentResult ?? selection?.result ?? null,
  );
  const [submissionsOpen, setSubmissionsOpen] = useState(false);
  const [submissions, setSubmissions] = useState<BackgroundSubmissionItem[]>([]);
  const [submissionCursor, setSubmissionCursor] = useState<number | null>(null);
  const [submissionResult, setSubmissionResult] = useState<BackgroundTaskRecord | null>(null);
  const live = useRef(true),
    version = useRef(0),
    screen = useRef(0),
    running = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      version.current++;
      screen.current++;
    };
  }, []);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    const openedScreen = screen.current;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      if (live.current && openedScreen === screen.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      running.current = false;
      if (live.current) setBusy(false);
    }
  }, []);
  const load = useCallback(
    async (after = 0) => {
      const current = ++version.current;
      const page = await backend.listBackgroundInbox(after, 20, unread);
      if (!live.current || current !== version.current) return;
      setItems((old) =>
        after
          ? [
              ...old,
              ...page.items.filter((item) => !old.some((existing) => existing.id === item.id)),
            ]
          : page.items,
      );
      setCursor(page.nextCursor);
    },
    [unread],
  );
  useEffect(() => {
    if (isBrowserRuntime()) return;
    setBusy(true);
    setError(null);
    // Replayed reads use their own revision rather than being suppressed by
    // the first request's busy flag.
    const pending = load();
    const current = version.current;
    void pending
      .catch((failure) => {
        if (live.current && current === version.current) setError(String(failure));
      })
      .finally(() => {
        if (live.current && current === version.current) setBusy(false);
      });
  }, [load]);
  const refresh = () =>
    run(async () => {
      // The saved inbox remains readable while a peer is offline.
      const report = await backend.syncBackgroundInbox();
      if (live.current)
        setNotice(
          report.unresolved ? `${t("backgroundInbox.offline")} (${report.unresolved})` : null,
        );
      if (submissionsOpen) await loadSubmissions();
      else await load();
    });
  const loadSubmissions = async (after = 0) => {
    const page = await backend.listBackgroundSubmissions(after, 20);
    if (!live.current) return;
    setSubmissions((old) =>
      after
        ? [
            ...old,
            ...page.items.filter(
              (item) => !old.some((saved) => saved.requestId === item.requestId),
            ),
          ]
        : page.items,
    );
    setSubmissionCursor(page.nextCursor);
  };
  const openSubmissions = () =>
    run(async () => {
      setSubmissionsOpen(true);
      setNotice(null);
      setSubmissionResult(null);
      await loadSubmissions();
    });
  const inspectSubmission = (item: BackgroundSubmissionItem, cancel = false) =>
    run(async () => {
      const openedScreen = screen.current;
      setSubmissionResult(null);
      try {
        const actual = cancel
          ? await backend.cancelBackgroundTask(item.requestId, item.sourceHostId)
          : await backend.getBackgroundTask(item.requestId, item.sourceHostId);
        if (actual.hostId !== item.sourceHostId || actual.requestId !== item.requestId)
          throw new Error("Submission reply changed its original host or request");
        if (live.current && openedScreen === screen.current) setSubmissionResult(actual);
      } finally {
        // A failed cancellation RPC can still have saved a durable cancellation.
        // Show native persistence, never infer remote success from a click.
        await loadSubmissions();
      }
    });
  const view = (item: BackgroundInboxItem) =>
    run(async () => {
      const openedScreen = screen.current;
      const result = await readInboxSnapshot(item);
      if (!live.current || openedScreen !== screen.current) return;
      setSelection({ item, result });
      setSavedPaths({});
      setResponse("");
      setStagedResponse(null);
      setCurrentResult(null);
      const saved = await backend.getReceivedResponseState(item.id);
      if (live.current && openedScreen === screen.current) {
        setStagedResponse(saved);
        setResponse(saved?.input.response ?? "");
      }
    });
  const current = (item: BackgroundInboxItem) =>
    run(async () => {
      const openedScreen = screen.current;
      const actual = await backend.getReceivedBackgroundTask(item.id);
      if (actual.requestId !== item.requestId || actual.hostId !== item.sourceHostId)
        throw new Error("Current task status changed its original host or request");
      if (live.current && openedScreen === screen.current) setCurrentResult(actual);
    });
  const resume = (item: BackgroundInboxItem) =>
    run(async () => {
      const openedScreen = screen.current;
      try {
        const actual = await backend.resumeReceivedBackgroundTask(item.id, response);
        if (actual.requestId !== item.requestId || actual.hostId !== item.sourceHostId)
          throw new Error("Resume receipt changed its original host or request");
        if (live.current && openedScreen === screen.current) setCurrentResult(actual);
      } finally {
        // Display only actual native persistence. Network failure cannot
        // fabricate either acceptance or a saved response.
        const saved = await backend.getReceivedResponseState(item.id);
        if (live.current && openedScreen === screen.current) {
          setStagedResponse(saved);
          if (saved) setResponse(saved.input.response);
        }
      }
    });
  const acknowledge = (item: BackgroundInboxItem) =>
    run(async () => {
      const openedScreen = screen.current;
      await backend.acknowledgeBackgroundInbox(item.id);
      if (!live.current || openedScreen !== screen.current) return;
      setSelection(null);
      await load();
    });
  const download = (item: BackgroundInboxItem, artifact: BackgroundArtifact) =>
    run(async () => {
      const openedScreen = screen.current;
      const isCurrent = () => live.current && openedScreen === screen.current;
      const host = getLanPcCommandHostConfig();
      const workdir = host.enabled ? host.localWorkdir || "" : props.settings.system.workdir;
      const saved = await saveInboxArtifact(item, artifact, workdir, isCurrent);
      if (isCurrent()) setSavedPaths((old) => ({ ...old, [artifact.id]: saved.path }));
    });
  const status = (item: Pick<BackgroundTaskRecord["run"], "state" | "success">) =>
    t(
      item.state === "pending"
        ? "backgroundInbox.queued"
        : item.state === "leased"
          ? "backgroundInbox.running"
          : item.state === "waiting"
            ? "backgroundInbox.waiting"
            : item.success
              ? "backgroundInbox.completed"
              : "backgroundInbox.unfinished",
    );
  const c = presentationControls();
  const renderedScreen = screen.current;
  const outcomeNodes = (record: BackgroundTaskRecord, prefix: string): PresentationNode[] => {
    const branches = record.outcomes?.branches ?? [];
    return [
      {
        id: `${prefix}:verification`,
        kind: "Text",
        text: branches.length
          ? `${t("backgroundInbox.verifiedBranches")}: ${branches.filter((branch) => branch.state === "verified").length}/${branches.length}`
          : t("backgroundInbox.noPlan"),
        wrap: true,
      },
      ...branches.flatMap((branch): PresentationNode[] => [
        { id: `${prefix}:branch:${branch.branch.id}`, kind: "Heading", text: branch.branch.title },
        {
          id: `${prefix}:branchState:${branch.branch.id}`,
          kind: "Text",
          text: t(
            branch.state === "verified"
              ? "backgroundInbox.branchVerified"
              : branch.state === "waiting"
                ? "backgroundInbox.waiting"
                : "backgroundInbox.branchPending",
          ),
          wrap: true,
        },
        ...(branch.branch.requirement
          ? [
              {
                id: `${prefix}:requirement:${branch.branch.id}`,
                kind: "Text" as const,
                text: branch.branch.requirement,
                wrap: true,
                secondary: true,
              },
            ]
          : []),
        ...(branch.evidence?.answer || branch.reason
          ? [
              {
                id: `${prefix}:proof:${branch.branch.id}`,
                kind: "Text" as const,
                text: [branch.evidence?.answer, branch.reason].filter(Boolean).join("\n"),
                wrap: true,
              },
            ]
          : []),
      ]),
    ];
  };
  const cloudCancellationNodes = (
    record: BackgroundTaskRecord,
    prefix: string,
  ): PresentationNode[] => {
    const summary = record.cloudCancellation;
    if (!summary) return [];
    return [
      ...(summary.pending > 0
        ? [
            {
              id: `${prefix}:cloudCancel:pending`,
              kind: "Text" as const,
              text: `${t("backgroundInbox.cloudCancellationPending")} (${summary.pending})`,
              wrap: true,
            },
          ]
        : []),
      ...(summary.observedTerminal > 0
        ? [
            {
              id: `${prefix}:cloudCancel:ended`,
              kind: "Text" as const,
              text: `${t("backgroundInbox.cloudCancellationEnded")} (${summary.observedTerminal})`,
              wrap: true,
              secondary: true,
            },
          ]
        : []),
    ];
  };
  const cloudRecoveryNodes = (record: BackgroundTaskRecord, prefix: string): PresentationNode[] => {
    const recovery = record.cloudRecovery;
    if (!recovery || record.run.state !== "waiting") return [];
    const retry = new Date(recovery.retryAt);
    return [
      {
        id: `${prefix}:cloudRecovery:title`,
        kind: "Heading",
        text: t("backgroundInbox.cloudRecovery"),
      },
      {
        id: `${prefix}:cloudRecovery:task`,
        kind: "Text",
        text: `${t("backgroundInbox.cloudTask")}: ${recovery.taskId}`,
        wrap: true,
        secondary: true,
      },
      {
        id: `${prefix}:cloudRecovery:probes`,
        kind: "Text",
        text: `${t("backgroundInbox.cloudProbes")}: ${recovery.probes}`,
        wrap: true,
        secondary: true,
      },
      ...(Number.isFinite(retry.getTime())
        ? [
            {
              id: `${prefix}:cloudRecovery:retry`,
              kind: "Text" as const,
              text: `${t("backgroundInbox.cloudNextQuery")}: ${retry.toLocaleString(locale)}`,
              wrap: true,
              secondary: true,
            },
          ]
        : []),
      ...(recovery.launchError
        ? [
            {
              id: `${prefix}:cloudRecovery:launchError`,
              kind: "Text" as const,
              text: `${t("backgroundInbox.cloudLaunchError")}: ${recovery.launchError}`,
              wrap: true,
            },
          ]
        : []),
      ...(recovery.lastError && recovery.lastError !== recovery.launchError
        ? [
            {
              id: `${prefix}:cloudRecovery:lastError`,
              kind: "Text" as const,
              text: `${t("backgroundInbox.cloudObservation")}: ${recovery.lastError}`,
              wrap: true,
            },
          ]
        : []),
    ];
  };
  const actualNodes = (
    record: BackgroundTaskRecord,
    prefix: string,
    stateId: string,
    outputId: string,
  ): PresentationNode[] => [
    {
      id: stateId,
      kind: "Text",
      text: `${t("backgroundInbox.hostReceipt")}: ${status(record.run)}`,
      wrap: true,
    },
    {
      id: `${prefix}:identity`,
      kind: "Text",
      text: `${t("backgroundInbox.executionDevice")}: ${record.hostId}\n${t("backgroundInbox.request")}: ${record.requestId}`,
      wrap: true,
      secondary: true,
    },
    ...(record.run.output
      ? [{ id: outputId, kind: "Text" as const, text: record.run.output, wrap: true }]
      : []),
    ...cloudCancellationNodes(record, prefix),
    ...cloudRecoveryNodes(record, prefix),
    ...outcomeNodes(record, prefix),
    ...record.artifacts.map(
      (artifact): PresentationNode => ({
        id: `${prefix}:artifact:${artifact.id}`,
        kind: "Text",
        text: `${artifact.relativePath} (${artifact.bytes} B)`,
        wrap: true,
      }),
    ),
  ];
  const back = c.action("inbox:back", t("backgroundInbox.back"), () => {
    // Navigation leaves the task running, but invalidates replies for this screen.
    screen.current++;
    childView.close();
    setCurrentResult(null);
    setSubmissionResult(null);
    setError(null);
    setNotice(null);
    if (selection) setSelection(null);
    else if (submissionsOpen) setSubmissionsOpen(false);
    else props.onBack();
  });
  const nodes: PresentationNode[] = [
    back,
    ...(isBrowserRuntime()
      ? [{ id: "inbox:native", kind: "Text" as const, text: t("backgroundInbox.nativeRequired") }]
      : [c.action("inbox:refresh", t("backgroundInbox.refresh"), refresh, !busy)]),
    ...(busy
      ? [{ id: "inbox:loading", kind: "Text" as const, text: t("backgroundInbox.loading") }]
      : []),
    ...(error
      ? [
          {
            id: "inbox:error",
            kind: "Banner" as const,
            label: t("backgroundInbox.error"),
            text: error,
            status: "error" as const,
          },
        ]
      : []),
    ...(notice
      ? [{ id: "inbox:notice", kind: "Text" as const, text: notice, secondary: true }]
      : []),
  ];
  if (submissionsOpen) {
    nodes.push(
      { id: "inbox:submissions:title", kind: "Heading", text: t("backgroundInbox.submissions") },
      c.action(
        "inbox:submissions:reload",
        t("backgroundInbox.reloadSaved"),
        () => run(() => loadSubmissions()),
        !busy,
      ),
      c.action(
        "inbox:submissions:reports",
        t("backgroundInbox.title"),
        () =>
          run(async () => {
            await load();
            if (live.current) setSubmissionsOpen(false);
          }),
        !busy,
      ),
    );
    if (!submissions.length && !busy && !error)
      nodes.push({
        id: "inbox:submissions:empty",
        kind: "Text",
        text: t("backgroundInbox.noSubmissions"),
      });
    for (const item of submissions)
      nodes.push(
        c.group(`inbox:submission:${item.requestId}`, item.name, [
          {
            id: `inbox:submission:state:${item.requestId}`,
            kind: "Text",
            text: t(
              !item.localOwner
                ? "backgroundInbox.otherInstallation"
                : item.locallyWithdrawn
                  ? "backgroundInbox.locallyWithdrawn"
                  : item.cancellationConfirmed
                    ? "backgroundInbox.cancelConfirmed"
                    : item.cancelRequested
                      ? "backgroundInbox.cancelPending"
                      : item.accepted
                        ? "backgroundInbox.submissionAccepted"
                        : "backgroundInbox.submissionPending",
            ),
            wrap: true,
          },
          {
            id: `inbox:submission:identity:${item.requestId}`,
            kind: "Text",
            text: `${t("backgroundInbox.executionDevice")}: ${item.sourceHostId}\n${t("backgroundInbox.request")}: ${item.requestId}`,
            wrap: true,
            secondary: true,
          },
          ...(!item.locallyWithdrawn &&
          (!item.accepted || (item.cancelRequested && !item.cancellationConfirmed))
            ? [
                {
                  id: `inbox:submission:retry:${item.requestId}`,
                  kind: "Text" as const,
                  text: `${t("backgroundInbox.retryAfter")}: ${new Date(item.retryAt || item.createdAt).toLocaleString()}`,
                  wrap: true,
                  secondary: true,
                },
              ]
            : []),
          ...(item.lastError
            ? [
                {
                  id: `inbox:submission:error:${item.requestId}`,
                  kind: "Text" as const,
                  text: item.lastError,
                  wrap: true,
                },
              ]
            : []),
          c.action(
            `inbox:submission:current:${item.requestId}`,
            t("backgroundInbox.current"),
            () => inspectSubmission(item),
            !busy && item.localOwner && !item.locallyWithdrawn,
          ),
          c.action(
            `inbox:submission:cancel:${item.requestId}`,
            t("backgroundInbox.cancelTask"),
            () => inspectSubmission(item, true),
            !busy && item.localOwner && !item.cancelRequested && !item.locallyWithdrawn,
          ),
        ]),
      );
    if (submissionCursor !== null)
      nodes.push(
        c.action(
          "inbox:submissions:more",
          t("presentation.loadMore"),
          () => run(() => loadSubmissions(submissionCursor)),
          !busy,
        ),
      );
    if (submissionResult)
      nodes.push(
        c.group("inbox:submission:actual", submissionResult.name, [
          ...actualNodes(
            submissionResult,
            "inbox:submission",
            "inbox:submission:actualState",
            "inbox:submission:actualOutput",
          ),
        ]),
      );
  } else if (selection) {
    const { item, result } = selection;
    nodes.push(
      { id: "inbox:title", kind: "Heading", text: item.name },
      { id: "inbox:status", kind: "Text", text: status(item) },
      c.action("inbox:current", t("backgroundInbox.current"), () => current(item), !busy),
      ...(currentResult
        ? [
            c.group(
              "inbox:currentDetail",
              t("backgroundInbox.hostReceipt"),
              actualNodes(
                currentResult,
                "inbox:current",
                "inbox:currentState",
                "inbox:currentOutput",
              ),
            ),
          ]
        : []),
      {
        id: "inbox:stored",
        kind: "Text",
        text: t("backgroundInbox.storedSnapshot"),
        secondary: true,
        wrap: true,
      },
      { id: "inbox:output", kind: "Text", text: result.run.output, wrap: true },
      ...cloudCancellationNodes(result, "inbox:stored"),
      ...cloudRecoveryNodes(result, "inbox:stored"),
      ...inboxChildNodes(c, currentResult ?? result, childView, t, !busy),
      ...result.artifacts.flatMap((artifact) => [
        {
          id: `inbox:file:${artifact.id}`,
          kind: "Text" as const,
          text: `${artifact.relativePath} (${artifact.bytes} B)`,
          wrap: true,
        },
        ...(savedPaths[artifact.id]
          ? [
              {
                id: `inbox:saved:${artifact.id}`,
                kind: "Text" as const,
                text: `${t("backgroundInbox.saved")}: ${savedPaths[artifact.id]}`,
                wrap: true,
              },
            ]
          : [
              c.action(
                `inbox:download:${artifact.id}`,
                t("backgroundInbox.download"),
                () => download(item, artifact),
                !busy,
              ),
            ]),
      ]),
      ...(result.artifacts.some((artifact) => !savedPaths[artifact.id])
        ? [
            {
              id: "inbox:files",
              kind: "Text" as const,
              text: t("backgroundInbox.filesPending"),
              secondary: true,
            },
          ]
        : []),
      ...outcomeNodes(result, "inbox"),
      c.action(
        "inbox:ack",
        t("backgroundInbox.acknowledge"),
        () => acknowledge(item),
        !busy && item.readAt === null,
      ),
    );
    if (!isBrowserRuntime() && isNativeMobileRuntime())
      nodes.push(...mobileBranchReviewNodes(c, mobileReview, t, busy));
    if (
      result.run.state === "waiting" &&
      result.waiting &&
      !result.cloudRecovery &&
      (!currentResult ||
        (currentResult.run.state === "waiting" &&
          !currentResult.cloudRecovery &&
          currentResult.waiting?.waitId === result.waiting.waitId))
    ) {
      nodes.push(
        c.input(
          "inbox:response",
          t("backgroundInbox.response"),
          response,
          setResponse,
          false,
          !busy && !stagedResponse,
        ),
        ...(new TextEncoder().encode(response).length > 32768
          ? [
              {
                id: "inbox:responseLimit",
                kind: "Text" as const,
                text: t("backgroundInbox.responseLimit"),
                wrap: true,
              },
            ]
          : []),
        ...(stagedResponse
          ? [
              {
                id: "inbox:responseSaved",
                kind: "Text" as const,
                text: t(
                  stagedResponse.result
                    ? "backgroundInbox.responseAccepted"
                    : "backgroundInbox.responsePending",
                ),
                wrap: true,
              },
            ]
          : []),
        c.action(
          "inbox:resume",
          t("backgroundInbox.resume"),
          () => resume(item),
          !busy &&
            !stagedResponse?.result &&
            response.trim().length > 0 &&
            new TextEncoder().encode(response).length <= 32768,
        ),
      );
    }
  } else {
    nodes.push(
      c.action(
        "inbox:submissions",
        t("backgroundInbox.submissions"),
        openSubmissions,
        !busy && !isBrowserRuntime(),
      ),
      c.action(
        "inbox:filter",
        t(unread ? "backgroundInbox.showAll" : "backgroundInbox.showUnread"),
        () => {
          setNotice(null);
          setUnread(!unread);
        },
        !busy && !isBrowserRuntime(),
      ),
    );
    if (!items.length && !busy && !error && !isBrowserRuntime())
      nodes.push({ id: "inbox:empty", kind: "Text", text: t("backgroundInbox.empty") });
    for (const item of items)
      nodes.push(
        c.group(`inbox:item:${item.id}`, item.name, [
          { id: `inbox:state:${item.id}`, kind: "Text", text: status(item) },
          { id: `inbox:preview:${item.id}`, kind: "Text", text: item.preview, wrap: true },
          c.action(`inbox:read:${item.id}`, t("backgroundInbox.view"), () => view(item), !busy),
          c.action(
            `inbox:ack:${item.id}`,
            t("backgroundInbox.acknowledge"),
            () => acknowledge(item),
            !busy && item.readAt === null,
          ),
        ]),
      );
    if (cursor !== null)
      nodes.push(
        c.action("inbox:more", t("presentation.loadMore"), () => run(() => load(cursor)), !busy),
      );
  }
  for (const handler of c.handlers.values()) {
    const run = handler.run;
    handler.run = (value) =>
      live.current && renderedScreen === screen.current ? run(value) : undefined;
  }
  if (isApplePresentationRuntime()) {
    const Surface = props.nativeOtherSink ? NativeSettingsContent : NativeSurface;
    return (
      <Surface
        sink={props.nativeOtherSink}
        detail
        sessionSurface={props.nativeSettingsSurfaceId}
        document={{
          mode: props.nativePresentationMode ?? "sheet",
          title: t("backgroundInbox.title"),
          appearance: props.settings.theme,
          formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
          theme: createNativePresentationTheme(
            props.settings,
            isNativeMobileRuntime(),
            "workspaceTools",
          ),
          nodes,
          dismissAction: back.action,
        }}
        handlers={c.handlers}
        onError={(failure) => setError(String(failure))}
      />
    );
  }
  const render = backgroundInboxNodeRenderer(c);
  return (
    <VStack width="100%" gap={3} className="autonomy-settings">
      <Heading level={1}>{t("backgroundInbox.title")}</Heading>
      {nodes.map((node) => render(node))}
    </VStack>
  );
}

export function backgroundInboxNodeRenderer(c: ReturnType<typeof presentationControls>) {
  const render = (node: PresentationNode, level: 2 | 3 = 2): ReactNode => {
    if (node.kind === "HStack")
      return (
        <HStack key={node.id} gap={2} wrap="wrap">
          {node.children?.map((child) => render(child, level))}
        </HStack>
      );
    if (node.kind === "Menu")
      return (
        <DropdownMenu
          key={node.id}
          presentation="adaptive"
          hasChevron={false}
          alignment="end"
          button={{
            label: node.label || "",
            icon: <MoreHorizontal />,
            isIconOnly: true,
            variant: "ghost",
            size: "lg",
          }}
          items={(node.children ?? []).map((child) => ({
            label: child.label || "",
            isDisabled: child.disabled,
            onClick: () => {
              if (child.action) void c.handlers.get(child.action)?.run(null);
            },
          }))}
        />
      );
    if (node.kind === "NavigationRow")
      return (
        <List key={node.id} density="balanced" hasDividers={false} className="task-read-list">
          <ListItem
            label={
              node.variant === "background-child" ? (
                <Text maxLines={2} wordBreak="break-word">
                  {node.label}
                </Text>
              ) : (
                node.label || ""
              )
            }
            description={
              node.variant === "background-child" ? (
                <Text type="supporting" color="secondary" wordBreak="break-word">
                  {node.text}
                </Text>
              ) : (
                node.text
              )
            }
            isSelected={node.selected}
            isDisabled={node.disabled}
            startContent={
              <Icon
                icon={node.variant === "background-child" ? Circle : node.selected ? Check : Circle}
                size="md"
                color={node.selected ? "accent" : "secondary"}
              />
            }
            endContent={
              node.variant === "background-child" ? (
                <Icon
                  icon={node.selected ? ChevronDown : ChevronRight}
                  size="sm"
                  color="secondary"
                />
              ) : undefined
            }
            onClick={
              node.action ? () => void c.handlers.get(node.action || "")?.run(null) : undefined
            }
          />
        </List>
      );
    if (node.kind === "IconButton")
      return (
        <IconButton
          key={node.id}
          label={node.label || ""}
          icon={<RefreshCw />}
          variant="ghost"
          size="lg"
          isDisabled={node.disabled}
          onClick={() => {
            if (node.action) void c.handlers.get(node.action)?.run(null);
          }}
        />
      );
    if (node.kind === "Progress") return <Spinner key={node.id} aria-label={node.label} />;
    if (node.kind === "Heading")
      return (
        <Heading key={node.id} level={level} style={{ overflowWrap: "anywhere" }}>
          {node.text}
        </Heading>
      );
    if (node.kind === "TextInput")
      return (
        <TextInput
          key={node.id}
          label={node.label || ""}
          value={typeof node.value === "string" ? node.value : ""}
          isDisabled={node.disabled}
          onChange={(value) => {
            if (node.action) void c.handlers.get(node.action)?.run(value);
          }}
        />
      );
    if (node.kind === "Button")
      return (
        <Button
          key={node.id}
          label={node.label || ""}
          isDisabled={node.disabled}
          variant={node.destructive ? "destructive" : "secondary"}
          size={
            node.id.startsWith("inbox:phone:") || node.id.startsWith("inbox:child:")
              ? "lg"
              : undefined
          }
          onClick={() => {
            if (node.action) void c.handlers.get(node.action)?.run(null);
          }}
        />
      );
    if (node.kind === "Banner")
      return (
        <Banner
          key={node.id}
          status="error"
          title={node.label}
          description={
            <Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{node.text}</Text>
          }
          collapsible={false}
        />
      );
    if (node.children)
      return (
        <Section key={node.id} variant="transparent" padding={0} className="autonomy-detail-group">
          <VStack width="100%" gap={2}>
            <HStack gap={2} vAlign="center" hAlign="between">
              {node.label ? (
                <Heading level={level} maxLines={2} style={{ overflowWrap: "anywhere" }}>
                  {node.label}
                </Heading>
              ) : null}
              {node.children
                .filter((child) => child.kind === "IconButton" || child.kind === "Menu")
                .map((child) => render(child, level))}
            </HStack>
            {node.children
              .filter((child) => child.kind !== "IconButton" && child.kind !== "Menu")
              .map((child) => render(child, 3))}
          </VStack>
        </Section>
      );
    return (
      <Text
        key={node.id}
        color={node.secondary ? "secondary" : "primary"}
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {node.text}
      </Text>
    );
  };
  return render;
}
