import type { presentationControls } from "../../presentation/controls";
import type { PresentationNode } from "../../presentation/types";
import { mobileBranchReadNodes } from "./mobileBranchReadNodes";
import type { useMobileBranchReview } from "./useMobileBranchReview";

/** One data/action contract for native SwiftUI and Astryx task details. */
export function mobileBranchReviewNodes(
  c: ReturnType<typeof presentationControls>,
  view: ReturnType<typeof useMobileBranchReview>,
  t: (key: string) => string,
  disabled = false,
): PresentationNode[] {
  const text = (id: string, value: string, secondary = false): PresentationNode => ({
    id,
    kind: "Text",
    text: value,
    wrap: true,
    secondary,
  });
  const timestamp = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? new Date(value).toLocaleString()
      : "";
  const enabled = !disabled && !view.busy && !view.loading;
  return [
    {
      ...c.group("inbox:phone", t("mobileBranch.title"), [
        {
          ...c.action("inbox:phone:refresh", t("mobileBranch.refresh"), view.refresh, enabled),
          kind: "IconButton",
          icon: "arrow.clockwise",
        },
        ...(view.loading ? [text("inbox:phone:loading", t("backgroundInbox.loading"))] : []),
        ...(view.error
          ? [
              {
                id: "inbox:phone:error",
                kind: "Banner" as const,
                label: t("mobileBranch.readFailed"),
                text: view.error,
              },
            ]
          : []),
        ...(view.review
          ? [
              ...(view.review.cancelRequested
                ? [text("inbox:phone:cancelled", t("mobileBranch.cancelled"))]
                : []),
              ...(!view.review.branches.length
                ? [text("inbox:phone:empty", t("mobileBranch.empty"))]
                : []),
              ...view.review.branches.map((branch) => {
                const prefix = `inbox:phone:branch:${branch.source.id}`;
                const authorization = branch.authorization;
                const actions = branch.plan?.actions ?? [];
                return {
                  ...c.group(prefix, branch.source.requirement, [
                    ...mobileBranchReadNodes(c, view, branch, t, enabled),
                    text(
                      `${prefix}:attempts`,
                      `${t("mobileBranch.attempts")}: ${branch.attempts}/3 · ${t("mobileBranch.recovery")}: ${branch.recovery}`,
                      true,
                    ),
                    ...(branch.lastError
                      ? [
                          {
                            id: `${prefix}:error`,
                            kind: "Banner" as const,
                            label: t("mobileBranch.paused"),
                            text: branch.lastError,
                          },
                        ]
                      : []),
                    ...(!branch.plan ? [text(`${prefix}:noPlan`, t("mobileBranch.noPlan"))] : []),
                    ...actions.map((action, index) => {
                      const record = branch.records[index];
                      const observed = branch.labels[index];
                      const label =
                        observed?.id === action.input.request.calendarId &&
                        observed.sourceId === action.sourceId
                          ? observed
                          : undefined;
                      const request = action.input.request;
                      const times =
                        action.input.kind === "calendar_event"
                          ? `${timestamp(request.startMs)} → ${timestamp(request.endMs)}`
                          : timestamp(request.dueMs);
                      return c.group(`${prefix}:action:${index}`, String(request.title), [
                        text(
                          `${prefix}:action:${index}:state`,
                          t(`mobileBranch.state.${record?.state ?? "unexecuted"}`),
                        ),
                        text(
                          `${prefix}:action:${index}:account`,
                          [
                            label?.title || t("mobileBranch.destination"),
                            label?.source || record?.destination.source,
                          ]
                            .filter(Boolean)
                            .join(" · "),
                          true,
                        ),
                        ...(times ? [text(`${prefix}:action:${index}:time`, times)] : []),
                        ...(request.allDay === true
                          ? [text(`${prefix}:action:${index}:allDay`, t("mobileBranch.allDay"))]
                          : []),
                        ...(request.location
                          ? [
                              text(
                                `${prefix}:action:${index}:location`,
                                `${t("mobileBranch.location")}: ${String(request.location)}`,
                                true,
                              ),
                            ]
                          : []),
                        ...(request.recurrence
                          ? [
                              text(
                                `${prefix}:action:${index}:recurrence`,
                                t(`mobileBranch.recurrence.${request.recurrence}`),
                              ),
                            ]
                          : []),
                        ...(request.notes
                          ? [text(`${prefix}:action:${index}:notes`, String(request.notes), true)]
                          : []),
                        ...(record?.error
                          ? [text(`${prefix}:action:${index}:error`, record.error)]
                          : []),
                      ]);
                    }),
                    ...(authorization
                      ? [
                          text(
                            `${prefix}:authorization`,
                            t(
                              `mobileBranch.authorization.${authorization.decision === "pending" && !authorization.required && authorization.allowed ? "automatic" : authorization.decision}`,
                            ),
                          ),
                          ...(authorization.blockedReason
                            ? [text(`${prefix}:policyBlocked`, authorization.blockedReason)]
                            : []),
                          ...(authorization.canApprove
                            ? [
                                c.action(
                                  `${prefix}:approve`,
                                  t("mobileBranch.approve"),
                                  () =>
                                    view.decideAuthorization(
                                      branch.source.id,
                                      authorization.planHash,
                                      authorization.revision,
                                      true,
                                    ),
                                  enabled && !view.error && !view.review?.cancelRequested,
                                ),
                              ]
                            : []),
                          ...(authorization.canRevoke
                            ? [
                                c.action(
                                  `${prefix}:revoke`,
                                  t("mobileBranch.revoke"),
                                  () =>
                                    view.decideAuthorization(
                                      branch.source.id,
                                      authorization.planHash,
                                      authorization.revision,
                                      false,
                                    ),
                                  enabled && !view.error,
                                ),
                              ]
                            : []),
                        ]
                      : []),
                    ...(branch.acknowledged
                      ? [text(`${prefix}:ack`, t("mobileBranch.acknowledged"))]
                      : []),
                    ...(branch.canRetryPlanning
                      ? [
                          c.action(
                            `${prefix}:retry`,
                            t("mobileBranch.retry"),
                            () => view.retryPlanning(branch.source.id, branch.recovery),
                            enabled && !view.error && !view.review?.cancelRequested,
                          ),
                        ]
                      : []),
                  ]),
                  variant: "task-review",
                };
              }),
            ]
          : []),
      ]),
      variant: "task-review",
    },
  ];
}
