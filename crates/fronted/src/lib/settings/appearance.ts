export const UI_THEME_PRESETS = ["current", "stone", "matcha"] as const;
export type AppearanceSettings = {
  preset: (typeof UI_THEME_PRESETS)[number];
  customized: boolean;
  accentLight: string;
  accentDark: string;
  sidebarLight: string;
  sidebarDark: string;
  radius: number;
};

export function normalizeAppearance(input: unknown): AppearanceSettings {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const color = (value: unknown, fallback: string) =>
    typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  return {
    preset: obj.preset === "stone" || obj.preset === "matcha" ? obj.preset : "current",
    customized: obj.customized === true,
    accentLight: color(obj.accentLight, "#2563eb"),
    accentDark: color(obj.accentDark, "#93c5fd"),
    sidebarLight: color(obj.sidebarLight, "#edf3f8"),
    sidebarDark: color(obj.sidebarDark, "#171717"),
    radius:
      typeof obj.radius === "number" && Number.isFinite(obj.radius)
        ? Math.round(Math.max(0, Math.min(32, obj.radius)))
        : 16,
  };
}
