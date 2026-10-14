import type { BackgroundChildSummary, BackgroundTaskRecord } from "../lib/automation/types";
import type { useInboxChildren } from "../lib/automation/useInboxChildren";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function inboxChildNodes(
  c: ReturnType<typeof presentationControls>,
  parent: BackgroundTaskRecord,
  view: ReturnType<typeof useInboxChildren>,
  t: (key: string) => string,
  enabled: boolean,
): PresentationNode[] {
  const children = parent.children ?? [];
  if (!children.length) return [];
  const status = (child: BackgroundChildSummary) =>
    t(
      child.cancelRequested && !child.cancelAcknowledged
        ? "backgroundInbox.childStopping"
        : !child.accepted
          ? "backgroundInbox.childUnconfirmed"
          : child.state === "pending"
            ? "backgroundInbox.queued"
            : child.state === "leased"
              ? "backgroundInbox.running"
              : child.state === "waiting"
                ? "backgroundInbox.waiting"
                : !child.terminalConfirmed
                  ? "backgroundInbox.childUnconfirmed"
                  : child.success
                    ? "backgroundInbox.completed"
                    : "backgroundInbox.unfinished",
    );
  return [
    { id: "inbox:children:title", kind: "Heading", text: t("backgroundInbox.children") },
    ...children.flatMap((child, index): PresentationNode[] => {
      const selected =
        view.selected?.callId === child.callId &&
        view.selected.requestId === child.requestId &&
        view.selected.peerId === child.peerId;
      const actual = selected ? view.detail : null;
      const result = actual?.result;
      const title = result?.name || child.name || `${t("backgroundInbox.child")} ${index + 1}`;
      return [
        {
          ...c.action(
            `inbox:child:${child.callId}`,
            title,
            () => (selected ? view.close(child) : view.open(child)),
            enabled,
          ),
          kind: "NavigationRow",
          variant: "background-child",
          icon: "circle",
          text: status(actual?.child ?? child),
          selected,
        },
        ...(selected
          ? [
              ...(view.busy
                ? [
                    {
                      id: `inbox:child:loading:${child.callId}`,
                      kind: "Progress" as const,
                      label: t("backgroundInbox.loading"),
                    },
                  ]
                : []),
              ...(view.error
                ? [
                    {
                      id: `inbox:child:error:${child.callId}`,
                      kind: "Banner" as const,
                      label: view.error,
                      status: "error" as const,
                    },
                  ]
                : []),
              ...(!view.busy && actual && !result
                ? [
                    {
                      id: `inbox:child:unavailable:${child.callId}`,
                      kind: "Text" as const,
                      text: t("backgroundInbox.childUnavailable"),
                    },
                  ]
                : []),
              ...(result?.run.output
                ? [
                    {
                      id: `inbox:child:output:${child.callId}`,
                      kind: "Text" as const,
                      text: result.run.output,
                      wrap: true,
                    },
                  ]
                : []),
              ...(result?.artifacts.map((file) => ({
                id: `inbox:child:file:${child.callId}:${file.id}`,
                kind: "Text" as const,
                text: `${file.relativePath} (${file.bytes} B)`,
                wrap: true,
              })) ?? []),
              ...(actual?.child.lastError
                ? [
                    {
                      id: `inbox:child:lastError:${child.callId}`,
                      kind: "Banner" as const,
                      label: actual.child.lastError,
                      status: "error" as const,
                    },
                  ]
                : []),
              c.action(
                `inbox:child:refresh:${child.callId}`,
                t(view.error ? "presentation.retry" : "backgroundInbox.childRefresh"),
                () => view.open(child),
                enabled && !view.busy,
              ),
            ]
          : []),
      ];
    }),
  ];
}
