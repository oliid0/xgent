import { resolveThemeTokens } from "@astryxdesign/core/theme/tokens";
import type { AppSettings } from "../lib/settings";
import { createAppearanceTheme } from "../theme/appearanceTheme";
import { type PresentationTokenName, presentationTokenMappings } from "./tokens.generated";
import type { PresentationPalette, PresentationTheme } from "./types";

type FontZone = "chat" | "sidebar" | "workspaceTools";
type ThemeMode = "light" | "dark";
type ResolvedTokens = Record<string, string>;

function fallback(name: PresentationTokenName, mode: ThemeMode): string | number {
  return presentationTokenMappings[name].fallback[mode === "light" ? 0 : 1];
}

function raw(tokens: ResolvedTokens, name: PresentationTokenName, mode: ThemeMode) {
  return tokens[name] || fallback(name, mode);
}

function localTokenForMode(value: string, mode: ThemeMode) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("light-dark(") || !trimmed.endsWith(")")) return trimmed;
  const body = trimmed.slice("light-dark(".length, -1);
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      return (mode === "light" ? body.slice(0, index) : body.slice(index + 1)).trim();
    }
  }
  return trimmed;
}

function cssLength(value: string | number, fallbackValue: number) {
  if (typeof value === "number") return value;
  const match = /^(-?\d+(?:\.\d+)?)(px|rem)?$/.exec(value.trim());
  if (!match) return fallbackValue;
  const amount = Number(match[1]);
  return match[2] === "rem" ? amount * 16 : amount;
}

function durationMilliseconds(value: string | number, fallbackValue: number) {
  if (typeof value === "number") return value;
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value.trim());
  if (!match) return fallbackValue;
  return Number(match[1]) * (match[2] === "s" ? 1_000 : 1);
}

function fraction(value: string | number, fallbackValue: number) {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) return Number(trimmed.slice(0, -1)) / 100;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function byte(value: string) {
  const parsed = value.trim().endsWith("%")
    ? (Number(value.trim().slice(0, -1)) / 100) * 255
    : Number(value);
  return Math.max(0, Math.min(255, Math.round(parsed)));
}

/** Swift validates hexadecimal colors, so normalize Astryx's resolved CSS colors at the boundary. */
function cssColor(value: string | number, fallbackValue: string) {
  if (typeof value !== "string") return fallbackValue;
  const normalized = value.trim();
  if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(normalized)) return normalized.toLowerCase();
  if (/^#[\da-f]{3,4}$/i.test(normalized)) {
    const parts = normalized
      .slice(1)
      .split("")
      .map((part) => `${part}${part}`);
    return `#${parts.join("")}`.toLowerCase();
  }
  const rgb = /^rgba?\((.+)\)$/i.exec(normalized);
  if (!rgb) return fallbackValue;
  const [channelsText, alphaText] = rgb[1]
    .replaceAll(",", " ")
    .split("/")
    .map((part) => part.trim());
  const channels = channelsText.split(/\s+/).filter(Boolean);
  if (channels.length !== 3) return fallbackValue;
  const channelsHex = channels.map((channel) => byte(channel).toString(16).padStart(2, "0"));
  const alpha = alphaText ? Math.max(0, Math.min(1, fraction(alphaText, 1))) : 1;
  return `#${channelsHex.join("")}${
    alpha < 1
      ? Math.round(alpha * 255)
          .toString(16)
          .padStart(2, "0")
      : ""
  }`;
}

function cubicCurve(value: string | number): [number, number, number, number] {
  if (typeof value !== "string") return [0.2, 0, 0, 1];
  const match =
    /^cubic-bezier\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)$/.exec(
      value,
    );
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
    : [0.2, 0, 0, 1];
}

function palette(tokens: ResolvedTokens, mode: ThemeMode): PresentationPalette {
  const color = (name: PresentationTokenName) =>
    cssColor(raw(tokens, name, mode), String(fallback(name, mode)));
  return {
    accent: color("--color-accent"),
    accentText: color("--color-text-accent"),
    background: color("--color-background-body"),
    surface: color("--color-background-surface"),
    card: color("--color-background-card"),
    popover: color("--color-background-popover"),
    muted: color("--color-background-muted"),
    text: color("--color-text-primary"),
    secondaryText: color("--color-text-secondary"),
    disabledText: color("--color-text-disabled"),
    border: color("--color-border"),
    emphasizedBorder: color("--color-border-emphasized"),
    shadow: color("--color-shadow"),
  };
}

/** Resolve the same public Astryx 0.6 token graph used by WebUI into the native contract. */
export function createNativePresentationTheme(
  settings: AppSettings,
  compact: boolean,
  fontZone: FontZone = "workspaceTools",
): PresentationTheme {
  const theme = createAppearanceTheme(settings.customSettings.appearance, compact);
  const resolveForMode = (mode: ThemeMode): ResolvedTokens => ({
    ...resolveThemeTokens(theme, { mode }),
    ...Object.fromEntries(
      Object.entries(theme.localTokens ?? {}).map(([name, value]) => [
        name,
        localTokenForMode(value, mode),
      ]),
    ),
  });
  const light = resolveForMode("light");
  const dark = resolveForMode("dark");
  const length = (name: PresentationTokenName) =>
    cssLength(raw(light, name, "light"), Number(fallback(name, "light")));
  const duration = (name: PresentationTokenName) =>
    durationMilliseconds(raw(light, name, "light"), Number(fallback(name, "light")));
  const materialMode = (tokens: ResolvedTokens, mode: ThemeMode) => ({
    surfaceOpacity: fraction(
      raw(tokens, "--astryx-theme-xgent-glass-material-surface-opacity", mode),
      Number(fallback("--astryx-theme-xgent-glass-material-surface-opacity", mode)),
    ),
    popoverOpacity: fraction(
      raw(tokens, "--astryx-theme-xgent-glass-material-popover-opacity", mode),
      Number(fallback("--astryx-theme-xgent-glass-material-popover-opacity", mode)),
    ),
    shadowOpacity: fraction(
      raw(tokens, "--astryx-theme-xgent-glass-material-shadow-opacity", mode),
      Number(fallback("--astryx-theme-xgent-glass-material-shadow-opacity", mode)),
    ),
  });
  return {
    light: palette(light, "light"),
    dark: palette(dark, "dark"),
    radius: {
      inner: length("--radius-inner"),
      element: length("--radius-element"),
      container: length("--radius-container"),
      overlay: length("--radius-page"),
      chat: length("--radius-chat"),
    },
    spacing: {
      xs: length("--spacing-1"),
      sm: length("--spacing-2"),
      md: length("--spacing-3"),
      lg: length("--spacing-4"),
      xl: length("--spacing-6"),
    },
    control: {
      small: length("--size-element-sm"),
      medium: length("--size-element-md"),
      large: length("--size-element-lg"),
    },
    typography: {
      caption: length("--font-size-xs"),
      supporting: length("--font-size-sm"),
      body: length("--font-size-base"),
    },
    motion: {
      fast: duration("--duration-fast"),
      medium: duration("--duration-medium"),
      slow: duration("--duration-slow"),
      curve: cubicCurve(raw(light, "--ease-standard", "light")),
    },
    material: {
      light: materialMode(light, "light"),
      dark: materialMode(dark, "dark"),
      blur: length("--astryx-theme-xgent-glass-material-blur"),
      saturation: fraction(
        raw(light, "--astryx-theme-xgent-glass-material-saturation", "light"),
        Number(fallback("--astryx-theme-xgent-glass-material-saturation", "light")),
      ),
    },
    fontScale: settings.customSettings.fontScale[fontZone],
  };
}
