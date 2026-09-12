import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Kbd } from "@astryxdesign/core/Kbd";
import { List, ListItem } from "@astryxdesign/core/List";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import { inferRuntimePlatform, isNativeMobileRuntime } from "../../lib/runtimePlatform";
import type { AppSettings } from "../../lib/settings";
import {
  applyGlobalShortcuts,
  GLOBAL_SHORTCUT_ACTIONS,
  type GlobalShortcutAction,
  type GlobalShortcutBindings,
  type GlobalShortcutFailure,
  getDefaultGlobalShortcutBindings,
  isShortcutModifierToken,
  modifierFromEventCode,
  readGlobalShortcutBindings,
  type ShortcutModifier,
  writeGlobalShortcutBindings,
} from "../../lib/shortcuts/globalShortcuts";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";

type ShortcutDraft = {
  modifiers: ShortcutModifier[];
  mainKey: string | null;
};

type ShortcutStatus = {
  kind: "success" | "error";
  text: string;
  action?: GlobalShortcutAction;
};

const IS_MAC = inferRuntimePlatform() === "macos";

const CODE_LABELS: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  Backspace: "Backspace",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

function displayMainKey(code: string): string {
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  return CODE_LABELS[code] ?? code;
}

function displayModifier(modifier: ShortcutModifier): string {
  if (modifier === "Super") return IS_MAC ? "mod" : "Win";
  return modifier.toLowerCase();
}

function displayAccelerator(accelerator: string): string {
  return accelerator
    .split("+")
    .filter(Boolean)
    .map((token) =>
      isShortcutModifierToken(token) ? displayModifier(token) : displayMainKey(token),
    )
    .join("+");
}

function draftAccelerator(draft: ShortcutDraft): string | null {
  if (!draft.mainKey) return null;
  return [...draft.modifiers.map(displayModifier), displayMainKey(draft.mainKey)].join("+");
}

