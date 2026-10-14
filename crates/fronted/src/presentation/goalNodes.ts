import {
  GOAL_CATEGORIES,
  type GoalArtifact,
  type GoalCategory,
  type GoalConfig,
  type GoalRecord,
  type GoalStatus,
} from "../lib/automation/goals";
import type { useGoalLaunch } from "../lib/automation/useGoalLaunch";
import type { useGoals } from "../lib/automation/useGoals";
import { connectorObservationTime } from "../lib/connectors/connectorDataView";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export type GoalDraft = {
  id: string;
  storeId: string;
  config: GoalConfig;
  revision: number;
  editing: boolean;
};
export type GoalScreen = {
  scope: string;
  current: () => boolean;
  data: ReturnType<typeof useGoals>;
  launch?: ReturnType<typeof useGoalLaunch>;
  selected: GoalRecord | null;
  draft: GoalDraft | null;
  showCompleted: boolean;
  stepTitle: string;
  taskId: string;
  expanded: string | null;
  workId: string;
  setWorkId: (value: string) => void;
  linkWork: () => Promise<void>;
  artifactsOpen: boolean;
  openArtifacts: () => void;
  download: (artifact: GoalArtifact) => Promise<void>;
  back: () => void;
  open: (id: string) => void;
  create: (category: GoalCategory, parentId?: string) => void;
  edit: (goal: GoalRecord) => void;
  patch: (field: "title" | "description" | "category", value: string) => void;
  save: () => Promise<void>;
  setStepTitle: (value: string) => void;
  addStep: () => Promise<void>;
  setTaskId: (value: string) => void;
  linkTask: () => Promise<void>;
  remove: (goal: GoalRecord) => Promise<void>;
  setStatus: (goal: GoalRecord, status: GoalStatus) => Promise<void>;
  toggleCompleted: () => void;
  expand: (id: string | null) => void;
};
const categoryIcons: Record<GoalCategory, string> = {
  health: "heart",
  relationships: "person.2",
  finance: "banknote",
  career: "building.2",
  interests: "paintpalette",
  productivity: "laptopcomputer",
  custom: "circle",
};

