import { invoke } from "@xagent/runtime";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import {
  Heading as AstryxHeading,
  Inline as AstryxInline,
  Paragraph as AstryxParagraph,
  View as AstryxView,
} from "@xagent/ui/components/ui/view";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  Eye,
  Globe,
  MessageSquare,
  Pencil,
  Plus,
  Terminal,
  Trash2,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import {
  applyCronOps,
  type CronTask,
  type CronTaskType,
  useAutomation,
} from "../../lib/automation";
import { buildModelOptions } from "../../lib/chat/page/chatPageHelpers";
import { isAgentExecutionMode, workspaceProjectPathKey } from "../../lib/settings";
import { type CronTaskFormData, CronTaskModal } from "./CronTaskModal";
import { CronTaskViewModal } from "./CronTaskViewModal";
import { AgentActivationSwitch, ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

const TASK_TYPE_ICON: Record<CronTaskType, typeof Terminal> = {
  bash: Terminal,
  http: Globe,
  prompt: MessageSquare,
};

const TASK_TYPE_TONE: Record<CronTaskType, { bg: string; text: string; label: string }> = {
  bash: {
    bg: "bg-blue-500/10",
    text: "text-blue-600 dark:text-blue-400",
    label: "settings.cronTypeBash",
  },
  http: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    label: "settings.cronTypeHttp",
  },
  prompt: {
    bg: "bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
    label: "settings.cronTypePrompt",
  },
};

type ModalState =
  | { open: false }
  | { open: true; mode: "add" | "edit"; task?: CronTask }
  | { open: true; mode: "view"; taskId: string };

function isCronTaskExhausted(task: CronTask) {
  return task.remainingExecutions === 0;
}

function formatRemainingExecutionsLabel(t: (key: string) => string, task: CronTask) {
  return task.remainingExecutions == null
    ? t("settings.cronRemainingExecutionsUnlimited")
    : `${task.remainingExecutions} ${t("settings.cronRemainingExecutionsUnit")}`;
}

