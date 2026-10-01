// Shared appearance fallback values; manually maintained independently of native UI.
// Resolved Astryx tokens override these values in nativeTheme.ts.
export const presentationThemeTokens = {
  "--color-accent": {
    fallback: ["#0088ff", "#0a84ff"],
  },
  "--color-text-accent": {
    fallback: ["#006edc", "#6eb4ff"],
  },
  "--color-on-accent": {
    fallback: ["#ffffff", "#ffffff"],
  },
  "--color-neutral": {
    fallback: ["#0536591a", "#dfe2e533"],
  },
  "--color-error": {
    fallback: ["#e3193b", "#f5394f"],
  },
  "--color-on-error": {
    fallback: ["#ffffff", "#ffffff"],
  },
  "--color-background-body": {
    fallback: ["#f5f5f7", "#171717"],
  },
  "--color-background-surface": {
    fallback: ["#ffffff", "#212121"],
  },
  "--color-background-card": {
    fallback: ["#ffffff", "#2a2a2a"],
  },
  "--color-background-popover": {
    fallback: ["#ffffff", "#2a2a2a"],
  },
  "--color-background-muted": {
    fallback: ["#eeeeef", "#303030"],
  },
  "--color-text-primary": {
    fallback: ["#0d0d0d", "#ececec"],
  },
  "--color-text-secondary": {
    fallback: ["#6e6e73", "#b4b4b4"],
  },
  "--color-text-disabled": {
    fallback: ["#8e8e93", "#7c7c80"],
  },
  "--color-border": {
    fallback: ["#0000001a", "#ffffff1f"],
  },
  "--color-border-emphasized": {
    fallback: ["#d9d9d9", "#4a4a4a"],
  },
  "--color-shadow": {
    fallback: ["#000000", "#000000"],
  },
  "--radius-inner": {
    fallback: [8, 8],
  },
  "--radius-element": {
    fallback: [14, 14],
  },
  "--radius-container": {
    fallback: [26, 26],
  },
  "--radius-page": {
    fallback: [32, 32],
  },
  "--radius-chat": {
    fallback: [28, 28],
  },
  "--spacing-1": {
    fallback: [4, 4],
  },
  "--spacing-2": {
    fallback: [8, 8],
  },
  "--spacing-3": {
    fallback: [12, 12],
  },
  "--spacing-4": {
    fallback: [16, 16],
  },
  "--spacing-6": {
    fallback: [24, 24],
  },
  "--size-element-sm": {
    fallback: [32, 32],
  },
  "--size-element-md": {
    fallback: [40, 40],
  },
  "--size-element-lg": {
    fallback: [44, 44],
  },
  "--font-size-xs": {
    fallback: [12, 12],
  },
  "--font-size-sm": {
    fallback: [13, 13],
  },
  "--font-size-base": {
    fallback: [15, 15],
  },
  "--duration-fast": {
    fallback: [120, 120],
  },
  "--duration-medium": {
    fallback: [240, 240],
  },
  "--duration-slow": {
    fallback: [650, 650],
  },
  "--ease-standard": {
    fallback: ["cubic-bezier(0.2, 0, 0, 1)", "cubic-bezier(0.2, 0, 0, 1)"],
  },
  "--astryx-theme-xgent-glass-material-surface-opacity": {
    fallback: [0.8, 0.72],
  },
  "--astryx-theme-xgent-glass-material-popover-opacity": {
    fallback: [0.88, 0.8],
  },
  "--astryx-theme-xgent-glass-material-blur": {
    fallback: [28, 28],
  },
  "--astryx-theme-xgent-glass-material-saturation": {
    fallback: [1.45, 1.45],
  },
  "--astryx-theme-xgent-glass-material-shadow-opacity": {
    fallback: [0.1, 0.34],
  },
} as const;

export type PresentationTokenName = keyof typeof presentationThemeTokens;