export function goalNodes(screen: GoalScreen, t: (key: string) => string, locale?: string) {
  const { data, selected, draft } = screen,
    snapshot = data.snapshot,
    revision = snapshot?.revision ?? 0,
    idle =
      !!snapshot &&
      !data.busy &&
      !data.retryAvailable &&
      (!draft || draft.storeId === snapshot.storeId);
  const c = presentationControls(`goals:${screen.scope}`);
  const iconAction = (
    id: string,
    label: string,
    icon: string,
    run: () => unknown,
    enabled = true,
  ): PresentationNode => ({
    ...c.action(id, label, run, enabled),
    kind: "IconButton",
    icon,
    size: "large",
    variant: "ghost",
  });
  const menu = (goal: GoalRecord): PresentationNode => ({
    id: `goal:${goal.id}:menu`,
    kind: "Menu",
    label: t("goals.options"),
    icon: "ellipsis",
    children: [
      ...(snapshot?.launchVersion === 1
        ? [
            c.action(
              `goal:${goal.id}:launch`,
              t("goals.run"),
              () => screen.launch?.open(goal, revision, snapshot.storeId),
              idle && goal.status === "active" && !goal.launchBlocked && !!screen.launch,
            ),
          ]
        : []),
      c.action(
        `goal:${goal.id}:finish`,
        t(goal.status === "completed" ? "goals.reopen" : "goals.complete"),
        () => screen.setStatus(goal, goal.status === "completed" ? "active" : "completed"),
        idle,
      ),
      c.action(
        `goal:${goal.id}:status`,
        t(goal.status === "paused" ? "goals.resume" : "goals.pause"),
        () => screen.setStatus(goal, goal.status === "paused" ? "active" : "paused"),
        idle,
      ),
      c.action(
        `goal:${goal.id}:subgoal`,
        t("goals.addSubgoal"),
        () => screen.create(goal.config.category, goal.id),
        idle,
      ),
      c.action(`goal:${goal.id}:edit`, t("settings.edit"), () => screen.edit(goal), idle),
      {
        ...c.action(
          `goal:${goal.id}:delete`,
          t("settings.delete"),
          () => screen.remove(goal),
          idle,
        ),
        destructive: true,
      },
    ],
  });
  const row = (goal: GoalRecord): PresentationNode => ({
    id: `goal:${goal.id}`,
    kind: "VStack",
    variant: "goal-row",
    children: [
      {
        ...c.toggle(
          `goal:${goal.id}:complete`,
          `${t(goal.status === "completed" ? "goals.reopen" : "goals.complete")} ${goal.config.title}`,
          goal.status === "completed",
          (done) => screen.setStatus(goal, done ? "completed" : "active"),
          idle,
        ),
        text: t(`goals.${goal.status}`),
      },
      {
        ...c.action(`goal:${goal.id}:open`, goal.config.title, () => screen.open(goal.id)),
        text: goal.status === "paused" ? t("goals.paused") : goal.config.description,
        variant: "goal-open",
      },
      menu(goal),
    ],
  });
  const nodes: PresentationNode[] = [
    {
      id: "goals-header",
      kind: "HStack",
      children: [
        iconAction("goals-back", t("settings.native.back"), "chevron.left", screen.back),
        ...(selected && !draft
          ? [{ id: "goals-header-space", kind: "Spacer" as const }]
          : [
              {
                id: "goals-title",
                kind: "Heading" as const,
                text: draft
                  ? t(draft.editing ? "goals.edit" : "goals.create")
                  : (selected?.config.title ?? t("goals.title")),
              },
            ]),
        iconAction(
          "goals-refresh",
          t("presentation.retry"),
          "arrow.clockwise",
          () =>
            selected && screen.artifactsOpen ? data.readArtifacts(selected.id) : data.refresh(),
          !data.busy,
        ),
        ...(selected && !draft && !screen.artifactsOpen && !screen.launch?.draft
          ? [menu(selected)]
          : []),
      ],
    },
  ];
  if (selected && !draft)
    nodes.push({
      id: "goals-title",
      kind: "Heading",
      text: screen.artifactsOpen ? t("goals.artifacts") : selected.config.title,
    });
  if (data.busy)
    nodes.push({ id: "goals-busy", kind: "Progress", label: t("backgroundInbox.loading") });
  if (data.error)
    nodes.push({
      id: "goals-error",
      kind: "Banner",
      status: "error",
      label: data.error.startsWith("goals.") ? t(data.error) : data.error,
    });
  if (data.retryAvailable)
    nodes.push(
      c.action("goals-retry-write", t("goals.retryWrite"), () => data.retry(), !data.busy),
    );
  if (data.observationError)
    nodes.push({
      id: "goals-observation-error",
      kind: "Banner",
      status: "error",
      label: data.observationError.startsWith("goals.")
        ? t(data.observationError)
        : data.observationError,
    });
  if (screen.launch?.draft) {
    const launchDraft = screen.launch.draft;
    const launch = screen.launch,
      pending = launch.retry,
      enabled = !launch.loading && !launch.busy && !pending;
    const stale = !pending && launchDraft.revision !== snapshot?.revision;
    if (stale)
      nodes.push({
        id: "goal-run-stale",
        kind: "Banner",
        status: "error",
        label: t("goals.conflict"),
      });
    nodes.push({ id: "goal-run-title", kind: "Heading", text: t("goals.run") });
    if (launch.loading)
      nodes.push({ id: "goal-run-loading", kind: "Progress", label: t("backgroundInbox.loading") });
    if (launch.error)
      nodes.push({
        id: "goal-run-error",
        kind: "Banner",
        status: "error",
        label: launch.error.startsWith("goals.") ? t(launch.error) : launch.error,
      });
    if (!launch.loading && !launch.error && !launch.targets.length)
      nodes.push({ id: "goal-run-empty", kind: "Text", text: t("goals.noExecutors") });
    nodes.push(
      c.select(
        "goal-run-peer",
        t("goals.executor"),
        launchDraft.peer,
        [
          { value: "", label: t("goals.chooseExecutor") },
          ...launch.targets.map((target) => ({
            value: target.peerId ?? "local",
            label: target.peerId ? target.label : t("goals.thisDevice"),
          })),
        ],
        launch.setPeer,
        enabled && launch.targets.length > 0,
      ),
    );
    nodes.push(
      c.select(
        "goal-run-model",
        t("goals.planningModel"),
        launchDraft.model,
        [
          { value: "", label: t("goals.chooseModel") },
          ...launch.models.map(({ value, label }) => ({ value, label })),
        ],
        launch.setModel,
        enabled && !!launch.target && launch.models.length > 0,
      ),
    );
    if (launch.target && !launch.models.length)
      nodes.push({ id: "goal-run-no-model", kind: "Text", text: t("goals.planningModelRequired") });
    if (launch.target)
      nodes.push(
        c.input(
          "goal-run-workdir",
          t("goals.workspace"),
          launch.target.host.workdir,
          () => {},
          false,
          false,
        ),
      );
    nodes.push(
      c.select(
        "goal-run-scheduling",
        t("chat.runtime.intelligentScheduling"),
        launchDraft.scheduling ? "on" : "off",
        [
          { value: "off", label: t("settings.cronViewStatusDisabled") },
          { value: "on", label: t("settings.cronViewStatusEnabled") },
        ],
        (value) => launch.setScheduling(value === "on"),
        enabled && launch.target?.host.intelligentSchedulingVersion === 1,
      ),
    );
    nodes.push(
      c.action(
        "goal-run-start",
        t(pending ? "goals.retryWrite" : "goals.run"),
        launch.start,
        pending ? !launch.busy : launch.canRun && !stale,
      ),
    );
    nodes.push(c.action("goal-run-back", t("settings.native.back"), screen.back));
  } else if (draft) {
    const stale = draft.editing && draft.revision !== snapshot?.revision;
    if (stale) {
      const saved = snapshot?.goals.find((goal) => goal.id === draft.id);
      if (saved)
        nodes.push(
          c.action("goal-reload-draft", t("goals.reloadDraft"), () => screen.edit(saved), idle),
        );
    }
    nodes.push(
      c.input(
        "goal-title",
        t("settings.connectors.recordTitle"),
        draft.config.title,
        (value) => screen.patch("title", value),
        false,
        idle,
      ),
      {
        ...c.input(
          "goal-plan",
          t("goals.plan"),
          draft.config.description,
          (value) => screen.patch("description", value),
          false,
          idle,
        ),
        kind: "TextArea",
      },
      c.select(
        "goal-category",
        t("goals.category"),
        draft.config.category,
        GOAL_CATEGORIES.map((value) => ({ value, label: t(`goals.category.${value}`) })),
        (value) => screen.patch("category", value),
        idle,
      ),
      c.action(
        "goal-save",
        t("settings.save"),
        screen.save,
        idle && !stale && !!draft.config.title.trim(),
      ),
      c.action("goal-cancel", t("settings.cancel"), screen.back, !data.busy),
    );
  } else if (selected && screen.artifactsOpen) {
    if (data.artifactsBusy)
      nodes.push({
        id: "goal-artifacts-busy",
        kind: "Progress",
        label: t("backgroundInbox.loading"),
      });
    for (const [id, message] of [
      ["goal-artifacts-error", data.artifactsError],
      ["goal-download-error", data.downloadError],
    ])
      if (message)
        nodes.push({
          id,
          kind: "Banner",
          status: "error",
          label: message.startsWith("goals.") ? t(message) : message,
        });
    const page = data.artifacts?.goalId === selected.id ? data.artifacts : null;
    const rows: PresentationNode[] = (page?.items ?? []).map((artifact) => {
      const transfer = data.transfers[`${snapshot?.storeId}:${selected.id}:${artifact.id}`],
        saved = transfer?.status === "saved";
      const size = new Intl.NumberFormat(locale, {
        style: "unit",
        unit:
          artifact.bytes >= 1024 * 1024 ? "megabyte" : artifact.bytes >= 1024 ? "kilobyte" : "byte",
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }).format(
        artifact.bytes /
          (artifact.bytes >= 1024 * 1024 ? 1024 * 1024 : artifact.bytes >= 1024 ? 1024 : 1),
      );
      return {
        ...c.action(
          `goal-artifact:${artifact.id}`,
          artifact.relativePath.split("/").at(-1) ?? artifact.relativePath,
          () => screen.download(artifact),
          !data.downloadBusy && !saved,
        ),
        kind: "NavigationRow",
        variant: "goal-artifact",
        icon: "doc.text",
        text: `${size} · ${artifact.taskName}`,
        value: saved
          ? t("goals.saved")
          : transfer?.status === "download_requested"
            ? t("goals.downloadRequested")
            : null,
        status: data.downloadBusy === artifact.id ? "running" : saved ? "completed" : "pending",
      };
    });
    if (rows.length) nodes.push(c.group("goal-artifact-files", "", rows));
    if (page?.nextCursor)
      nodes.push(
        c.action(
          "goal-artifacts-more",
          t("presentation.loadMore"),
          () => data.readArtifacts(selected.id, page.nextCursor),
          !data.artifactsBusy,
        ),
      );
    if (page && !rows.length && !data.artifactsBusy && !data.artifactsError)
      nodes.push({ id: "goal-artifacts-empty", kind: "Text", text: t("goals.noArtifacts") });
  } else if (selected) {
    nodes.push(
      { id: "goal-state", kind: "Badge", label: t(`goals.${selected.status}`) },
      ...(selected.config.description
        ? [
            {
              id: "goal-description",
              kind: "Text" as const,
              text: selected.config.description,
              wrap: true,
            },
          ]
        : []),
    );
    if (selected.artifactCount !== undefined)
      nodes.push({
        ...c.action("goal-artifacts-open", t("goals.artifacts"), screen.openArtifacts),
        kind: "NavigationRow",
        variant: "goal-artifacts-nav",
        icon: "doc.text",
        value: String(selected.artifactCount),
      });
    const work = selected.backgroundTasks ?? [],
      workTargets = (snapshot?.backgroundTargets ?? []).filter(
        (target) => !work.some((link) => link.requestId === target.requestId),
      );
    if (work.length || workTargets.length)
      nodes.push(
        c.group("goal-work", t("goals.backgroundTasks"), [
          ...work.map((task) => ({
            id: `goal-work:${task.requestId}`,
            kind: "VStack" as const,
            variant: "goal-association",
            icon: "doc.text",
            children: [
              {
                id: `goal-work:${task.requestId}:name`,
                kind: "Text" as const,
                text: task.name,
                wrap: true,
              },
              {
                id: `goal-work:${task.requestId}:state`,
                kind: "Text" as const,
                secondary: true,
                text: t(
                  !task.exists || !task.state
                    ? "goals.taskRemoved"
                    : task.state === "done"
                      ? task.success
                        ? "goals.runSucceeded"
                        : "goals.runFailed"
                      : task.state === "expired"
                        ? "goals.runExpired"
                        : task.state === "leased"
                          ? "goals.runRunning"
                          : task.state === "submitting"
                            ? "goals.runSubmitting"
                            : task.state === "stopping"
                              ? "goals.runStopping"
                              : task.state === "pending"
                                ? "goals.runPending"
                                : "goals.runWaiting",
                ),
              },
              {
                id: `goal-work:${task.requestId}:menu`,
                kind: "Menu" as const,
                label: t("goals.options"),
                children: [
                  c.action(
                    `goal-work:${task.requestId}:unlink`,
                    t("goals.unlink"),
                    () =>
                      data.apply(
                        { op: "unlink_work", id: selected.id, request_id: task.requestId },
                        revision,
                      ),
                    idle,
                  ),
                ],
              },
            ],
          })),
          ...(workTargets.length && work.length < 32
            ? [
                c.select(
                  "goal-work-choice",
                  t("goals.linkWork"),
                  screen.workId,
                  [
                    { value: "", label: t("goals.chooseTask") },
                    ...workTargets.map((task) => ({ value: task.requestId, label: task.name })),
                  ],
                  screen.setWorkId,
                  idle,
                ),
                c.action(
                  "goal-work-link",
                  t("goals.linkWork"),
                  screen.linkWork,
                  idle && workTargets.some((task) => task.requestId === screen.workId),
                ),
              ]
            : []),
        ]),
      );
    const steps = selected.config.steps.map((step) => ({
      ...c.toggle(
        `goal-step:${step.id}`,
        step.title,
        step.done,
        (done) => data.apply({ op: "set_step", id: selected.id, step_id: step.id, done }, revision),
        idle,
      ),
      variant: "goal-step",
      text: t(step.done ? "goals.completed" : "goals.active"),
    }));
    nodes.push(
      c.group("goal-steps", t("goals.steps"), [
        ...steps,
        c.input(
          "goal-step-title",
          t("goals.addStep"),
          screen.stepTitle,
          screen.setStepTitle,
          false,
          idle && steps.length < 40,
        ),
        c.action(
          "goal-add-step",
          t("goals.addStep"),
          screen.addStep,
          idle && !!screen.stepTitle.trim() && steps.length < 40,
        ),
      ]),
    );
    const children = snapshot?.goals.filter((goal) => goal.config.parentId === selected.id) ?? [];
    nodes.push(
      c.group("goal-subgoals", t("goals.subgoals"), [
        ...children.map(row),
        c.action(
          "goal-add-subgoal",
          t("goals.addSubgoal"),
          () => screen.create(selected.config.category, selected.id),
          idle,
        ),
      ]),
    );
    const targets =
      snapshot?.targets.filter((task) => !selected.tasks.some((link) => link.id === task.id)) ?? [];
    nodes.push(
      c.group("goal-tasks", t("goals.tasks"), [
        ...selected.tasks.map((task) => ({
          id: `goal-task:${task.id}`,
          kind: "VStack" as const,
          variant: "goal-association",
          icon: "clock",
          children: [
            { id: `goal-task:${task.id}:name`, kind: "Text" as const, text: task.name, wrap: true },
            {
              id: `goal-task:${task.id}:status`,
              kind: "Text" as const,
              secondary: true,
              text: t(
                !task.exists
                  ? "goals.taskRemoved"
                  : task.enabled
                    ? "settings.cronViewStatusEnabled"
                    : "settings.cronViewStatusDisabled",
              ),
            },
            {
              id: `goal-task:${task.id}:menu`,
              kind: "Menu" as const,
              label: t("goals.options"),
              children: [
                ...(task.followUpEligible && !task.followUp
                  ? [
                      c.action(
                        `goal-task:${task.id}:followup`,
                        t(task.followUpBlocked ? "goals.followupReenable" : "goals.followupEnable"),
                        () =>
                          data.apply(
                            { op: "link_task", id: selected.id, task_id: task.id, follow_up: true },
                            revision,
                          ),
                        idle,
                      ),
                    ]
                  : []),
                ...(task.followUp || task.followUpBlocked
                  ? [
                      c.action(
                        `goal-task:${task.id}:followup-disable`,
                        t("goals.followupDisable"),
                        () =>
                          data.apply(
                            {
                              op: "link_task",
                              id: selected.id,
                              task_id: task.id,
                              follow_up: false,
                            },
                            revision,
                          ),
                        idle,
                      ),
                    ]
                  : []),
                c.action(
                  `goal-task:${task.id}:unlink`,
                  t("goals.unlink"),
                  () =>
                    data.apply({ op: "unlink_task", id: selected.id, task_id: task.id }, revision),
                  idle,
                ),
              ],
            },
          ],
        })),
        ...(targets.length
          ? [
              c.select(
                "goal-task-choice",
                t("goals.linkTask"),
                screen.taskId,
                [
                  { value: "", label: t("goals.chooseTask") },
                  ...targets.map((task) => ({ value: task.id, label: task.name })),
                ],
                screen.setTaskId,
                idle,
              ),
              c.action(
                "goal-link-task",
                t("goals.linkTask"),
                screen.linkTask,
                idle && targets.some((task) => task.id === screen.taskId),
              ),
            ]
          : !selected.tasks.length
            ? [
                {
                  id: "goal-tasks-empty",
                  kind: "Text" as const,
                  text: t("goals.noTasks"),
                  secondary: true,
                },
              ]
            : []),
      ]),
    );
    const activity: PresentationNode[] = [
      iconAction(
        "goal-activity-refresh",
        t("presentation.retry"),
        "arrow.clockwise",
        () => data.readActivity(selected.id),
        !data.activityBusy,
      ),
    ];
    if (data.activityBusy)
      activity.push({
        id: "goal-activity-busy",
        kind: "Progress",
        label: t("backgroundInbox.loading"),
      });
    if (data.activityError)
      activity.push({
        id: "goal-activity-error",
        kind: "Banner",
        status: "error",
        label: data.activityError.startsWith("goals.") ? t(data.activityError) : data.activityError,
      });
    const page = data.activity?.goalId === selected.id ? data.activity : null;
    for (const item of page?.items ?? []) {
      const label =
        item.kind === "run"
          ? t(
              item.state === "done"
                ? item.success
                  ? "goals.runSucceeded"
                  : "goals.runFailed"
                : item.state === "expired"
                  ? "goals.runExpired"
                  : item.state === "leased"
                    ? "goals.runRunning"
                    : item.state === "pending"
                      ? "goals.runPending"
                      : "goals.runWaiting",
            )
          : t(`goals.activity.${item.kind}`);
      activity.push({
        id: `goal-activity:${item.id}`,
        kind: "VStack",
        variant: "goal-activity",
        children: [
          { id: `goal-activity:${item.id}:title`, kind: "Heading", text: item.label },
          { id: `goal-activity:${item.id}:status`, kind: "Text", text: label, secondary: true },
          ...(item.output
            ? [
                {
                  id: `goal-activity:${item.id}:preview`,
                  kind: "Text" as const,
                  text: Array.from(item.output.replace(/\s+/g, " ").trim()).slice(0, 280).join(""),
                  secondary: true,
                },
              ]
            : []),
          {
            id: `goal-activity:${item.id}:time`,
            kind: "Text",
            text: connectorObservationTime(item.at, locale),
            secondary: true,
          },
          ...(item.output
            ? [
                c.action(`goal-activity:${item.id}:open`, t("goals.output"), () =>
                  screen.expand(screen.expanded === item.id ? null : item.id),
                ),
                ...(screen.expanded === item.id
                  ? [
                      {
                        id: `goal-activity:${item.id}:output`,
                        kind: "CodeBlock" as const,
                        language: "text",
                        text: item.output,
                      },
                    ]
                  : []),
              ]
            : []),
        ],
      });
    }
    if (page?.nextCursor)
      activity.push(
        c.action(
          "goal-activity-more",
          t("presentation.loadMore"),
          () => data.readActivity(selected.id, page.nextCursor),
          !data.activityBusy,
        ),
      );
    if (page && !page.items.length && !data.activityBusy && !data.activityError)
      activity.push({ id: "goal-activity-empty", kind: "Text", text: t("goals.noActivity") });
    nodes.push(c.group("goal-activity", t("goals.activity"), activity));
  } else {
    const goals =
      snapshot?.goals.filter(
        (goal) => !goal.config.parentId && (screen.showCompleted || goal.status !== "completed"),
      ) ?? [];
    nodes.push(
      c.group("goals-tracking", t("goals.tracking"), [
        ...goals.map(row),
        {
          ...c.action(
            "goals-show-completed",
            t(screen.showCompleted ? "goals.hideCompleted" : "goals.showCompleted"),
            screen.toggleCompleted,
          ),
          variant: "ghost",
        },
        ...(snapshot && !goals.length && !data.busy && !data.error
          ? [{ id: "goals-empty", kind: "Text" as const, text: t("goals.empty") }]
          : []),
      ]),
      c.group(
        "goals-create",
        t("goals.create"),
        GOAL_CATEGORIES.map((category) => ({
          ...c.action(
            `goals-create:${category}`,
            t(`goals.category.${category}`),
            () => screen.create(category),
            idle && !!snapshot,
          ),
          kind: "NavigationRow" as const,
          variant: "goal-category",
          icon: categoryIcons[category],
        })),
      ),
    );
  }
  for (const node of nodes) if (node.kind === "SettingsGroup") node.variant = "goal-section";
  for (const handler of c.handlers.values()) {
    const run = handler.run;
    handler.run = (value) => (screen.current() ? run(value) : undefined);
  }
  return { nodes, handlers: c.handlers };
}
