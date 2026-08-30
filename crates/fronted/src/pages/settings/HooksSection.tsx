import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Section, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Token, type TokenColor } from "@astryxdesign/core/Token";
import { type ReactNode, useState } from "react";
import {
  Bot,
  Globe,
  MessageSquare,
  Pencil,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
  Zap,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  applyHookOps,
  HOOK_EVENT_TRANSLATION_KEYS,
  type HookDef,
  type HookEvent,
  type HookType,
  useAutomation,
} from "../../lib/automation";
import { HookModal } from "./HookModal";
import { AgentActivationSwitch, ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

type LifecyclePhase = {
  key: "agent" | "turn" | "message" | "tool";
  label: string;
  tokenColor: TokenColor;
  icon: ReactNode;
};

/** Conversation-order event flow; this also defines the event selector order. */
const EVENT_FLOW: { event: HookEvent; phaseKey: LifecyclePhase["key"] }[] = [
  { event: "agent_start", phaseKey: "agent" },
  { event: "turn_start", phaseKey: "turn" },
  { event: "message_start", phaseKey: "message" },
  { event: "message_end", phaseKey: "message" },
  { event: "tool_execution_start", phaseKey: "tool" },
  { event: "tool_execution_end", phaseKey: "tool" },
  { event: "turn_end", phaseKey: "turn" },
  { event: "agent_end", phaseKey: "agent" },
];

function getHookEventLabel(t: (key: string) => string, event: HookEvent) {
  return t(HOOK_EVENT_TRANSLATION_KEYS[event]);
}

function getHookTypeColor(type: HookType): TokenColor {
  return type === "command" ? "blue" : "green";
}

export function HooksSection(_props: SettingsSectionProps) {
  const { t } = useLocale();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHook, setEditingHook] = useState<HookDef | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { hooks: hooksSnapshot } = useAutomation();
  const hooks = hooksSnapshot.hooks;
  const enabledCount = hooks.filter((hook) => hook.enabled).length;

  const phasesByKey: Record<LifecyclePhase["key"], LifecyclePhase> = {
    agent: {
      key: "agent",
      label: t("settings.hooksPhaseAgent"),
      tokenColor: "purple",
      icon: <Icon icon={Bot} size="sm" color="inherit" />,
    },
    turn: {
      key: "turn",
      label: t("settings.hooksPhaseTurn"),
      tokenColor: "blue",
      icon: <Icon icon={RefreshCw} size="sm" color="inherit" />,
    },
    message: {
      key: "message",
      label: t("settings.hooksPhaseMessage"),
      tokenColor: "green",
      icon: <Icon icon={MessageSquare} size="sm" color="inherit" />,
    },
    tool: {
      key: "tool",
      label: t("settings.hooksPhaseTool"),
      tokenColor: "yellow",
      icon: <Icon icon={Wrench} size="sm" color="inherit" />,
    },
  };

  const phaseByEvent = new Map(
    EVENT_FLOW.map(({ event, phaseKey }) => [event, phasesByKey[phaseKey]] as const),
  );

  function closeModal() {
    setModalOpen(false);
    setEditingHook(null);
  }

  function openAdd() {
    setEditingHook(null);
    setModalOpen(true);
  }

  function openEdit(hook: HookDef) {
    setEditingHook(hook);
    setModalOpen(true);
  }

  function runOps(run: () => Promise<unknown>) {
    setActionError(null);
    void run().catch((error) => {
      setActionError(error instanceof Error ? error.message : String(error));
    });
  }

  async function handleSave(data: Omit<HookDef, "id">) {
    setActionError(null);
    if (editingHook) {
      await applyHookOps([{ op: "update", id: editingHook.id, patch: { ...data } }]);
    } else {
      await applyHookOps([{ op: "create", item: { ...data } }]);
    }
  }

  function toggleHook(hook: HookDef) {
    runOps(() => applyHookOps([{ op: "update", id: hook.id, patch: { enabled: !hook.enabled } }]));
  }

  function deleteHook(hookId: string) {
    runOps(() => applyHookOps([{ op: "delete", id: hookId }]));
  }

  if (modalOpen) {
    return (
      <HookModal
        event={editingHook?.event}
        initialData={editingHook ?? undefined}
        onSave={handleSave}
        onClose={closeModal}
      />
    );
  }

  return (
    <VStack width="100%" gap={4}>
      {hooks.length > 0 ? (
        <Section variant="transparent" padding={0}>
          <HStack width="100%" gap={3} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <Text type="supporting" color="secondary" wordBreak="break-word">
                {t("settings.hooksDesc")}
              </Text>
            </StackItem>
            <HStack gap={1} vAlign="center" wrap="wrap">
              <Token
                label={`${hooks.length} ${t("settings.hooksTotalHooks")}`}
                color="gray"
                size="sm"
              />
              <Token
                label={`${enabledCount} ${t("settings.enable")}`}
                color="green"
                size="sm"
                icon={<StatusDot variant="success" label={t("settings.enable")} />}
              />
              <Button
                label={t("settings.hooksAdd")}
                variant="secondary"
                size="sm"
                onClick={openAdd}
              />
            </HStack>
          </HStack>
        </Section>
      ) : null}

      {actionError ? <Banner status="error" title={actionError} collapsible={false} /> : null}

      <Section variant="transparent" padding={0}>
        {hooks.length === 0 ? (
          <EmptyState
            isCompact
            icon={<Icon icon={Zap} size="lg" color="secondary" />}
            title={t("settings.hooksEmptyTitle")}
            description={t("settings.hooksEmptyDesc")}
            actions={
              <Button
                label={t("settings.hooksAdd")}
                variant="secondary"
                size="sm"
                onClick={openAdd}
              />
            }
          />
        ) : (
          <List density="balanced" hasDividers>
            {hooks.map((hook) => {
              const phase = phaseByEvent.get(hook.event) ?? phasesByKey.agent;
              const stepCount =
                hook.type === "command"
                  ? (hook.script ?? "").split(/\r?\n/).filter((line) => line.trim()).length
                  : (hook.requests?.length ?? 0);
              const stepLabel =
                hook.type === "command"
                  ? t("settings.hooksScriptLinesCount")
                  : t("settings.hooksRequestsCount");
              return (
                <ListItem
                  key={hook.id}
                  label={hook.name}
                  startContent={
                    <Icon
                      icon={hook.type === "command" ? Terminal : Globe}
                      size="md"
                      color={hook.enabled ? "primary" : "disabled"}
                    />
                  }
                  description={
                    <VStack gap={1}>
                      <Text type="supporting" color="secondary" wordBreak="break-word">
                        {hook.description || t("settings.hooksNoDescription")}
                      </Text>
                      <HStack gap={1} wrap="wrap">
                        <Token
                          label={getHookEventLabel(t, hook.event)}
                          color={phase.tokenColor}
                          size="sm"
                          icon={phase.icon}
                        />
                        <Token
                          label={
                            hook.type === "command"
                              ? t("settings.hooksTypeCommand")
                              : t("settings.hooksTypeHttp")
                          }
                          color={getHookTypeColor(hook.type)}
                          size="sm"
                        />
                        <Token label={`${stepCount} ${stepLabel}`} color="gray" size="sm" />
                      </HStack>
                    </VStack>
                  }
                  endContent={
                    <VStack gap={1} hAlign="end">
                      <Token label={phase.label} color={phase.tokenColor} size="sm" />
                      <HStack gap={1} vAlign="center">
                        <AgentActivationSwitch
                          checked={hook.enabled}
                          title={hook.enabled ? t("settings.disable") : t("settings.enable")}
                          onToggle={() => toggleHook(hook)}
                        />
                        <IconButton
                          label={t("settings.edit")}
                          tooltip={t("settings.edit")}
                          icon={<Icon icon={Pencil} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(hook)}
                        />
                        <ConfirmDeletePopover
                          name={hook.name}
                          onConfirm={() => deleteHook(hook.id)}
                        >
                          {(open) => (
                            <IconButton
                              label={t("settings.delete")}
                              tooltip={t("settings.delete")}
                              icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                              variant="ghost"
                              size="sm"
                              onClick={open}
                            />
                          )}
                        </ConfirmDeletePopover>
                      </HStack>
                    </VStack>
                  }
                />
              );
            })}
          </List>
        )}
      </Section>
    </VStack>
  );
}
