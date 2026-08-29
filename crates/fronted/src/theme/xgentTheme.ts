import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

/**
 * Product theme derived through Astryx's public theme surface.
 * The values keep Neutral's semantic palette and icon registry while tuning
 * density and surface hierarchy toward the quiet, content-first chat UI used
 * by the supplied ChatGPT references.
 */
export const xgentTheme = defineTheme({
  name: "xgent-chat",
  extends: neutralTheme,
  typography: {
    scale: { base: 15, ratio: 1.18 },
    body: {
      family: "system-ui",
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    heading: {
      family: "system-ui",
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      weights: { 3: "semibold", 4: "semibold" },
    },
    code: {
      family: "ui-monospace",
      fallbacks: '"SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  },
  radius: { base: 4, multiplier: 1 },
  motion: {
    fast: 120,
    medium: 240,
    slow: 650,
    ratio: 0.75,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  },
  tokens: {
    "--color-background-body": ["#f7f7f8", "#171717"],
    "--color-background-surface": ["#ffffff", "#212121"],
    "--color-background-card": ["#ffffff", "#2f2f2f"],
    "--color-background-popover": ["#ffffff", "#2f2f2f"],
    "--color-background-muted": ["#f3f3f3", "#2f2f2f"],
    "--color-text-primary": ["#0d0d0d", "#ececec"],
    "--color-text-secondary": ["#5d5d5d", "#b4b4b4"],
    "--color-icon-primary": ["#0d0d0d", "#ececec"],
    "--color-icon-secondary": ["#6b6b6b", "#b4b4b4"],
    "--color-border": ["#00000014", "#ffffff1a"],
    "--color-border-emphasized": ["#d9d9d9", "#4a4a4a"],
    "--color-neutral": ["#0000000d", "#ffffff1a"],
    "--size-element-sm": "30px",
    "--size-element-md": "36px",
    "--size-element-lg": "40px",
    "--radius-inner": "6px",
    "--radius-element": "10px",
    "--radius-container": "16px",
    "--radius-page": "24px",
    "--radius-chat": "26px",
    "--shadow-low":
      "0 1px 2px light-dark(rgb(0 0 0 / 5%), rgb(0 0 0 / 22%)), 0 4px 12px light-dark(rgb(0 0 0 / 6%), rgb(0 0 0 / 30%))",
    "--shadow-med":
      "0 2px 6px light-dark(rgb(0 0 0 / 7%), rgb(0 0 0 / 28%)), 0 10px 28px light-dark(rgb(0 0 0 / 9%), rgb(0 0 0 / 42%))",
    "--shadow-high":
      "0 8px 24px light-dark(rgb(0 0 0 / 10%), rgb(0 0 0 / 38%)), 0 24px 64px light-dark(rgb(0 0 0 / 10%), rgb(0 0 0 / 55%))",
  },
  components: {
    button: {
      "variant:primary": { borderRadius: "var(--radius-full)" },
      "variant:secondary": { borderRadius: "var(--radius-full)" },
    },
    card: {
      base: {
        borderRadius: "var(--radius-container)",
        padding: "var(--spacing-3)",
      },
    },
    "chat-composer": {
      base: {
        backgroundColor: "var(--color-background-surface)",
        borderRadius: "var(--radius-chat)",
        boxShadow: "var(--shadow-low)",
      },
    },
    "chat-message-bubble": {
      base: { borderRadius: "18px" },
    },
    dialog: {
      base: {
        borderRadius: "22px",
        boxShadow: "var(--shadow-high)",
      },
    },
    "dropdown-menu": {
      base: {
        borderRadius: "16px",
        boxShadow: "var(--shadow-med)",
        padding: "var(--spacing-2)",
      },
    },
    "dropdown-menu-item": {
      base: { borderRadius: "var(--radius-element)" },
    },
    "list-item": {
      base: { borderRadius: "var(--radius-element)" },
    },
    "popover-surface": {
      base: {
        borderRadius: "20px",
        boxShadow: "var(--shadow-med)",
      },
    },
    selector: {
      base: { borderRadius: "var(--radius-element)" },
    },
    "selector-option-row": {
      base: { borderRadius: "var(--radius-element)" },
    },
    "selector-popup": {
      base: {
        borderRadius: "16px",
        boxShadow: "var(--shadow-med)",
      },
    },
    "text-input": {
      base: { borderRadius: "var(--radius-element)" },
    },
  },
});
