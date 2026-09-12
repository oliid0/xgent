import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

// Extend the installed theme package; never make the whole application translucent.
// The preference variables in glassTheme.css also reach Astryx portal theme scopes.
const surface = {
  backgroundColor: "var(--astryx-theme-xgent-glass-surface)",
  backdropFilter: "var(--xgent-material-filter, none)",
  WebkitBackdropFilter: "var(--xgent-material-filter, none)",
  border: "1px solid var(--astryx-theme-xgent-glass-edge)",
  boxShadow: "inset 0 1px 0 var(--astryx-theme-xgent-glass-highlight)",
};
const floatingSurface = {
  ...surface,
  backgroundColor: "var(--astryx-theme-xgent-glass-popover)",
  boxShadow:
    "inset 0 1px 0 var(--astryx-theme-xgent-glass-highlight), inset 0 -1px 0 var(--astryx-theme-xgent-glass-edge), var(--shadow-med)",
};

export const glassTheme = defineTheme({
  name: "xgent-glass",
  extends: neutralTheme,
  localTokens: {
    "--astryx-theme-xgent-glass-material-surface-opacity": ["80%", "72%"],
    "--astryx-theme-xgent-glass-material-popover-opacity": ["88%", "80%"],
    "--astryx-theme-xgent-glass-material-blur": "28px",
    "--astryx-theme-xgent-glass-material-saturation": "145%",
    "--astryx-theme-xgent-glass-material-shadow-opacity": ["0.1", "0.34"],
    "--astryx-theme-xgent-glass-surface":
      "color-mix(in srgb, var(--color-background-surface) var(--astryx-theme-xgent-glass-material-surface-opacity, 100%), transparent)",
    "--astryx-theme-xgent-glass-popover":
      "color-mix(in srgb, var(--color-background-popover) var(--astryx-theme-xgent-glass-material-popover-opacity, 100%), transparent)",
    "--astryx-theme-xgent-glass-edge": ["rgb(0 0 0 / 8%)", "rgb(255 255 255 / 14%)"],
    "--astryx-theme-xgent-glass-highlight": ["rgb(255 255 255 / 46%)", "rgb(255 255 255 / 12%)"],
  },
  components: {
    button: {
      "variant:secondary": {
        ...floatingSurface,
        borderRadius: "var(--radius-element)",
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
    popover: { base: floatingSurface },
    "selector-popup": { base: floatingSurface },
  },
});
