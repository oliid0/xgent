import {
  type MobileBranchReview,
  mobileReadChoiceKey,
} from "../../lib/automation/mobileBranchActions";
import type { presentationControls } from "../../presentation/controls";
import type { PresentationNode } from "../../presentation/types";
import type { useMobileBranchReview } from "./useMobileBranchReview";

/** Actual native read scopes and bounded SDK choices, shared by both UIs. */
export function mobileBranchReadNodes(
  c: ReturnType<typeof presentationControls>,
  view: ReturnType<typeof useMobileBranchReview>,
  branch: MobileBranchReview["branches"][number],
  t: (key: string) => string,
  enabled: boolean,
): PresentationNode[] {
  const auth = branch.readAuthorization;
  if (!auth) return [];
  const prefix = `inbox:phone:branch:${branch.source.id}:read`;
  const text = (id: string, value: string): PresentationNode => ({
    id,
    kind: "Text",
    text: value,
    wrap: true,
    secondary: true,
  });
  const draft = view.readChoices[branch.source.id];
  const bound =
    !!draft && draft.contextHash === auth.contextHash && draft.revision === auth.revision;
  const canEdit = enabled && !view.error && !view.review?.cancelRequested && bound;
  const describe = (scope: {
    kind: string;
    id: string;
    sourceId: string;
    title: string;
    source: string;
    writable: boolean;
    startMs?: number;
    endMs?: number;
  }) =>
    [
      scope.source,
      scope.kind === "health" && scope.startMs && scope.endMs
        ? `${new Date(scope.startMs).toLocaleDateString()} – ${new Date(scope.endMs).toLocaleDateString()}`
        : scope.writable
          ? ""
          : t("mobileBranch.read.readOnly"),
    ]
      .filter(Boolean)
      .join(" · ");
  const title = (scope: { kind: string; id: string; title: string }) =>
    scope.kind === "health" ? t(`proactive.metric.${scope.id}`) : scope.title;
  const selected = bound ? draft.selected : auth.selections;
  const group = c.group(prefix, t("mobileBranch.read.title"), [
    text(
      `${prefix}:state`,
      t(
        `mobileBranch.read.state.${auth.decision === "pending" && auth.allowedKinds.length ? "automatic" : auth.decision}`,
      ),
    ),
    ...Object.entries(auth.blockedReasons).map(([kind, reason]) =>
      text(`${prefix}:blocked:${kind}`, `${t(`mobileBranch.read.kind.${kind}`)}: ${reason}`),
    ),
    text(`${prefix}:selected`, `${t("mobileBranch.read.selected")}: ${selected.length}/16`),
    ...(!bound
      ? selected.map(
          (scope, index): PresentationNode => ({
            id: `${prefix}:selected:${index}`,
            kind: "NavigationRow",
            label: title(scope),
            text: describe(scope),
            icon: "checkmark.circle.fill",
            selected: true,
          }),
        )
      : []),
    {
      id: `${prefix}:sources`,
      kind: "Menu",
      variant: "compact",
      label: t("mobileBranch.read.title"),
      icon: "ellipsis",
      children: (["event", "reminder", "health"] as const)
        .filter((kind) => kind !== "health" || auth.canDiscoverKinds.includes(kind))
        .map((kind) => ({
          ...c.action(
            `${prefix}:load:${kind}`,
            t(`mobileBranch.read.load.${kind}`),
            () => view.loadReadChoices(branch.source.id, kind, auth.contextHash, auth.revision),
            enabled && !view.error && auth.canDiscoverKinds.includes(kind),
          ),
          icon: kind === "health" ? "heart.fill" : kind === "event" ? "calendar" : "checklist",
        })),
    },
    ...(draft
      ? [
          ...(!bound ? [text(`${prefix}:stale`, t("mobileBranch.read.stale"))] : []),
          ...(draft.truncated
            ? [text(`${prefix}:truncated`, t("mobileBranch.read.truncated"))]
            : []),
          ...(!draft.choices.length ? [text(`${prefix}:empty`, t("mobileBranch.read.empty"))] : []),
          ...draft.choices.slice(draft.page * 20, draft.page * 20 + 20).map((scope, index) => {
            const key = mobileReadChoiceKey(scope),
              included = selected.some((value) => mobileReadChoiceKey(value) === key);
            return {
              ...c.action(
                `${prefix}:choose:${draft.generation}:${index}`,
                title(scope),
                () => view.editReadChoices(branch.source.id, draft.generation, key),
                canEdit && (included || selected.length < 16),
              ),
              kind: "NavigationRow" as const,
              variant: "task-read-choice",
              label: title(scope),
              maxLines: 1,
              text: describe(scope),
              icon: included ? "checkmark.circle.fill" : "circle",
              selected: included,
              accessibilityLabel: `${title(scope)} · ${describe(scope)}`,
              accessibilityValue: t(
                included ? "mobileBranch.read.remove" : "mobileBranch.read.select",
              ),
            };
          }),
          ...(draft.choices.length > 20
            ? [
                text(`${prefix}:page`, `${draft.page + 1}/${Math.ceil(draft.choices.length / 20)}`),
                c.action(
                  `${prefix}:previous:${draft.generation}`,
                  t("mobileBranch.read.previous"),
                  () =>
                    view.editReadChoices(branch.source.id, draft.generation, null, draft.page - 1),
                  canEdit && draft.page > 0,
                ),
                c.action(
                  `${prefix}:next:${draft.generation}`,
                  t("mobileBranch.read.next"),
                  () =>
                    view.editReadChoices(branch.source.id, draft.generation, null, draft.page + 1),
                  canEdit && (draft.page + 1) * 20 < draft.choices.length,
                ),
              ]
            : []),
          c.action(
            `${prefix}:approve:${draft.generation}`,
            t("mobileBranch.read.approve"),
            () =>
              view.decideReadAuthorization(
                branch.source.id,
                auth.contextHash,
                auth.revision,
                draft.generation,
                true,
              ),
            canEdit && auth.canApprove && selected.length > 0 && selected.length <= 16,
          ),
        ]
      : []),
    ...(auth.canRevoke
      ? [
          c.action(
            `${prefix}:revoke:${auth.revision}`,
            t("mobileBranch.read.revoke"),
            () =>
              view.decideReadAuthorization(
                branch.source.id,
                auth.contextHash,
                auth.revision,
                null,
                false,
              ),
            enabled && !view.error,
          ),
        ]
      : []),
  ]);
  group.variant = "task-review";
  const decisions = (group.children ?? []).filter(
    (node) => node.id.startsWith(`${prefix}:approve:`) || node.id.startsWith(`${prefix}:revoke:`),
  );
  group.children = [
    ...(group.children ?? []).filter((node) => !decisions.includes(node)),
    ...(decisions.length
      ? [{ id: `${prefix}:decisions`, kind: "HStack" as const, children: decisions }]
      : []),
  ];
  return [group];
}
