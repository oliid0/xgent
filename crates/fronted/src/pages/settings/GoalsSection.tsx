import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { getLanPcCommandHostConfig } from "@xgent/runtime";
import { useEffect, useRef, useState } from "react";
import { useConfirmDialog } from "../../components/astryx/useConfirmDialog";
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Download,
  FileText,
  Heart,
  Laptop,
  MoreHorizontal,
  Palette,
  Plus,
  RefreshCw,
  Users,
  Wallet,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import type { GoalCategory, GoalRecord, GoalStatus } from "../../lib/automation/goals";
import { useGoalLaunch } from "../../lib/automation/useGoalLaunch";
import { useGoals } from "../../lib/automation/useGoals";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { createUuid } from "../../lib/shared/id";
import { useMobileBackNavigation } from "../../lib/useMobileBackNavigation";
import { type GoalDraft, goalNodes } from "../../presentation/goalNodes";
import { NativeSettingsContent } from "../../presentation/NativeSettingsContent";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type {
  PresentationHandler,
  PresentationNode,
  PresentationValue,
} from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import type { SettingsSectionProps } from "./types";

export function GoalsSection(
  props: SettingsSectionProps & { onBack: () => void; nativePresentationMode?: "root" | "sheet" },
) {
  const { t, locale } = useLocale(),
    data = useGoals(),
    { confirm, dialog } = useConfirmDialog();
  const launch = useGoalLaunch(data);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [draft, setDraft] = useState<GoalDraft | null>(null),
    [showCompleted, setShowCompleted] = useState(false);
  const [stepTitle, setStepTitle] = useState(""),
    [taskId, setTaskId] = useState(""),
    [expanded, setExpanded] = useState<string | null>(null);
  const [surfaceError, setSurfaceError] = useState("");
  const [workId, setWorkId] = useState(""),
    [artifactsOpen, setArtifactsOpen] = useState(false);
  const previousStore = useRef<string | null>(null);
  const selected = data.snapshot?.goals.find((goal) => goal.id === selectedId) ?? null;
  const lifetime = useRef(true),
    view = useRef({ signature: "", version: 0 });
  const signature = JSON.stringify([
    data.snapshot?.storeId,
    data.snapshot?.revision,
    selectedId,
    draft,
    artifactsOpen,
    launch.draft,
  ]);
  if (signature !== view.current.signature)
    view.current = { signature, version: view.current.version + 1 };
  const version = view.current.version;
  const current = () => lifetime.current && view.current.version === version;
  const retireView = () => {
    view.current.version++;
  };
  useEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false;
      view.current.version++;
    };
  }, []);
  useEffect(() => {
    const store = data.snapshot?.storeId ?? null;
    if (previousStore.current && previousStore.current !== store) {
      setDraft(null);
      setSelectedId(null);
      setStepTitle("");
      setTaskId("");
      setExpanded(null);
      setWorkId("");
      setArtifactsOpen(false);
    }
    previousStore.current = store;
  }, [data.snapshot?.storeId]);
  useEffect(() => {
    if (selected && !draft) void data.readActivity(selected.id);
  }, [selected, draft, data.readActivity]);
  useEffect(() => {
    if (selectedId && artifactsOpen && !draft) void data.readArtifacts(selectedId);
  }, [selectedId, artifactsOpen, draft, data.readArtifacts]);
  const back = () => {
    retireView();
    if (launch.draft) launch.close();
    else if (artifactsOpen) {
      setArtifactsOpen(false);
      data.retireArtifacts();
    } else if (draft) setDraft(null);
    else if (selectedId) {
      setSelectedId(null);
      data.retireActivity();
    } else props.onBack();
    setStepTitle("");
    setTaskId("");
    setExpanded(null);
    setWorkId("");
  };
  useMobileBackNavigation(true, back, 30);
  const create = (category: GoalCategory, parentId?: string) => {
    retireView();
    setArtifactsOpen(false);
    if (data.snapshot)
      setDraft({
        id: createUuid(),
        storeId: data.snapshot.storeId,
        revision: data.snapshot.revision,
        editing: false,
        config: { title: "", description: "", category, parentId: parentId ?? null, steps: [] },
      });
  };
  const setStatus = async (goal: GoalRecord, status: GoalStatus) => {
    if (
      status !== "active" &&
      (goal.tasks.some((task) => task.exists && task.enabled) ||
        (goal.backgroundTasks ?? []).some(
          (task) =>
            task.exists && ["pending", "leased", "waiting", "suspended"].includes(task.state ?? ""),
        ))
    ) {
      const accepted = await confirm({
        title: t(status === "paused" ? "goals.pause" : "goals.complete"),
        description: t("goals.independentTasks"),
        confirmLabel: t(status === "paused" ? "goals.pause" : "goals.complete"),
        cancelLabel: t("settings.cancel"),
        tone: "warning",
      });
      if (!accepted || !current()) return;
    }
    await data.apply({ op: "set_status", id: goal.id, status }, data.snapshot?.revision ?? 0);
  };
  const remove = async (goal: GoalRecord) => {
    const accepted = await confirm({
      title: t("settings.delete"),
      detail: goal.config.title,
      confirmLabel: t("settings.delete"),
      cancelLabel: t("settings.cancel"),
      tone: "destructive",
    });
    if (!accepted || !current()) return;
    if (await data.apply({ op: "delete", id: goal.id }, data.snapshot?.revision ?? 0)) {
      if (selectedId === goal.id) setSelectedId(null);
    }
  };
  const content = goalNodes(
    {
      scope: String(version),
      current,
      data,
      launch,
      selected,
      draft,
      showCompleted,
      stepTitle,
      taskId,
      expanded,
      workId,
      setWorkId,
      artifactsOpen,
      openArtifacts: () => {
        retireView();
        setArtifactsOpen(true);
      },
      linkWork: async () => {
        if (
          selected &&
          data.snapshot &&
          (await data.apply(
            { op: "link_work", id: selected.id, request_id: workId },
            data.snapshot.revision,
          ))
        )
          setWorkId("");
      },
      download: async (artifact) => {
        if (!selected) return;
        const host = getLanPcCommandHostConfig();
        const workdir = host.enabled ? (host.localWorkdir ?? "") : props.settings.system.workdir;
        await data.downloadArtifact(selected.id, artifact, workdir, current);
      },
      back,
      open: (id) => {
        retireView();
        setSelectedId(id);
        setExpanded(null);
        setStepTitle("");
        setTaskId("");
        data.retireActivity();
        setWorkId("");
        setArtifactsOpen(false);
        data.retireArtifacts();
      },
      create,
      edit: (goal) => {
        retireView();
        setArtifactsOpen(false);
        data.retireArtifacts();
        if (data.snapshot)
          setDraft({
            id: goal.id,
            storeId: data.snapshot.storeId,
            revision: data.snapshot.revision,
            editing: true,
            config: { ...goal.config, steps: goal.config.steps.map((step) => ({ ...step })) },
          });
      },
      patch: (field, value) => {
        retireView();
        setDraft((previous) =>
          previous ? { ...previous, config: { ...previous.config, [field]: value } } : null,
        );
      },
      save: async () => {
        if (
          draft &&
          draft.storeId === data.snapshot?.storeId &&
          (await data.apply(
            { op: draft.editing ? "update" : "create", id: draft.id, config: draft.config },
            draft.editing ? draft.revision : data.snapshot.revision,
          ))
        ) {
          setSelectedId(draft.id);
          setDraft(null);
        }
      },
      setStepTitle,
      addStep: async () => {
        if (
          selected &&
          data.snapshot &&
          (await data.apply(
            {
              op: "update",
              id: selected.id,
              config: {
                ...selected.config,
                steps: [
                  ...selected.config.steps,
                  { id: createUuid(), title: stepTitle, done: false },
                ],
              },
            },
            data.snapshot.revision,
          ))
        )
          setStepTitle("");
      },
      setTaskId,
      linkTask: async () => {
        if (
          selected &&
          data.snapshot &&
          (await data.apply(
            { op: "link_task", id: selected.id, task_id: taskId },
            data.snapshot.revision,
          ))
        )
          setTaskId("");
      },
      remove,
      setStatus,
      toggleCompleted: () => setShowCompleted((value) => !value),
      expand: setExpanded,
    },
    t,
    locale,
  );
  if (surfaceError)
    content.nodes.push({
      id: "goals-surface-error",
      kind: "Banner",
      status: "error",
      label: surfaceError,
    });
  if (isApplePresentationRuntime()) {
    const Surface = props.nativeOtherSink ? NativeSettingsContent : NativeSurface;
    return (
      <>
        <Surface
          sink={props.nativeOtherSink}
          detail
          sessionSurface={props.nativeSettingsSurfaceId}
          document={{
            mode: props.nativePresentationMode ?? "sheet",
            title: t("goals.title"),
            appearance: props.settings.theme,
            formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
            theme: createNativePresentationTheme(
              props.settings,
              isNativeMobileRuntime(),
              "workspaceTools",
            ),
            dismissAction: content.nodes[0].children?.[0].action,
            nodes: content.nodes,
          }}
          handlers={content.handlers}
          onError={(failure) => setSurfaceError(String(failure))}
        />
        {dialog}
      </>
    );
  }
  return (
    <>
      <GoalComponents nodes={content.nodes} handlers={content.handlers} />
      {dialog}
    </>
  );
}

