import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Section, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { invoke } from "@xagent/runtime";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  Eye,
  Globe,
  MessageSquare,
  Pencil,
  Terminal,
  Trash2,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  applyCronOps,
  type CronTask,
  type CronTaskType,
  useAutomation,
} from "../../lib/automation";
import { buildModelOptions } from "../../lib/chat/page/chatPageHelpers";
import { workspaceProjectPathKey } from "../../lib/settings";
import { type CronTaskFormData, CronTaskModal } from "./CronTaskModal";
import { CronTaskViewModal } from "./CronTaskViewModal";
import { AgentActivationSwitch, ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

const TASK_TYPE_ICON: Record<CronTaskType, typeof Terminal> = {
  bash: Terminal,
  http: Globe,
  prompt: MessageSquare,
};

const TASK_TYPE_LABEL: Record<CronTaskType, string> = {
  bash: "settings.cronTypeBash",
  http: "settings.cronTypeHttp",
  prompt: "settings.cronTypePrompt",
};

type DetailState =
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
  const [detail, setDetail] = useState<DetailState>({ open: false });
  const [actionError, setActionError] = useState<string | null>(null);
  const { cron } = useAutomation();
  const tasks = cron.tasks;
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
    setDetail({ open: false });
  }

  async function handleEdit(data: CronTaskFormData) {
    if (!detail.open || detail.mode !== "edit" || !detail.task) return;
    setActionError(null);
    await applyCronOps([{ op: "update", id: detail.task.id, patch: { ...data } }]);
    setDetail({ open: false });
  }

  async function pickWorkdirDirectory(initialWorkdir: string): Promise<string | null> {
    return await invoke<string | null>("system_pick_folder", {
      initial_workdir: initialWorkdir || undefined,
    });
  }

  function handleToggle(task: CronTask) {
    if (isCronTaskExhausted(task)) return;
    runOps(() => applyCronOps([{ op: "update", id: task.id, patch: { enabled: !task.enabled } }]));
  }

  if (detail.open && detail.mode === "view") {
    return <CronTaskViewModal taskId={detail.taskId} onClose={() => setDetail({ open: false })} />;
  }

  if (detail.open) {
    return (
      <CronTaskModal
        mode={detail.mode}
        initialData={detail.task}
        modelOptions={modelOptions}
        workspaceOptions={workspaceOptions}
        executionMode={settings.system.executionMode}
        onPickWorkdir={pickWorkdirDirectory}
        onSave={detail.mode === "add" ? handleAdd : handleEdit}
        onClose={() => setDetail({ open: false })}
      />
    );
  }

  return (
    <VStack width="100%" gap={4}>
      {tasks.length > 0 ? (
        <Section variant="transparent" padding={0}>
          <HStack width="100%" gap={2} vAlign="center" hAlign="end" wrap="wrap">
            <Badge label={tasks.length} variant="neutral" />
            <Button
              label={t("settings.cronAdd")}
              variant="secondary"
              size="sm"
              onClick={() => setDetail({ open: true, mode: "add" })}
            />
          </HStack>
        </Section>
      ) : null}

      {actionError ? (
        <Banner
          status="error"
          title={actionError}
          icon={<Icon icon={AlertTriangle} size="sm" color="inherit" />}
          collapsible={false}
        />
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState
          isCompact
          icon={<Icon icon={Clock3} size="lg" color="secondary" />}
          title={t("settings.cronEmpty")}
          description={t("settings.cronEmptyDesc")}
          actions={
            <Button
              label={t("settings.cronAdd")}
              variant="secondary"
              size="sm"
              onClick={() => setDetail({ open: true, mode: "add" })}
            />
          }
        />
      ) : (
        <List density="balanced" hasDividers>
          {tasks.map((task) => {
            const exhausted = isCronTaskExhausted(task);
            const switchTitle = exhausted
              ? t("settings.cronRemainingExecutionsEditRequired")
              : task.enabled
                ? t("settings.cronDisable")
                : t("settings.cronEnable");
            return (
              <ListItem
                key={task.id}
                label={task.name}
                startContent={
                  <Icon
                    icon={TASK_TYPE_ICON[task.type]}
                    size="md"
                    color={task.enabled && !exhausted ? "primary" : "disabled"}
                  />
                }
                description={
                  <VStack gap={1}>
                    {task.description ? (
                      <Text type="supporting" color="secondary" wordBreak="break-word">
                        {task.description}
                      </Text>
                    ) : null}
                    <HStack gap={2} wrap="wrap" vAlign="center">
                      <Text type="supporting" color="secondary">
                        {t(TASK_TYPE_LABEL[task.type])}
                      </Text>
                      <Text type="supporting" color="secondary">
                        {task.cron}
                      </Text>
                      <Text type="supporting" color={exhausted ? "disabled" : "secondary"}>
                        {formatRemainingExecutionsLabel(t, task)}
                      </Text>
                      {task.lastError ? (
                        <StatusDot variant="error" label={t("settings.cronScheduleError")} />
                      ) : null}
                    </HStack>
                  </VStack>
                }
                endContent={
                  <HStack gap={1} vAlign="center">
                    <IconButton
                      label={t("settings.cronView")}
                      tooltip={t("settings.cronView")}
                      icon={<Icon icon={Eye} size="sm" color="inherit" />}
                      variant="ghost"
                      size="sm"
                      onClick={() => setDetail({ open: true, mode: "view", taskId: task.id })}
                    />
                    <IconButton
                      label={t("settings.cronEdit")}
                      tooltip={t("settings.cronEdit")}
                      icon={<Icon icon={Pencil} size="sm" color="inherit" />}
                      variant="ghost"
                      size="sm"
                      onClick={() => setDetail({ open: true, mode: "edit", task })}
                    />
                    <ConfirmDeletePopover
                      name={task.name}
                      onConfirm={() => runOps(() => applyCronOps([{ op: "delete", id: task.id }]))}
                    >
                      {(open) => (
                        <IconButton
                          label={t("settings.cronDelete")}
                          tooltip={t("settings.cronDelete")}
                          icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          onClick={open}
                        />
                      )}
                    </ConfirmDeletePopover>
                    <AgentActivationSwitch
                      checked={task.enabled}
                      disabled={exhausted}
                      title={switchTitle}
                      onToggle={() => handleToggle(task)}
                    />
                  </HStack>
                }
              />
            );
          })}
        </List>
      )}
    </VStack>
  );
}
