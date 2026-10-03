import { useEffect, useState } from "react";
import {
  applyGlobalShortcuts,
  GLOBAL_SHORTCUT_ACTIONS,
  type GlobalShortcutAction,
  type GlobalShortcutBindings,
  getDefaultGlobalShortcutBindings,
  readGlobalShortcutBindings,
  SHORTCUT_MODIFIER_ORDER,
  writeGlobalShortcutBindings,
} from "../lib/shortcuts/globalShortcuts";
import { presentationControls } from "./controls";
import type { PresentationNode, PresentationValue } from "./types";

type RecordingEvent = {
  phase: "capture" | "confirm" | "cancel" | "systemConflict";
  accelerator?: string;
};

// Native physical keys use the same names as KeyboardEvent.code and the Rust
// global-hotkey parser. Reject modifier-only, duplicate and invented tokens.
export function normalizeRecordedShortcut(value: string): string | null {
  const tokens = value.split("+");
  const key = tokens.pop();
  if (
    !key ||
    !/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Arrow(Up|Down|Left|Right)|Delete|Home|End|PageUp|PageDown|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Equal))$/.test(
      key,
    ) ||
    tokens.some((token) => !SHORTCUT_MODIFIER_ORDER.some((modifier) => modifier === token)) ||
    new Set(tokens).size !== tokens.length
  )
    return null;
  return [...SHORTCUT_MODIFIER_ORDER.filter((modifier) => tokens.includes(modifier)), key].join(
    "+",
  );
}

function recordingEvent(value: PresentationValue): RecordingEvent | null {
  if (typeof value !== "string" || value.length > 256) return null;
  try {
    const event = JSON.parse(value);
    if (!event || typeof event !== "object" || Array.isArray(event)) return null;
    if (Object.keys(event).some((key) => key !== "phase" && key !== "accelerator")) return null;
    if (event.phase === "cancel" || event.phase === "systemConflict")
      return event.accelerator === undefined ? event : null;
    if (
      (event.phase === "capture" || event.phase === "confirm") &&
      typeof event.accelerator === "string" &&
      (event.accelerator === "" || normalizeRecordedShortcut(event.accelerator))
    )
      return event;
  } catch {
    // A malformed bridge event cannot edit or register a shortcut.
  }
  return null;
}

