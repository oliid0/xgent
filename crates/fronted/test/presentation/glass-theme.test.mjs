import assert from "node:assert/strict";
import test from "node:test";
import * as themeApi from "@astryxdesign/core/theme";
import * as neutral from "@astryxdesign/theme-neutral";
import * as stone from "@astryxdesign/theme-stone";
import * as matcha from "@astryxdesign/theme-matcha";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// Use the installed theme resolver: a mock would miss its local-token lineage checks.
const loader = createTsModuleLoader({ mocks: {
  "@astryxdesign/core/theme": themeApi,
  "@astryxdesign/theme-neutral": neutral,
  "@astryxdesign/theme-stone": stone,
  "@astryxdesign/theme-matcha": matcha,
} });
const { createAppearanceTheme } = loader.loadModule("src/theme/appearanceTheme.ts");
const { normalizeAppearance } = loader.loadModule("src/lib/settings/appearance.ts");

test("every preset and customized appearance resolves with the installed Astryx theme contract", () => {
  for (const preset of ["current", "stone", "matcha"]) {
    for (const compact of [false, true]) {
      for (const customized of [false, true]) {
        const appearance = normalizeAppearance({ preset, customized, accentLight: "#123456" });
        const theme = createAppearanceTheme(appearance, compact);
        assert.equal(typeof theme.tokens["--color-background-surface"], "string");
        if (preset === "current") {
          assert.match(theme.localTokens["--astryx-theme-xgent-glass-surface"], /color-mix/);
          assert.equal(
            theme.localTokens["--astryx-theme-xgent-glass-material-blur"],
            "28px",
          );
          assert.equal(theme.components["chat-composer"].base.backdropFilter, "var(--xgent-material-filter, none)");
          assert.equal(theme.components.popover.base.borderRadius, "var(--radius-page)");
          assert.equal(theme.components["popover-surface"], undefined);
          assert.equal(theme.components.dialog["variant:fullscreen"].backdropFilter, "none");
        }
      }
    }
  }
});