export function CronSection(props: SettingsSectionProps) {
  const { settings } = props;
  const { t } = useLocale();
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [actionError, setActionError] = useState<string | null>(null);
  const { cron } = useAutomation();
  const tasks = cron.tasks;
  const autoPromptSupported = isAgentExecutionMode(settings.system.executionMode);
  const modelOptions = useMemo(
    () =>
      buildModelOptions(settings).map((option) => ({
        value: option.value,
        label: option.label,
        providerName: option.providerName,
        providerId: option.providerId,
        providerType: option.providerType,
      })),
    [settings],
  );
  // Archived/hidden workspaces are not offered for pinning; a task already
  // pinned to one keeps its path (the modal shows it as unavailable).
  const workspaceOptions = useMemo(() => {
    const excludedPathKeys = new Set(
      [
        ...settings.system.archivedWorkspaceProjectPaths,
        ...settings.system.hiddenWorkspaceProjectPaths,
      ].map(workspaceProjectPathKey),
    );
    return settings.system.workspaceProjects
      .filter((project) => !excludedPathKeys.has(workspaceProjectPathKey(project.path)))
      .map((project) => ({ path: project.path, name: project.name || project.path }));
  }, [settings]);

  function runOps(run: () => Promise<unknown>) {
    setActionError(null);
    void run().catch((error) => {
      setActionError(error instanceof Error ? error.message : String(error));
    });
  }

  async function handleAdd(data: CronTaskFormData) {
    setActionError(null);
    await applyCronOps([{ op: "create", item: { ...data, enabled: true } }]);
    setModal({ open: false });
  }

  async function handleEdit(data: CronTaskFormData) {
    if (!modal.open || modal.mode !== "edit" || !modal.task) return;
    setActionError(null);
    await applyCronOps([{ op: "update", id: modal.task.id, patch: { ...data } }]);
    setModal({ open: false });
  }

  function handleDelete(id: string) {
    runOps(() => applyCronOps([{ op: "delete", id }]));
  }

  async function pickWorkdirDirectory(initialWorkdir: string): Promise<string | null> {
    // The command is rename_all=snake_case: a camelCase key would silently
    // deserialize the Option param as None (see memory: tauri-invoke-snake_case).
    return await invoke<string | null>("system_pick_folder", {
      initial_workdir: initialWorkdir || undefined,
    });
  }

  function handleToggle(task: CronTask) {
    if (isCronTaskExhausted(task)) return;
    runOps(() => applyCronOps([{ op: "update", id: task.id, patch: { enabled: !task.enabled } }]));
  }

  const enabledCount = tasks.filter((task) => task.enabled).length;

  return (
    <AstryxView layout="block" direction="horizontal" className="settings-cron-section space-y-5">
      {/* Header */}
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="settings-section-heading-row flex items-center justify-between gap-4"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-section-title-group flex items-center gap-3"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10"
          >
            <Clock3 className="h-[18px] w-[18px] text-amber-500" />
          </AstryxView>
          <AstryxView layout="block" direction="horizontal">
            <AstryxHeading level={3} className="text-sm font-semibold">
              {t("settings.cronTitle")}
            </AstryxHeading>
            <AstryxParagraph className="text-xs text-muted-foreground">
              {t("settings.cronDesc")}
            </AstryxParagraph>
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-section-actions flex items-center gap-2"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground"
          >
            <AstryxInline className="tabular-nums font-medium text-foreground">
              {tasks.length}
            </AstryxInline>
            {t("settings.cronCount")}
            <AstryxInline className="text-border">|</AstryxInline>
            <AstryxView
              as="span"
              layout="flex"
              direction="horizontal"
              className="flex items-center gap-1"
            >
              <AstryxInline className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <AstryxInline className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                {enabledCount}
              </AstryxInline>
            </AstryxView>
          </AstryxView>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setModal({ open: true, mode: "add" })}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("settings.cronAdd")}
          </Button>
        </AstryxView>
      </AstryxView>

      {!autoPromptSupported ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300"
        >
          {t("settings.cronPromptAgentModeOnlyHint")}
        </AstryxView>
      ) : null}

      {actionError ? (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <AstryxInline className="min-w-0 flex-1 truncate">{actionError}</AstryxInline>
        </AstryxView>
      ) : null}

      {/* Task List */}
      {tasks.length === 0 ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="rounded-2xl border border-dashed border-border/60 bg-muted/20 py-12 text-center"
        >
          <Clock3 className="mx-auto h-8 w-8 text-muted-foreground/30" />
          <AstryxParagraph className="mt-3 text-sm font-medium text-muted-foreground">
            {t("settings.cronEmpty")}
          </AstryxParagraph>
          <AstryxParagraph className="mt-1 text-xs text-muted-foreground/70">
            {t("settings.cronEmptyDesc")}
          </AstryxParagraph>
        </AstryxView>
      ) : (
        <AstryxView layout="block" direction="horizontal" className="space-y-2">
          {tasks.map((task) => {
            const tone = TASK_TYPE_TONE[task.type];
            const Icon = TASK_TYPE_ICON[task.type];
            const exhausted = isCronTaskExhausted(task);
            const switchTitle = exhausted
              ? t("settings.cronRemainingExecutionsEditRequired")
              : task.enabled
                ? t("settings.cronDisable")
                : t("settings.cronEnable");

            return (
              <AstryxView
                layout="block"
                direction="horizontal"
                key={task.id}
                className={`settings-cron-card group rounded-xl border transition-[border-color,background-color,box-shadow,opacity] ${
                  task.enabled
                    ? "border-border/60 bg-card hover:border-border hover:shadow-sm"
                    : "border-border/40 bg-muted/20 opacity-60 hover:opacity-80"
                }`}
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="settings-card-row settings-cron-card-row flex items-center gap-3 px-4 py-3"
                >
                  {/* Icon */}
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.bg} ${tone.text}`}
                  >
                    <Icon className="h-4 w-4" />
                  </AstryxView>

                  {/* Content */}
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="settings-cron-card-main min-w-0 flex-1"
                  >
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex items-center gap-2"
                    >
                      <AstryxInline className="truncate text-sm font-medium text-foreground">
                        {task.name}
                      </AstryxInline>
                      <AstryxInline
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${tone.bg} ${tone.text}`}
                      >
                        {t(tone.label)}
                      </AstryxInline>
                      {task.lastError ? (
                        <AstryxView
                          as="span"
                          layout="flex"
                          direction="horizontal"
                          title={task.lastError}
                          className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-red-600 dark:text-red-400"
                        >
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {t("settings.cronScheduleError")}
                        </AstryxView>
                      ) : null}
                    </AstryxView>
                    <AstryxParagraph className="mt-0.5 truncate text-xs text-muted-foreground">
                      {task.description}
                    </AstryxParagraph>
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="settings-cron-mobile-meta mt-2 hidden flex-wrap items-center gap-1.5"
                    >
                      <AstryxView
                        as="span"
                        layout="inline-flex"
                        direction="horizontal"
                        className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 font-mono text-[11px] font-medium text-amber-600 dark:text-amber-400"
                      >
                        <Clock3 className="h-3 w-3 shrink-0" />
                        {task.cron}
                      </AstryxView>
                      <AstryxInline
                        className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-[11px] font-medium ${
                          exhausted
                            ? "bg-red-500/10 text-red-600 dark:text-red-400"
                            : task.remainingExecutions == null
                              ? "bg-muted text-muted-foreground"
                              : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                        }`}
                      >
                        {formatRemainingExecutionsLabel(t, task)}
                      </AstryxInline>
                    </AstryxView>
                  </AstryxView>

                  {/* Cron Expression - fixed width for alignment */}
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="hidden w-[140px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 md:flex"
                  >
                    <Clock3 className="h-3 w-3 shrink-0" />
                    <AstryxInline className="font-mono">{task.cron}</AstryxInline>
                  </AstryxView>
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className={`hidden w-[74px] shrink-0 items-center justify-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium md:flex ${
                      exhausted
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : task.remainingExecutions == null
                          ? "bg-muted text-muted-foreground"
                          : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    }`}
                    title={formatRemainingExecutionsLabel(t, task)}
                  >
                    <AstryxInline className="tabular-nums">
                      {task.remainingExecutions == null ? "∞" : task.remainingExecutions}
                    </AstryxInline>
                    {task.remainingExecutions == null ? null : (
                      <AstryxInline>{t("settings.cronRemainingExecutionsUnitShort")}</AstryxInline>
                    )}
                  </AstryxView>

                  {/* Actions */}
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="settings-hover-actions settings-cron-card-actions flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                  >
                    <AstryxButton
                      type="button"
                      onClick={() => setModal({ open: true, mode: "view", taskId: task.id })}
                      className="settings-cron-action flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      title={t("settings.cronView")}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </AstryxButton>
                    <AstryxButton
                      type="button"
                      onClick={() => setModal({ open: true, mode: "edit", task })}
                      className="settings-cron-action flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      title={t("settings.cronEdit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </AstryxButton>
                    <ConfirmDeletePopover name={task.name} onConfirm={() => handleDelete(task.id)}>
                      {(open) => (
                        <AstryxButton
                          type="button"
                          onClick={open}
                          className="settings-cron-action flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title={t("settings.cronDelete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </AstryxButton>
                      )}
                    </ConfirmDeletePopover>
                  </AstryxView>

                  {/* Enable/Disable Switch */}
                  <AstryxView
                    as="span"
                    layout="inline-flex"
                    direction="horizontal"
                    className="inline-flex"
                    title={switchTitle}
                  >
                    <AgentActivationSwitch
                      checked={task.enabled}
                      disabled={exhausted}
                      title={switchTitle}
                      onToggle={() => handleToggle(task)}
                    />
                  </AstryxView>
                </AstryxView>
              </AstryxView>
            );
          })}
        </AstryxView>
      )}

      {/* Edit/Add Modal */}
      {modal.open && modal.mode !== "view" ? (
        <CronTaskModal
          mode={modal.mode}
          initialData={modal.task}
          modelOptions={modelOptions}
          workspaceOptions={workspaceOptions}
          executionMode={settings.system.executionMode}
          onPickWorkdir={pickWorkdirDirectory}
          onSave={modal.mode === "add" ? handleAdd : handleEdit}
          onClose={() => setModal({ open: false })}
        />
      ) : null}

      {/* View Modal */}
      {modal.open && modal.mode === "view" ? (
        <CronTaskViewModal taskId={modal.taskId} onClose={() => setModal({ open: false })} />
      ) : null}
    </AstryxView>
  );
}