export function useNativeGlobalShortcuts(enabled: boolean, t: (key: string) => string) {
  const [state, setState] = useState(() => ({
    bindings: readGlobalShortcutBindings(),
    recording: null as GlobalShortcutAction | null,
    draft: "",
    busy: false,
    status: null as { kind: "completed" | "error"; text: string } | null,
  }));
  const [scope] = useState(() => ({ active: enabled, revision: 0, state }));
  scope.active = enabled;
  const update = (patch: Partial<typeof state>) => {
    scope.state = { ...scope.state, ...patch };
    if (scope.active) setState(scope.state);
  };
  const report = (failures: Awaited<ReturnType<typeof applyGlobalShortcuts>>) => {
    if (!failures.length) return null;
    return `${t("settings.shortcutRegisterFailed")}: ${failures.map((failure) => failure.error).join("; ")}`;
  };

  async function apply(next: GlobalShortcutBindings, persist: boolean) {
    if (!scope.active || scope.state.busy) return;
    const revision = ++scope.revision;
    update({ busy: true, status: null });
    if (persist) {
      writeGlobalShortcutBindings(next);
      update({ bindings: next });
    }
    const failures = await applyGlobalShortcuts(next);
    if (!scope.active || revision !== scope.revision) return;
    const error = report(failures);
    update({
      busy: false,
      status: error
        ? { kind: "error", text: error }
        : persist
          ? { kind: "completed", text: t("settings.shortcutSaved") }
          : null,
    });
    if (error) throw new Error(error);
  }

  async function start(action: GlobalShortcutAction) {
    if (!scope.active || scope.state.busy || scope.state.recording) return;
    const revision = ++scope.revision;
    // Mark ownership before awaiting unregister: route teardown must restore
    // the saved bindings even while this request is still in flight.
    update({ recording: action, draft: "", busy: true, status: null });
    const failures = await applyGlobalShortcuts({});
    if (!scope.active || revision !== scope.revision) return;
    const error = report(failures);
    if (error) {
      const restore = report(await applyGlobalShortcuts(scope.state.bindings));
      if (!scope.active || revision !== scope.revision) return;
      update({
        recording: null,
        busy: false,
        status: { kind: "error", text: restore ? `${error}; ${restore}` : error },
      });
      throw new Error(error);
    }
    update({ busy: false });
  }

  async function cancel() {
    if (!scope.active || scope.state.busy || !scope.state.recording) return;
    update({ recording: null, draft: "" });
    await apply(scope.state.bindings, false);
  }

  async function confirm(accelerator = scope.state.draft) {
    if (!scope.active || scope.state.busy || !scope.state.recording) return;
    const action = scope.state.recording;
    const normalized = normalizeRecordedShortcut(accelerator);
    const error = !normalized
      ? t("settings.shortcutNeedMainKey")
      : GLOBAL_SHORTCUT_ACTIONS.some(
            (other) =>
              other !== action &&
              normalizeRecordedShortcut(scope.state.bindings[other]?.accelerator ?? "") ===
                normalized,
          )
        ? t("settings.shortcutConflict")
        : "";
    if (error) {
      update({ status: { kind: "error", text: error } });
      throw new Error(error);
    }
    if (!normalized) return;
    const next = { ...scope.state.bindings, [action]: { accelerator: normalized, enabled: true } };
    update({ recording: null, draft: "" });
    await apply(next, true);
  }

  useEffect(() => {
    scope.active = enabled;
    if (enabled) {
      update({ recording: null, draft: "", busy: false, status: null });
      void apply(scope.state.bindings, false).catch(() => undefined);
    }
    return () => {
      scope.active = false;
      scope.revision++;
      if (scope.state.recording) void applyGlobalShortcuts(scope.state.bindings);
    };
  }, [enabled]);

  const c = presentationControls();
  const notice = (cause: unknown) =>
    update({
      status: {
        kind: "error",
        text: cause instanceof Error ? cause.message : String(cause),
      },
    });
  if (!enabled) return { nodes: [] as PresentationNode[], handlers: c.handlers, notice };
  const locked = state.busy || state.recording !== null;
  const actions = [
    ["summon", "settings.shortcutSummon", "settings.shortcutSummonDesc"],
    ["toggle", "settings.shortcutToggle", "settings.shortcutToggleDesc"],
    ["newChat", "settings.shortcutNewChat", "settings.shortcutNewChatDesc"],
    ["pin", "settings.shortcutPin", "settings.shortcutPinDesc"],
  ] as const;
  const nodes: PresentationNode[] = [
    {
      id: "shortcut-description",
      kind: "Text",
      text: t("settings.globalShortcutsDesc"),
      secondary: true,
    },
    ...actions.map(([action, label, description]) => {
      const binding = state.bindings[action];
      const recording = state.recording === action;
      const recordId = `shortcut:${action}:capture`;
      c.handlers.set(recordId, {
        enabled: recording && !state.busy,
        accepts: (value) => recordingEvent(value) !== null,
        run: async (value) => {
          if (!scope.active || scope.state.recording !== action || scope.state.busy) return;
          const event = recordingEvent(value);
          if (!event) return;
          if (event.phase === "cancel") await cancel();
          else if (event.phase === "confirm") await confirm(event.accelerator);
          else if (event.phase === "systemConflict")
            update({ status: { kind: "error", text: t("settings.shortcutSystemConflict") } });
          else
            update({
              draft: normalizeRecordedShortcut(event.accelerator ?? "") ?? "",
              status: null,
            });
        },
      });
      return c.group(`shortcut:${action}`, t(label), [
        {
          id: `shortcut:${action}:description`,
          kind: "Text",
          text: t(description),
          secondary: true,
        },
        ...(recording
          ? [
              {
                id: recordId,
                kind: "ShortcutRecorder" as const,
                action: recordId,
                label: t(label),
                value: state.draft,
                disabled: state.busy,
                text: t(
                  state.draft ? "settings.shortcutPressEnter" : "settings.shortcutRecordingHint",
                ),
              },
              c.action(
                `shortcut:${action}:save`,
                t("settings.save"),
                () => confirm(),
                !!state.draft && !state.busy,
              ),
              c.action(`shortcut:${action}:cancel`, t("settings.cancel"), cancel, !state.busy),
            ]
          : [
              {
                ...c.action(
                  `shortcut:${action}:record`,
                  t(binding ? "settings.shortcutChange" : "settings.shortcutSet"),
                  () => start(action),
                  !locked,
                ),
                variant: "shortcut-binding",
                text: binding?.accelerator ?? t("settings.shortcutNotSet"),
                icon: "keyboard",
              },
            ]),
        c.toggle(
          `shortcut:${action}:enabled`,
          t("settings.shortcutToggleOnOff"),
          binding?.enabled === true,
          (value) => {
            const current = scope.state.bindings[action];
            if (!current || scope.state.recording) return;
            return apply(
              { ...scope.state.bindings, [action]: { ...current, enabled: value } },
              true,
            );
          },
          !!binding && !locked,
        ),
        {
          ...c.action(
            `shortcut:${action}:clear`,
            t("settings.shortcutClear"),
            () => {
              if (scope.state.recording) return;
              const next = { ...scope.state.bindings };
              delete next[action];
              return apply(next, true);
            },
            !!binding && !locked,
          ),
          destructive: true,
        },
      ]);
    }),
    c.action(
      "shortcut-restore",
      t("settings.shortcutRestoreDefaults"),
      () => (scope.state.recording ? undefined : apply(getDefaultGlobalShortcutBindings(), true)),
      !locked,
    ),
    ...(state.busy
      ? [{ id: "shortcut-busy", kind: "Progress" as const, label: t("app.loading") }]
      : []),
    ...(state.status
      ? [
          {
            id: "shortcut-status",
            kind: "Banner" as const,
            label: state.status.text,
            status: state.status.kind,
          },
        ]
      : []),
  ];
  return {
    nodes,
    handlers: c.handlers,
    notice,
  };
}
