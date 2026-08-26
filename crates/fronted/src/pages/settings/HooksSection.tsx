import { type ReactNode, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Globe,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
  Zap,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import {
  applyHookOps,
  HOOK_EVENT_DESCRIPTION_TRANSLATION_KEYS,
  HOOK_EVENT_TRANSLATION_KEYS,
  type HookDef,
  type HookEvent,
  type HookType,
  useAutomation,
} from "../../lib/automation";
import { HookModal } from "./HookModal";
import { AgentActivationSwitch, ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Paragraph as AstryxParagraph } from "@xagent/ui/components/ui/view";
import { Heading as AstryxHeading } from "@xagent/ui/components/ui/view";

type LifecyclePhase = {
  key: "agent" | "turn" | "message" | "tool";
  label: string;
  color: string;
  bgColor: string;
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

function getHookTypeTone(type: HookType) {
  return type === "command"
    ? "bg-blue-500/10 text-blue-600 dark:text-blue-300"
    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
}

export function HooksSection(_props: SettingsSectionProps) {
  const { t } = useLocale();
  const [activeEvent, setActiveEvent] = useState<HookEvent>(EVENT_FLOW[0].event);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHook, setEditingHook] = useState<HookDef | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { hooks: hooksSnapshot } = useAutomation();
  const hooks = hooksSnapshot.hooks;
  const activeHooks = hooks.filter((hook) => hook.event === activeEvent);
  const enabledCount = hooks.filter((hook) => hook.enabled).length;

  const phasesByKey: Record<LifecyclePhase["key"], LifecyclePhase> = {
    agent: {
      key: "agent",
      label: t("settings.hooksPhaseAgent"),
      color: "text-violet-600 dark:text-violet-300",
      bgColor: "bg-violet-500/10",
      icon: <Bot className="h-3.5 w-3.5" />,
    },
    turn: {
      key: "turn",
      label: t("settings.hooksPhaseTurn"),
      color: "text-blue-600 dark:text-blue-300",
      bgColor: "bg-blue-500/10",
      icon: <RefreshCw className="h-3.5 w-3.5" />,
    },
    message: {
      key: "message",
      label: t("settings.hooksPhaseMessage"),
      color: "text-emerald-600 dark:text-emerald-300",
      bgColor: "bg-emerald-500/10",
      icon: <MessageSquare className="h-3.5 w-3.5" />,
    },
    tool: {
      key: "tool",
      label: t("settings.hooksPhaseTool"),
      color: "text-amber-600 dark:text-amber-300",
      bgColor: "bg-amber-500/10",
      icon: <Wrench className="h-3.5 w-3.5" />,
    },
  };

  const orderedEvents = EVENT_FLOW.map(({ event, phaseKey }) => ({
    event,
    phase: phasesByKey[phaseKey],
  }));
  const activePhase =
    orderedEvents.find(({ event }) => event === activeEvent)?.phase ?? phasesByKey.agent;

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
    setActiveEvent(hook.event);
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

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="settings-hooks-section min-w-0 space-y-5"
    >
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="settings-section-heading-row flex items-center justify-between gap-4"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-section-title-group flex min-w-0 items-center gap-3"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300"
          >
            <Zap className="h-[18px] w-[18px]" />
          </AstryxView>
          <AstryxView layout="block" direction="horizontal" className="min-w-0">
            <AstryxHeading level={2} className="text-sm font-semibold">
              {t("settings.hooksTitle")}
            </AstryxHeading>
            <AstryxParagraph className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.hooksDesc")}
            </AstryxParagraph>
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-section-actions flex shrink-0 items-center gap-2"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="settings-hooks-count flex items-center gap-2 whitespace-nowrap rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground"
          >
            <AstryxInline className="tabular-nums font-semibold text-foreground">
              {hooks.length}
            </AstryxInline>
            {t("settings.hooksTotalHooks")}
            <AstryxInline className="text-border">|</AstryxInline>
            <AstryxInline className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <AstryxInline className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-300">
              {enabledCount}
            </AstryxInline>
          </AstryxView>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" />
            {t("settings.hooksAdd")}
          </Button>
        </AstryxView>
      </AstryxView>

      {actionError ? (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <AstryxInline className="min-w-0 flex-1 break-words">{actionError}</AstryxInline>
        </AstryxView>
      ) : null}

      <AstryxView
        layout="grid"
        direction="horizontal"
        className="settings-hooks-event-selector grid min-w-0 grid-cols-4 gap-1.5 rounded-2xl border border-border/60 bg-card p-2"
        role="tablist"
        aria-label={t("settings.hooksLifecycle")}
      >
        {orderedEvents.map(({ event, phase }) => {
          const selected = activeEvent === event;
          const eventHookCount = hooks.filter((hook) => hook.event === event).length;
          return (
            <AstryxButton
              key={event}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveEvent(event)}
              className={`settings-hooks-event-option flex min-h-14 min-w-0 items-center gap-2 rounded-xl px-2.5 text-left transition-[color,background-color,box-shadow] duration-150 ${
                selected
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                  : "text-muted-foreground hover:bg-muted/35 hover:text-foreground"
              }`}
            >
              <AstryxInline
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${phase.bgColor} ${phase.color}`}
              >
                {phase.icon}
              </AstryxInline>
              <AstryxInline className="min-w-0 flex-1">
                <AstryxInline className="block truncate text-xs font-medium">
                  {getHookEventLabel(t, event)}
                </AstryxInline>
                <AstryxInline className="mt-0.5 block truncate text-[10px] text-muted-foreground/75">
                  {phase.label}
                </AstryxInline>
              </AstryxInline>
              {eventHookCount > 0 ? (
                <AstryxInline className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                  {eventHookCount}
                </AstryxInline>
              ) : null}
            </AstryxButton>
          );
        })}
      </AstryxView>

      <AstryxView
        as="section"
        className="settings-hooks-detail min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-hooks-detail-header flex min-w-0 items-center gap-3 border-b border-border/45 px-4 py-3.5"
        >
          <AstryxView
            layout="block"
            direction="horizontal"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${activePhase.bgColor} ${activePhase.color}`}
          >
            {activePhase.icon}
          </AstryxView>
          <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
            <AstryxHeading level={3} className="truncate text-sm font-semibold">
              {getHookEventLabel(t, activeEvent)}
            </AstryxHeading>
            <AstryxParagraph className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t(HOOK_EVENT_DESCRIPTION_TRANSLATION_KEYS[activeEvent])}
            </AstryxParagraph>
          </AstryxView>
        </AstryxView>

        {activeHooks.length === 0 ? (
          <AstryxView layout="block" direction="horizontal" className="px-6 py-12 text-center">
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-muted/35"
            >
              <Zap className="h-5 w-5 text-muted-foreground/45" />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="mt-3 text-sm font-medium">
              {t("settings.hooksEmptyTitle")}
            </AstryxView>
            <AstryxParagraph className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              {t("settings.hooksEmptyDesc")}
            </AstryxParagraph>
            <Button className="mt-4 gap-1.5" size="sm" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              {t("settings.hooksAdd")}
            </Button>
          </AstryxView>
        ) : (
          <AstryxView layout="block" direction="horizontal" className="divide-y divide-border/45">
            {activeHooks.map((hook) => {
              const stepCount =
                hook.type === "command"
                  ? (hook.script ?? "").split(/\r?\n/).filter((line) => line.trim()).length
                  : (hook.requests?.length ?? 0);
              return (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  key={hook.id}
                  className={`settings-hooks-card settings-card-row flex min-w-0 items-start gap-3 px-4 py-3.5 transition-[background-color,opacity] duration-150 hover:bg-muted/20 ${
                    hook.enabled ? "" : "opacity-55"
                  }`}
                >
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className={`settings-hooks-card-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${getHookTypeTone(hook.type)}`}
                  >
                    {hook.type === "command" ? (
                      <Terminal className="h-4 w-4" />
                    ) : (
                      <Globe className="h-4 w-4" />
                    )}
                  </AstryxView>
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="settings-hooks-card-main min-w-0 flex-1"
                  >
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex min-w-0 flex-wrap items-center gap-2"
                    >
                      <AstryxInline className="max-w-full truncate text-sm font-semibold">
                        {hook.name}
                      </AstryxInline>
                      <AstryxInline className="shrink-0 rounded-md bg-muted/55 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                        {stepCount}{" "}
                        {hook.type === "command"
                          ? t("settings.hooksScriptLinesCount")
                          : t("settings.hooksRequestsCount")}
                      </AstryxInline>
                    </AstryxView>
                    <AstryxParagraph className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                      {hook.description || t("settings.hooksNoDescription")}
                    </AstryxParagraph>
                  </AstryxView>
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="settings-card-actions settings-hooks-card-actions flex shrink-0 items-center gap-1"
                  >
                    <AgentActivationSwitch
                      checked={hook.enabled}
                      title={hook.enabled ? t("settings.disable") : t("settings.enable")}
                      onToggle={() => toggleHook(hook)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      title={t("settings.edit")}
                      onClick={() => openEdit(hook)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <ConfirmDeletePopover name={hook.name} onConfirm={() => deleteHook(hook.id)}>
                      {(open) => (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title={t("settings.delete")}
                          onClick={open}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </ConfirmDeletePopover>
                  </AstryxView>
                </AstryxView>
              );
            })}
          </AstryxView>
        )}
      </AstryxView>

      {modalOpen ? (
        <HookModal
          event={editingHook?.event ?? activeEvent}
          initialData={editingHook ?? undefined}
          onSave={handleSave}
          onClose={closeModal}
        />
      ) : null}
    </AstryxView>
  );
}
