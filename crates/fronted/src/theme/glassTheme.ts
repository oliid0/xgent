import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

// Extend the installed theme package; never make the whole application translucent.
// The preference variables in glassTheme.css also reach Astryx portal theme scopes.
const surface = {
  backgroundColor: "var(--astryx-theme-xgent-glass-surface)",
  backdropFilter: "var(--xgent-material-filter, none)",
  WebkitBackdropFilter: "var(--xgent-material-filter, none)",
};
const floatingSurface = {
  ...surface,
  backgroundColor: "var(--astryx-theme-xgent-glass-popover)",
  border: "1px solid var(--astryx-theme-xgent-glass-edge)",
};

export const glassTheme = defineTheme({
  name: "xgent-glass",
  extends: neutralTheme,
  localTokens: {
    "--astryx-theme-xgent-glass-surface":
      "color-mix(in srgb, var(--color-background-surface) var(--xgent-material-opacity, 100%), transparent)",
    "--astryx-theme-xgent-glass-popover":
      "color-mix(in srgb, var(--color-background-popover) var(--xgent-material-opacity, 100%), transparent)",
    "--astryx-theme-xgent-glass-edge": ["rgb(0 0 0 / 10%)", "rgb(255 255 255 / 18%)"],
  },
  components: {
    button: {
      "variant:secondary": {
        ...floatingSurface,
        borderRadius: "var(--radius-full)",
      },
    },
    card: { base: surface },
    "chat-composer": { base: floatingSurface },
    dialog: {
      base: floatingSurface,
      "variant:fullscreen": {
        backgroundColor: "var(--color-background-surface)",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        border: "none",
      },
    },
    "bottom-sheet": { base: floatingSurface },
    "dropdown-menu": { base: floatingSurface },
    "popover-surface": { base: floatingSurface },
    "selector-popup": { base: floatingSurface },
  },
});
