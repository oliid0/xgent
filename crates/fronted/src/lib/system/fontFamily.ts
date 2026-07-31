export const DEFAULT_INTERFACE_FONT_FAMILY =
  'ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
export const DEFAULT_CHAT_FONT_FAMILY =
  '"OpenAI Sans Semibold", "PingFang SC", "Microsoft YaHei", sans-serif';
export const DEFAULT_CODE_FONT_FAMILY =
  '"SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Code", Consolas, "Liberation Mono", monospace';

export const CODE_FONT_FAMILY_CHANGE_EVENT = "xgent:code-font-family-change";
export const FONT_FAMILY_DEFAULT_SELECT_VALUE = "__default__";
export const FONT_FAMILY_CUSTOM_SELECT_VALUE = "__custom__";

export const COMMON_FONT_FAMILIES = [
  "Inter",
  "SF Pro Text",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Noto Sans SC",
  "Source Han Sans SC",
  "Helvetica Neue",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Songti SC",
  "STSong",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Cascadia Code",
  "Consolas",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "IBM Plex Mono",
] as const;

export type FontFamilySelectOption = { value: string; label: string };
export type FontFamilySettings = {
  interfaceFontFamily: string;
  chatFontFamily: string;
  codeFontFamily: string;
};

const MAX_FONT_FAMILY_LENGTH = 200;
const UNSAFE_FONT_FAMILY_PATTERN = /[;{}<>\\]|url\s*\(|@import|expression\s*\(/i;
const ALLOWED_FONT_FAMILY_PATTERN = /^[\w\s,"'\-.+]+$/u;

type LocalFontData = { family?: string };
type QueryLocalFonts = () => Promise<LocalFontData[]>;
type LocalFontPermissions = {
  query: (descriptor: { name: "local-fonts" }) => Promise<{ state?: string }>;
};

async function hasGrantedLocalFontPermission(): Promise<boolean> {
  const permissions = (
    globalThis as typeof globalThis & { navigator?: { permissions?: LocalFontPermissions } }
  ).navigator?.permissions;
  if (!permissions || typeof permissions.query !== "function") return false;
  try {
    const status = await permissions.query({ name: "local-fonts" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export function normalizeFontFamily(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > MAX_FONT_FAMILY_LENGTH) return "";
  if (UNSAFE_FONT_FAMILY_PATTERN.test(trimmed)) return "";
  return ALLOWED_FONT_FAMILY_PATTERN.test(trimmed) ? trimmed : "";
}

function resolveFontFamily(value: string, fallback: string): string {
  return normalizeFontFamily(value) || fallback;
}

export function resolveCodeFontFamily(value: string): string {
  return resolveFontFamily(value, DEFAULT_CODE_FONT_FAMILY);
}

export function getCodeFontFamily(root: HTMLElement = document.documentElement): string {
  const inlineValue = root.style.getPropertyValue("--code-font-family");
  if (inlineValue) return resolveCodeFontFamily(inlineValue);
  const computedValue = root.ownerDocument?.defaultView
    ?.getComputedStyle(root)
    .getPropertyValue("--code-font-family");
  return resolveCodeFontFamily(computedValue ?? "");
}

export function applyFontFamilies(
  settings: FontFamilySettings,
  root: HTMLElement = document.documentElement,
): void {
  const interfaceFont = resolveFontFamily(
    settings.interfaceFontFamily,
    DEFAULT_INTERFACE_FONT_FAMILY,
  );
  const chatFont = resolveFontFamily(settings.chatFontFamily, DEFAULT_CHAT_FONT_FAMILY);
  const codeFont = resolveCodeFontFamily(settings.codeFontFamily);
  const previousCodeFont = root.style.getPropertyValue("--code-font-family");
  root.style.setProperty("--app-font-family", interfaceFont);
  root.style.setProperty("--chat-font-family", chatFont);
  root.style.setProperty("--code-font-family", codeFont);
  if (previousCodeFont !== codeFont) {
    (root.ownerDocument?.defaultView ?? globalThis.window)?.dispatchEvent(
      new CustomEvent<string>(CODE_FONT_FAMILY_CHANGE_EVENT, { detail: codeFont }),
    );
  }
}

export function quoteFontFamilyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

export function buildFontFamilySelectOptions(
  localFamilies: readonly string[] = [],
): FontFamilySelectOption[] {
  const byValue = new Map<string, string>();
  for (const family of COMMON_FONT_FAMILIES) {
    const value = quoteFontFamilyName(family);
    if (value) byValue.set(value, family);
  }
  for (const family of localFamilies) {
    const trimmed = typeof family === "string" ? family.trim() : "";
    const value = quoteFontFamilyName(trimmed);
    if (value && !byValue.has(value)) byValue.set(value, trimmed);
  }
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
    );
}

export function toFontFamilySelectValue(
  value: string,
  options: readonly FontFamilySelectOption[],
  preferCustom = false,
): string {
  const normalized = normalizeFontFamily(value);
  if (!normalized) {
    return preferCustom ? FONT_FAMILY_CUSTOM_SELECT_VALUE : FONT_FAMILY_DEFAULT_SELECT_VALUE;
  }
  if (!preferCustom && options.some((option) => option.value === normalized)) return normalized;
  return FONT_FAMILY_CUSTOM_SELECT_VALUE;
}

export function fromFontFamilySelectValue(value: string): string {
  if (value === FONT_FAMILY_DEFAULT_SELECT_VALUE || value === FONT_FAMILY_CUSTOM_SELECT_VALUE) {
    return "";
  }
  return normalizeFontFamily(value);
}

export async function listLocalFontFamilies(): Promise<string[]> {
  const queryLocalFonts = (globalThis as typeof globalThis & { queryLocalFonts?: QueryLocalFonts })
    .queryLocalFonts;
  if (typeof queryLocalFonts !== "function") return [];
  // Crucially, never call queryLocalFonts while the permission is only
  // "prompt": opening Settings must not trigger an unsolicited OS dialog.
  if (!(await hasGrantedLocalFontPermission())) return [];
  try {
    const names = new Set<string>();
    for (const font of await queryLocalFonts()) {
      const family = typeof font.family === "string" ? font.family.trim() : "";
      if (family) names.add(family);
    }
    return [...names].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  } catch {
    return [];
  }
}
