import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Section, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { invoke } from "@xgent/runtime";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Clock3,
  Eye,
  MoreHorizontal,
  Pencil,
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
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { workspaceProjectPathKey } from "../../lib/settings";
import { presentationControls } from "../../presentation/controls";
import { NativeSettingsContent } from "../../presentation/NativeSettingsContent";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import { BackgroundInboxSection } from "./BackgroundInboxSection";
import { type CronTaskFormData, CronTaskModal } from "./CronTaskModal";
import { CronTaskViewModal } from "./CronTaskViewModal";
import { ProactiveRulesSection } from "./ProactiveRulesSection";
import { AgentActivationSwitch, ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

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

export function CronSection(
  props: SettingsSectionProps & {
    onBack?: () => void;
    openCreateImmediately?: boolean;
    nativePresentationMode?: "root" | "sheet";
  },
) {
  const { settings } = props;
  const { t } = useLocale();
  const [detail, setDetail] = useState<DetailState>(
    props.openCreateImmediately ? { open: true, mode: "add" } : { open: false },
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [proactiveOpen, setProactiveOpen] = useState(false);
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
  }

  async function handleEdit(data: CronTaskFormData) {
    if (!detail.open || detail.mode !== "edit" || !detail.task) return;
    setActionError(null);
    await applyCronOps([{ op: "update", id: detail.task.id, patch: { ...data } }]);
  }

  async function pickWorkdirDirectory(initialWorkdir: string): Promise<string | null> {
    return await invoke<string | null>("system_pick_folder", {
      initial_workdir: initialWorkdir || undefined,
    });
  }

  function handleToggle(task: CronTask) {
    if (isCronTaskExhausted(task)) return;
    return applyCronOps([{ op: "update", id: task.id, patch: { enabled: !task.enabled } }]);
  }

  if (inboxOpen) return <BackgroundInboxSection {...props} onBack={() => setInboxOpen(false)} />;
  if (proactiveOpen)
    return <ProactiveRulesSection {...props} onBack={() => setProactiveOpen(false)} />;

  if (detail.open && detail.mode === "view") {
    return (
      <CronTaskViewModal
        settings={settings}
        nativeSettingsSurfaceId={props.nativeSettingsSurfaceId}
        nativeOtherSink={props.nativeOtherSink}
        taskId={detail.taskId}
        nativePresentationMode={props.nativePresentationMode}
        onClose={() => setDetail({ open: false })}
      />
    );
  }

  if (detail.open) {
    return (
      <CronTaskModal
        settings={settings}
        nativeSettingsSurfaceId={props.nativeSettingsSurfaceId}
        nativeOtherSink={props.nativeOtherSink}
        mode={detail.mode}
        nativePresentationMode={props.nativePresentationMode}
        initialData={detail.task}
        modelOptions={modelOptions}
        workspaceOptions={workspaceOptions}
        executionMode={settings.system.executionMode}
        onPickWorkdir={pickWorkdirDirectory}
        onSave={detail.mode === "add" ? handleAdd : handleEdit}
        onClose={() => {
          if (props.openCreateImmediately && detail.mode === "add")
            window.setTimeout(() => props.onBack?.(), 0);
          else setDetail({ open: false });
        }}
      />
    );
  }

  if (isApplePresentationRuntime()) {
    const RootSurface = props.nativeOtherSink ? NativeSettingsContent : NativeSurface;
    const c = presentationControls();
    c.handlers.set("close", {
      enabled: true,
      accepts: (value) => value === null,
      run: () => props.onBack?.(),
    });
    const nodes: PresentationNode[] = [
      c.action("background-inbox", t("backgroundInbox.title"), () => setInboxOpen(true)),
      c.action("proactive", t("proactive.title"), () => setProactiveOpen(true)),
      c.action("add", t("settings.cronAdd"), () => setDetail({ open: true, mode: "add" })),
      ...(tasks.length
        ? []
        : [{ id: "empty", kind: "Text" as const, text: t("settings.cronEmpty") }]),
      ...tasks.map((task) => ({
        ...c.group(task.id, task.name, [
          { id: `${task.id}:type`, kind: "Badge", label: t(TASK_TYPE_LABEL[task.type]) },
          { id: `${task.id}:schedule`, kind: "Badge", label: task.cron },
          {
            id: `${task.id}:remaining`,
            kind: "Badge",
            label: formatRemainingExecutionsLabel(t, task),
            status: isCronTaskExhausted(task) ? "paused" : "pending",
          },
          c.toggle(
            `${task.id}:enabled`,
            t(
              isCronTaskExhausted(task)
                ? "settings.cronRemainingExecutionsEditRequired"
                : task.enabled
                  ? "settings.cronDisable"
                  : "settings.cronEnable",
            ),
            task.enabled,
            () => handleToggle(task),
            !isCronTaskExhausted(task),
          ),
          {
            id: `${task.id}:actions`,
            kind: "Menu",
            variant: "compact",
            label: task.name,
            icon: "ellipsis",
            children: [
              {
                ...c.action(`${task.id}:view`, t("settings.cronViewTitle"), () =>
                  setDetail({ open: true, mode: "view", taskId: task.id }),
                ),
                icon: "eye",
              },
              {
                ...c.action(`${task.id}:edit`, t("settings.cronModalEdit"), () =>
                  setDetail({ open: true, mode: "edit", task }),
                ),
                icon: "pencil",
              },
              {
                ...c.action(`${task.id}:delete`, t("settings.cronDelete"), () =>
                  setDeleteId(task.id),
                ),
                icon: "trash",
                destructive: true,
              },
            ],
          },
          ...(task.lastError
            ? [
                {
                  id: `${task.id}:error`,
                  kind: "Banner" as const,
                  label: t("settings.cronScheduleError"),
                  text: task.lastError,
                  status: "error" as const,
                },
              ]
            : []),
        ]),
        kind: "VStack" as const,
        variant: "automation-row",
        icon: "calendar.badge.clock",
      })),
      ...(actionError ? [{ id: "error", kind: "Text" as const, text: actionError }] : []),
    ];
    const confirmation = presentationControls();
    const cancel = confirmation.action("cancel", t("settings.cancel"), () => setDeleteId(null));
    const remove = confirmation.action("delete", t("settings.cronDelete"), async () => {
      if (deleteId) await applyCronOps([{ op: "delete", id: deleteId }]);
      setDeleteId(null);
    });
    return (
      <>
        <RootSurface
          sink={props.nativeOtherSink}
          sessionSurface={props.nativeSettingsSurfaceId}
          document={{
            mode: props.nativePresentationMode ?? "sheet",
            title: t("settings.navCron"),
            appearance: settings.theme,
            formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
            theme: createNativePresentationTheme(
              settings,
              isNativeMobileRuntime(),
              "workspaceTools",
            ),
            nodes,
            dismissAction: "close",
          }}
          handlers={c.handlers}
          onError={(error) => setActionError(String(error))}
        />
        {deleteId ? (
          <NativeSurface
            document={{
              mode: "alert",
              title: t("settings.cronDelete"),
              appearance: settings.theme,
              nodes: [{ ...remove, destructive: true }, cancel],
              dismissAction: "cancel",
            }}
            handlers={confirmation.handlers}
            onError={(error) => setActionError(String(error))}
          />
        ) : null}
      </>
    );
  }

  return (
    <VStack width="100%" gap={4} className="autonomy-settings autonomy-cron">
      <Button label={t("backgroundInbox.title")} onClick={() => setInboxOpen(true)} />
      <Button label={t("proactive.title")} onClick={() => setProactiveOpen(true)} />
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
                onClick={() => setDetail({ open: true, mode: "view", taskId: task.id })}
                startContent={
                  <span
                    className={`schedule-icon${task.enabled && !exhausted ? "" : " schedule-icon-paused"}`}
                  >
                    <CalendarClock />
                  </span>
                }
                description={
                  <VStack gap={1}>
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
                    <ConfirmDeletePopover
                      name={task.name}
                      onConfirm={() => runOps(() => applyCronOps([{ op: "delete", id: task.id }]))}
                    >
                      {(open) => (
                        <DropdownMenu
                          presentation="adaptive"
                          alignment="end"
                          hasChevron={false}
                          button={{
                            label: task.name,
                            icon: <MoreHorizontal />,
                            isIconOnly: true,
                            variant: "ghost",
                            size: "lg",
                          }}
                          items={[
                            {
                              label: t("settings.cronView"),
                              icon: <Eye />,
                              onClick: () =>
                                setDetail({ open: true, mode: "view", taskId: task.id }),
                            },
                            {
                              label: t("settings.cronEdit"),
                              icon: <Pencil />,
                              onClick: () => setDetail({ open: true, mode: "edit", task }),
                            },
                            { type: "divider" },
                            {
                              label: t("settings.cronDelete"),
                              icon: <Trash2 />,
                              variant: "destructive",
                              onClick: open,
                            },
                          ]}
                        />
                      )}
                    </ConfirmDeletePopover>
                    <AgentActivationSwitch
                      checked={task.enabled}
                      disabled={exhausted}
                      title={switchTitle}
                      onToggle={() => runOps(() => Promise.resolve(handleToggle(task)))}
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