const glyphs: Record<string, typeof Circle> = {
  "doc.text": FileText,
  heart: Heart,
  "person.2": Users,
  "building.2": Building2,
  banknote: Wallet,
  paintpalette: Palette,
  laptopcomputer: Laptop,
  clock: Clock3,
};

export function GoalComponents({
  nodes,
  handlers,
}: {
  nodes: PresentationNode[];
  handlers: ReadonlyMap<string, PresentationHandler>;
}) {
  const send = (node: PresentationNode, value: PresentationValue = null) => {
    const handler = node.action ? handlers.get(node.action) : null;
    if (handler?.enabled && handler.accepts(value)) void handler.run(value);
  };
  const render = (node: PresentationNode): React.ReactNode => {
    if (node.variant === "goal-association") {
      const [name, state, menu] = node.children ?? [],
        Glyph = glyphs[node.icon ?? ""] ?? Circle;
      return (
        <List key={node.id} density="balanced">
          <ListItem
            className="goal-association-row"
            label={<Text wordBreak="break-word">{name.text}</Text>}
            description={
              <Text color="secondary" type="supporting" wordBreak="break-word">
                {state.text}
              </Text>
            }
            startContent={<Glyph />}
            endContent={render(menu)}
          />
        </List>
      );
    }
    if (node.variant === "goal-activity") {
      const children = node.children ?? [],
        open = children.find((child) => child.kind === "Button"),
        output = children.find((child) => child.kind === "CodeBlock"),
        title = children.find((child) => child.kind === "Heading");
      return (
        <div key={node.id} className="goal-activity-row">
          <List density="balanced">
            <ListItem
              className="goal-activity-entry"
              label={
                <Text wordBreak="break-word" style={{ fontWeight: 600 }}>
                  {title?.text}
                </Text>
              }
              description={
                <VStack gap={1}>
                  {children
                    .filter((child) => child.kind === "Text")
                    .map((child) => (
                      <Text
                        key={child.id}
                        type="supporting"
                        color="secondary"
                        wordBreak="break-word"
                        maxLines={child.id.endsWith(":preview") ? 2 : undefined}
                      >
                        {child.text}
                      </Text>
                    ))}
                </VStack>
              }
              endContent={open ? <ChevronRight aria-hidden /> : undefined}
              onClick={open ? () => send(open) : undefined}
              isDisabled={open?.disabled}
            />
          </List>
          {output ? render(output) : null}
        </div>
      );
    }
    if (node.variant === "goal-row") {
      const [check, open, menu] = node.children ?? [];
      return (
        <List key={node.id} density="balanced">
          <ListItem
            className="goal-row"
            label={<Text wordBreak="break-word">{open.label}</Text>}
            description={
              open.text ? (
                <Text color="secondary" type="supporting" maxLines={2} wordBreak="break-word">
                  {open.text}
                </Text>
              ) : undefined
            }
            startContent={
              <CheckboxInput
                className="goal-check"
                label={check.label ?? ""}
                isLabelHidden
                value={check.value === true}
                onChange={(value) => send(check, value)}
                isDisabled={check.disabled}
              />
            }
            endContent={render(menu)}
            onClick={() => send(open)}
          />
        </List>
      );
    }
    if (node.kind === "Menu")
      return (
        <DropdownMenu
          key={node.id}
          presentation="adaptive"
          alignment="end"
          hasChevron={false}
          button={{
            label: node.label ?? "",
            icon: <MoreHorizontal />,
            isIconOnly: true,
            variant: "ghost",
            size: "lg",
          }}
          items={(node.children ?? []).map((item) => ({
            label: item.label ?? "",
            variant: item.destructive ? ("destructive" as const) : undefined,
            isDisabled: item.disabled,
            onClick: () => send(item),
          }))}
        />
      );
    if (node.kind === "Switch")
      return (
        <CheckboxInput
          key={node.id}
          className="goal-step"
          label={node.label ?? ""}
          value={node.value === true}
          onChange={(value) => send(node, value)}
          isDisabled={node.disabled}
        />
      );
    if (node.variant === "goal-artifact")
      return (
        <List key={node.id} density="balanced">
          <ListItem
            className="goal-file-row"
            label={<Text wordBreak="break-word">{node.label}</Text>}
            description={
              <VStack gap={0}>
                <Text type="supporting" color="secondary" wordBreak="break-word">
                  {node.text}
                </Text>
                {node.value ? (
                  <Text type="supporting" color="secondary">
                    {String(node.value)}
                  </Text>
                ) : null}
              </VStack>
            }
            startContent={<FileText />}
            endContent={
              node.status === "running" ? (
                <Spinner aria-label={node.label} />
              ) : node.status === "completed" ? (
                <Check />
              ) : (
                <Download />
              )
            }
            onClick={() => send(node)}
            isDisabled={node.disabled}
          />
        </List>
      );
    if (node.variant === "goal-artifacts-nav")
      return (
        <List key={node.id} density="balanced">
          <ListItem
            className="goal-category"
            label={node.label ?? ""}
            startContent={<FileText />}
            endContent={
              <HStack gap={2} vAlign="center">
                <Text color="secondary">{String(node.value ?? 0)}</Text>
                <ChevronRight />
              </HStack>
            }
            onClick={() => send(node)}
            isDisabled={node.disabled}
          />
        </List>
      );
    if (node.kind === "NavigationRow") {
      const Glyph = glyphs[node.icon ?? ""] ?? Circle;
      return (
        <List key={node.id} density="balanced">
          <ListItem
            className="goal-category"
            label={node.label ?? ""}
            startContent={<Glyph />}
            endContent={<Plus />}
            onClick={() => send(node)}
            isDisabled={node.disabled}
          />
        </List>
      );
    }
    if (node.kind === "IconButton")
      return (
        <IconButton
          key={node.id}
          label={node.label ?? ""}
          icon={node.icon === "chevron.left" ? <ChevronLeft /> : <RefreshCw />}
          variant="ghost"
          size="lg"
          onClick={() => send(node)}
          isDisabled={node.disabled}
        />
      );
    if (node.kind === "Heading")
      return (
        <Heading
          key={node.id}
          level={node.id === "goals-title" ? 1 : 3}
          style={{ overflowWrap: "anywhere" }}
        >
          {node.text}
        </Heading>
      );
    if (node.kind === "Spacer") return <StackItem key={node.id} size="fill" />;
    if (node.kind === "Banner")
      return <Banner key={node.id} status="error" title={node.label} collapsible={false} />;
    if (node.kind === "Progress") return <Spinner key={node.id} aria-label={node.label} />;
    if (node.kind === "TextInput" || node.kind === "TextArea") {
      const Field = node.kind === "TextArea" ? TextArea : TextInput;
      return (
        <Field
          key={node.id}
          label={node.label ?? ""}
          value={typeof node.value === "string" ? node.value : ""}
          onChange={(value) => send(node, value)}
          isDisabled={node.disabled}
          width="100%"
          size="lg"
        />
      );
    }
    if (node.kind === "Selector")
      return (
        <Selector
          key={node.id}
          label={node.label ?? ""}
          value={typeof node.value === "string" ? node.value : ""}
          options={node.options ?? []}
          onChange={(value) => send(node, value)}
          isDisabled={node.disabled}
          presentation="adaptive"
          width="100%"
          size="lg"
        />
      );
    if (node.kind === "Button")
      return (
        <Button
          key={node.id}
          label={node.label ?? ""}
          size="lg"
          variant={
            node.destructive ? "destructive" : node.variant === "ghost" ? "ghost" : "secondary"
          }
          isDisabled={node.disabled}
          onClick={() => send(node)}
        />
      );
    if (node.kind === "Badge")
      return (
        <Text key={node.id} type="supporting" color="secondary">
          {node.label}
        </Text>
      );
    if (node.kind === "CodeBlock")
      return (
        <pre key={node.id} className="goal-output">
          {node.text}
        </pre>
      );
    if (node.children) {
      const children = (
        <>
          {node.label ? <Heading level={3}>{node.label}</Heading> : null}
          {node.children.map(render)}
        </>
      );
      return node.kind === "HStack" ? (
        <HStack key={node.id} gap={2} wrap="wrap" vAlign="center">
          {children}
        </HStack>
      ) : (
        <VStack
          key={node.id}
          gap={3}
          className={
            node.id === "goals-tracking"
              ? "goal-tracking"
              : node.variant === "goal-activity"
                ? "goal-activity-row"
                : "goal-section"
          }
        >
          {children}
        </VStack>
      );
    }
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
  return (
    <VStack gap={4} width="100%" className="goals-components">
      {nodes.map(render)}
    </VStack>
  );
}
