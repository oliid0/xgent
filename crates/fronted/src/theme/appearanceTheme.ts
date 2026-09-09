import { defineTheme } from "@astryxdesign/core/theme";
import { matchaTheme } from "@astryxdesign/theme-matcha";
import { stoneTheme } from "@astryxdesign/theme-stone";
import type { AppearanceSettings } from "../lib/settings/appearance";
import { xgentCompactTheme, xgentTheme } from "./xgentTheme";

export function createAppearanceTheme(appearance: AppearanceSettings, compact: boolean) {
  const base =
    appearance.preset === "stone"
      ? stoneTheme
      : appearance.preset === "matcha"
        ? matchaTheme
        : compact
          ? xgentCompactTheme
          : xgentTheme;
  if (appearance.preset === "current" && !appearance.customized) return base;
  return defineTheme({
    name: `xgent-${appearance.preset}-${compact ? "compact" : "desktop"}-appearance`,
    extends: base,
    ...(appearance.customized
      ? {
          color: { accent: [appearance.accentLight, appearance.accentDark] as [string, string] },
        }
      : {}),
    tokens: {
      ...(compact
        ? {
            "--size-element-sm": "32px",
            "--size-element-md": "40px",
            "--size-element-lg": "44px",
          }
        : {}),
      ...(appearance.customized
        ? {
            "--color-background-body": [appearance.sidebarLight, appearance.sidebarDark] as [
              string,
              string,
            ],
            "--radius-container": `${appearance.radius}px`,
            "--radius-element": `${Math.round(appearance.radius * 0.625)}px`,
            "--radius-chat": `${appearance.radius + 10}px`,
          }
        : { "--radius-chat": "26px" }),
    },
    components: {
      ...(appearance.customized
        ? {
            "chat-message-bubble": {
              "sender:user": {
                backgroundColor: "var(--color-accent-muted)",
                color: "var(--color-text-primary)",
              },
            },
          }
        : {}),
      "chat-composer": {
        base: {
          backgroundColor: "var(--color-background-surface)",
          borderRadius: "var(--radius-chat)",
          boxShadow: "var(--shadow-low)",
        },
      },
    },
  });
}