export function GlobalShortcutsSection(
  props: { settings?: AppSettings; onBack?: () => void } = {},
) {
  const { t } = useLocale();
  const [bindings, setBindings] = useState<GlobalShortcutBindings>(() =>
    readGlobalShortcutBindings(),
  );
  const [recording, setRecording] = useState<GlobalShortcutAction | null>(null);
  const [draft, setDraft] = useState<ShortcutDraft>({ modifiers: [], mainKey: null });
  const [status, setStatus] = useState<ShortcutStatus | null>(null);
  const [nativeAccelerators, setNativeAccelerators] = useState<
    Partial<Record<GlobalShortcutAction, string>>
  >(() =>
    Object.fromEntries(
      Object.entries(readGlobalShortcutBindings()).map(([action, binding]) => [
        action,
        binding?.accelerator ?? "",
      ]),
    ),
  );

  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const actionMeta: Array<{
    id: GlobalShortcutAction;
    label: string;
    description: string;
  }> = [
    {
      id: "summon",
      label: t("settings.shortcutSummon"),
      description: t("settings.shortcutSummonDesc"),
    },
    {
      id: "toggle",
      label: t("settings.shortcutToggle"),
      description: t("settings.shortcutToggleDesc"),
    },
    {
      id: "newChat",
      label: t("settings.shortcutNewChat"),
      description: t("settings.shortcutNewChatDesc"),
    },
    {
      id: "pin",
      label: t("settings.shortcutPin"),
      description: t("settings.shortcutPinDesc"),
    },
  ];

  const formatRegisterFailures = useCallback(
    (failures: GlobalShortcutFailure[]) =>
      `${t("settings.shortcutRegisterFailed")}: ${failures
        .map((failure) => failure.error)
        .join("; ")}`,
    [t],
  );

  const commit = useCallback(
    (next: GlobalShortcutBindings, action?: GlobalShortcutAction) => {
      bindingsRef.current = next;
      setBindings(next);
      writeGlobalShortcutBindings(next);
      void applyGlobalShortcuts(next).then((failures) => {
        if (failures.length > 0) {
          setStatus({
            kind: "error",
            text: formatRegisterFailures(failures),
            action,
          });
        } else {
          setStatus({ kind: "success", text: t("settings.shortcutSaved"), action });
        }
      });
    },
    [formatRegisterFailures, t],
  );

  useEffect(() => {
    if (recordingRef.current) return;
    let disposed = false;
    void applyGlobalShortcuts(bindingsRef.current).then((failures) => {
      if (disposed || recordingRef.current || failures.length === 0) return;
      setStatus({ kind: "error", text: formatRegisterFailures(failures) });
    });
    return () => {
      disposed = true;
    };
  }, [formatRegisterFailures]);

  const startRecording = useCallback((action: GlobalShortcutAction) => {
    setRecording(action);
    setDraft({ modifiers: [], mainKey: null });
    setStatus(null);
    void applyGlobalShortcuts({});
  }, []);

  const stopRecording = useCallback(
    (mode: "confirm" | "cancel") => {
      const action = recordingRef.current;
      if (!action) return;
      const currentDraft = draftRef.current;

      if (mode === "cancel") {
        setRecording(null);
        setDraft({ modifiers: [], mainKey: null });
        void applyGlobalShortcuts(bindingsRef.current);
        return;
      }

      if (!currentDraft.mainKey) {
        setStatus({
          kind: "error",
          text: t("settings.shortcutNeedMainKey"),
          action,
        });
        return;
      }

      const accelerator = [...currentDraft.modifiers, currentDraft.mainKey].join("+");
      const hasConflict = GLOBAL_SHORTCUT_ACTIONS.some(
        (other) => other !== action && bindingsRef.current[other]?.accelerator === accelerator,
      );
      if (hasConflict) {
        setStatus({
          kind: "error",
          text: t("settings.shortcutConflict"),
          action,
        });
        return;
      }

      setRecording(null);
      setDraft({ modifiers: [], mainKey: null });
      commit(
        {
          ...bindingsRef.current,
          [action]: { accelerator, enabled: true },
        },
        action,
      );
    },
    [commit, t],
  );

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;

      if (event.code === "Escape") {
        stopRecording("cancel");
        return;
      }
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        stopRecording("confirm");
        return;
      }

      const modifiers: ShortcutModifier[] = [];
      if (event.ctrlKey) modifiers.push("Ctrl");
      if (event.shiftKey) modifiers.push("Shift");
      if (event.altKey) modifiers.push("Alt");
      if (event.metaKey) modifiers.push("Super");
      const isModifier = modifierFromEventCode(event.code) !== null;
      setDraft((current) => ({
        modifiers,
        mainKey: isModifier ? current.mainKey : event.code,
      }));
      setStatus(null);
    };

    const handleBlur = () => stopRecording("cancel");
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [recording, stopRecording]);

  useEffect(
    () => () => {
      if (recordingRef.current) void applyGlobalShortcuts(bindingsRef.current);
    },
    [],
  );

  const setBindingEnabled = useCallback(
    (action: GlobalShortcutAction, enabled: boolean) => {
      const current = bindingsRef.current[action];
      if (!current) return;
      setStatus(null);
      commit({
        ...bindingsRef.current,
        [action]: { ...current, enabled },
      });
    },
    [commit],
  );

  const clearBinding = useCallback(
    (action: GlobalShortcutAction) => {
      const next = { ...bindingsRef.current };
      delete next[action];
      setStatus(null);
      commit(next);
    },
    [commit],
  );

  const currentDraft = draftAccelerator(draft);

  if (isApplePresentationRuntime() && props.settings) {
    const compact = isNativeMobileRuntime();
    const c = presentationControls();
    c.handlers.set("close", {
      enabled: true,
      accepts: (value) => value === null,
      run: () => props.onBack?.(),
    });
    const saveNativeBinding = (action: GlobalShortcutAction) => {
      const accelerator = nativeAccelerators[action]?.trim() ?? "";
      if (!accelerator) throw new Error(t("settings.shortcutNeedMainKey"));
      if (
        GLOBAL_SHORTCUT_ACTIONS.some(
          (other) =>
            other !== action &&
            bindings[other]?.accelerator.toLocaleLowerCase() === accelerator.toLocaleLowerCase(),
        )
      ) {
        throw new Error(t("settings.shortcutConflict"));
      }
      commit({
        ...bindings,
        [action]: { accelerator, enabled: bindings[action]?.enabled ?? true },
      });
    };
    const nodes: PresentationNode[] = [
      {
        id: "shortcut-description",
        kind: "Text",
        text: t("settings.globalShortcutsDesc"),
        secondary: true,
      },
      ...actionMeta.map((action) =>
        c.group(`shortcut:${action.id}`, action.label, [
          {
            id: `shortcut:${action.id}:description`,
            kind: "Text",
            text: action.description,
            secondary: true,
          },
          c.input(
            `shortcut:${action.id}:accelerator`,
            t("settings.shortcutSet"),
            nativeAccelerators[action.id] ?? "",
            (accelerator) =>
              setNativeAccelerators((current) => ({ ...current, [action.id]: accelerator })),
          ),
          c.toggle(
            `shortcut:${action.id}:enabled`,
            t("settings.shortcutToggleOnOff"),
            bindings[action.id]?.enabled === true,
            (enabled) => setBindingEnabled(action.id, enabled),
            Boolean(bindings[action.id]),
          ),
          c.action(`shortcut:${action.id}:save`, t("settings.save"), () =>
            saveNativeBinding(action.id),
          ),
          {
            ...c.action(
              `shortcut:${action.id}:clear`,
              t("settings.shortcutClear"),
              () => {
                setNativeAccelerators((current) => ({ ...current, [action.id]: "" }));
                clearBinding(action.id);
              },
              Boolean(bindings[action.id]),
            ),
            destructive: true,
          },
        ]),
      ),
      c.action("shortcut-restore", t("settings.shortcutRestoreDefaults"), () => {
        const defaults = getDefaultGlobalShortcutBindings();
        setNativeAccelerators(
          Object.fromEntries(
            Object.entries(defaults).map(([action, binding]) => [
              action,
              binding?.accelerator ?? "",
            ]),
          ),
        );
        commit(defaults);
      }),
      ...(status
        ? [
            {
              id: "shortcut-status",
              kind: "Banner" as const,
              label: status.text,
              status: status.kind === "success" ? ("completed" as const) : ("error" as const),
            },
          ]
        : []),
    ];
    return (
      <NativeSurface
        document={{
          mode: "sheet",
          title: t("settings.globalShortcuts"),
          appearance: props.settings.theme,
          formFactor: compact ? "mobile" : "desktop",
          theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
          nodes,
          dismissAction: "close",
        }}
        handlers={c.handlers}
        onError={(cause) =>
          setStatus({ kind: "error", text: cause instanceof Error ? cause.message : String(cause) })
        }
      />
    );
  }

  return (
    <VStack width="100%" gap={4}>
      <HStack width="100%" gap={3} hAlign="between" vAlign="center" wrap="wrap">
        <Text type="supporting" color="secondary">
          {t("settings.globalShortcutsDesc")}
        </Text>
        <Button
          label={t("settings.shortcutRestoreDefaults")}
          size="sm"
          variant="secondary"
          onClick={() => {
            commit(getDefaultGlobalShortcutBindings());
          }}
        />
      </HStack>

      <List density="compact" hasDividers header={t("settings.globalShortcuts")}>
        {actionMeta.map((action) => {
          const binding = bindings[action.id];
          const isRecording = recording === action.id;
          const actionStatus = status?.action === action.id ? status : null;
          const description = (
            <VStack gap={1}>
              <Text type="supporting" color="secondary">
                {action.description}
              </Text>
              {isRecording ? (
                <Text type="supporting" color="secondary">
                  {currentDraft
                    ? t("settings.shortcutPressEnter")
                    : t("settings.shortcutRecordingHint")}
                </Text>
              ) : null}
              {actionStatus ? (
                <Text type="supporting" color="secondary">
                  {actionStatus.text}
                </Text>
              ) : null}
            </VStack>
          );

          return (
            <ListItem
              key={action.id}
              label={action.label}
              description={description}
              isSelected={isRecording}
              startContent={
                <Switch
                  label={`${t("settings.shortcutToggleOnOff")}: ${action.label}`}
                  isLabelHidden
                  size="sm"
                  value={binding?.enabled === true}
                  onChange={(enabled) => setBindingEnabled(action.id, enabled)}
                  isDisabled={!binding || isRecording}
                  disabledMessage={!binding ? t("settings.shortcutNotSet") : undefined}
                />
              }
              endContent={
                <HStack gap={1} vAlign="center" wrap="wrap" hAlign="end">
                  {isRecording ? (
                    <>
                      {currentDraft ? <Kbd keys={currentDraft} /> : null}
                      <Button
                        label={t("settings.save")}
                        size="sm"
                        variant="primary"
                        onClick={() => stopRecording("confirm")}
                        isDisabled={!currentDraft}
                      />
                      <IconButton
                        label={t("settings.cancel")}
                        tooltip={t("settings.cancel")}
                        size="sm"
                        variant="ghost"
                        icon={<Icon icon="close" size="sm" />}
                        onClick={() => stopRecording("cancel")}
                      />
                    </>
                  ) : (
                    <>
                      <Button
                        label={binding ? t("settings.shortcutChange") : t("settings.shortcutSet")}
                        size="sm"
                        variant="ghost"
                        onClick={() => startRecording(action.id)}
                      >
                        {binding ? (
                          <Kbd keys={displayAccelerator(binding.accelerator)} />
                        ) : (
                          t("settings.shortcutNotSet")
                        )}
                      </Button>
                      {binding ? (
                        <IconButton
                          label={t("settings.shortcutClear")}
                          tooltip={t("settings.shortcutClear")}
                          size="sm"
                          variant="ghost"
                          icon={<Icon icon="close" size="sm" />}
                          onClick={() => clearBinding(action.id)}
                        />
                      ) : null}
                    </>
                  )}
                </HStack>
              }
            />
          );
        })}
      </List>

      {status && !status.action ? <Banner status={status.kind} title={status.text} /> : null}
    </VStack>
  );
}
