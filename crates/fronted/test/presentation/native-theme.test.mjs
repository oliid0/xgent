import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("native themes resolve Astryx tokens, CSS lengths, and per-surface font scale", () => {
  const loader = createTsModuleLoader({
    mocks: {
      "@astryxdesign/core/theme/tokens": {
        resolveThemeTokens: (_theme, { mode }) =>
          mode === "light"
            ? {
                "--color-accent": "#112233",
                "--color-background-body": "#f0f1f2",
                "--color-background-surface": "#ffffff",
                "--color-text-primary": "#101112",
                "--color-text-secondary": "#606162",
                "--color-border": "#0000001a",
                "--radius-element": "0.5rem",
                "--radius-container": "24px",
                "--radius-page": "30px",
                "--radius-chat": "2rem",
              }
            : {
                "--color-accent": "rgb(170 187 204 / 80%)",
                "--color-background-body": "#111213",
                "--color-background-surface": "#202122",
                "--color-text-primary": "#f0f1f2",
                "--color-text-secondary": "#b0b1b2",
                "--color-border": "#ffffff1f",
              },
      },
      "../theme/appearanceTheme": {
        createAppearanceTheme: () => ({
          name: "resolved",
          localTokens: {
            "--astryx-theme-xgent-glass-material-surface-opacity": "light-dark(81%, 64%)",
            "--astryx-theme-xgent-glass-material-popover-opacity": "light-dark(88%, 73%)",
            "--astryx-theme-xgent-glass-material-blur": "30px",
            "--astryx-theme-xgent-glass-material-saturation": "175%",
            "--astryx-theme-xgent-glass-material-shadow-opacity": "light-dark(0.15, 0.47)",
          },
        }),
      },
    },
  });
  const { createNativePresentationTheme } = loader.loadModule(
    "src/presentation/nativeTheme.ts",
  );
  const settings = {
    customSettings: {
      appearance: {},
      fontScale: { sidebar: 0.9, chat: 1.2, workspaceTools: 1 },
    },
  };
  const theme = createNativePresentationTheme(settings, true, "chat");
  assert.equal(theme.light.accent, "#112233");
  assert.equal(theme.dark.accent, "#aabbcccc");
  assert.equal(theme.dark.background, "#111213");
  assert.deepEqual(theme.radius, { inner: 8, element: 8, container: 24, overlay: 30, chat: 32 });
  assert.deepEqual(theme.spacing, { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 });
  assert.deepEqual(theme.control, { small: 32, medium: 40, large: 44 });
  assert.deepEqual(theme.motion.curve, [0.2, 0, 0, 1]);
  assert.equal(theme.material.light.surfaceOpacity, 0.81);
  assert.equal(theme.material.dark.shadowOpacity, 0.47);
  assert.equal(theme.material.blur, 30);
  assert.equal(theme.material.saturation, 1.75);
  assert.equal(theme.fontScale, 1.2);
});
