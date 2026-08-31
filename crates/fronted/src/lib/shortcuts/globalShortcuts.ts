import { invoke } from "@xgent/runtime";

export type GlobalShortcutAction = "summon" | "toggle" | "newChat" | "pin";

export const GLOBAL_SHORTCUT_ACTIONS: readonly GlobalShortcutAction[] = [
  "summon",
  "toggle",
  "newChat",
  "pin",
];

export interface GlobalShortcutBinding {
  accelerator: string;
  enabled: boolean;
}

export type GlobalShortcutBindings = Partial<Record<GlobalShortcutAction, GlobalShortcutBinding>>;

export interface GlobalShortcutFailure {
  action: string;
  accelerator: string;
  error: string;
}

const STORAGE_KEY = "xgent.globalShortcuts.v1";
let shortcutApplyQueue: Promise<void> = Promise.resolve();

export const DEFAULT_GLOBAL_SHORTCUT_BINDINGS: Readonly<GlobalShortcutBindings> = {
  summon: { accelerator: "Ctrl+KeyK", enabled: false },
  toggle: { accelerator: "Ctrl+Shift+KeyS", enabled: false },
  newChat: { accelerator: "Ctrl+Shift+KeyO", enabled: false },
  pin: { accelerator: "Ctrl+Period", enabled: false },
};

export function getDefaultGlobalShortcutBindings(): GlobalShortcutBindings {
  return Object.fromEntries(
    Object.entries(DEFAULT_GLOBAL_SHORTCUT_BINDINGS).map(([action, binding]) => [
      action,
      { ...binding },
    ]),
  ) as GlobalShortcutBindings;
}

export const SHORTCUT_MODIFIER_ORDER = ["Ctrl", "Shift", "Alt", "Super"] as const;
export type ShortcutModifier = (typeof SHORTCUT_MODIFIER_ORDER)[number];

const MODIFIER_SET = new Set<string>(SHORTCUT_MODIFIER_ORDER);

export function isShortcutModifierToken(token: string): token is ShortcutModifier {
  return MODIFIER_SET.has(token);
}

export function modifierFromEventCode(code: string): ShortcutModifier | null {
  switch (code) {
    case "ControlLeft":
    case "ControlRight":
      return "Ctrl";
    case "ShiftLeft":
    case "ShiftRight":
      return "Shift";
    case "AltLeft":
    case "AltRight":
      return "Alt";
    case "MetaLeft":
    case "MetaRight":
      return "Super";
    default:
      return null;
  }
}

export function readGlobalShortcutBindings(): GlobalShortcutBindings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultGlobalShortcutBindings();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return getDefaultGlobalShortcutBindings();
    const bindings: GlobalShortcutBindings = {};
    for (const action of GLOBAL_SHORTCUT_ACTIONS) {
      const value = (parsed as Record<string, unknown>)[action];

      if (typeof value === "string" && value.trim()) {
        bindings[action] = { accelerator: value.trim(), enabled: true };
        continue;
      }
      if (value && typeof value === "object") {
        const accelerator = (value as Record<string, unknown>).accelerator;
        const enabled = (value as Record<string, unknown>).enabled;
        if (typeof accelerator === "string" && accelerator.trim()) {
          bindings[action] = { accelerator: accelerator.trim(), enabled: enabled !== false };
        }
      }
    }
    return bindings;
  } catch {
    return getDefaultGlobalShortcutBindings();
  }
}

export function writeGlobalShortcutBindings(bindings: GlobalShortcutBindings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {}
}

export async function applyGlobalShortcuts(
  bindings: GlobalShortcutBindings,
): Promise<GlobalShortcutFailure[]> {
  const payload = GLOBAL_SHORTCUT_ACTIONS.flatMap((action) => {
    const binding = bindings[action];
    const accelerator = binding?.accelerator.trim();
    return binding?.enabled && accelerator ? [{ action, accelerator }] : [];
  });
  const apply = async (): Promise<GlobalShortcutFailure[]> => {
    try {
      const failures = await invoke<GlobalShortcutFailure[]>("app_set_global_shortcuts", {
        bindings: payload,
      });
      return Array.isArray(failures) ? failures : [];
    } catch (error) {
      return [
        {
          action: "runtime",
          accelerator: "",
          error: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  };

  // Recording temporarily unregisters every shortcut. Serialize that request
  // with the subsequent save so a slower unregister cannot erase the binding
  // that the user just confirmed.
  const result = shortcutApplyQueue.then(apply, apply);
  shortcutApplyQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function applyStoredGlobalShortcuts(): Promise<void> {
  const bindings = readGlobalShortcutBindings();
  if (GLOBAL_SHORTCUT_ACTIONS.every((action) => !bindings[action])) return;
  const failures = await applyGlobalShortcuts(bindings);
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.error).join("; "));
  }
}
