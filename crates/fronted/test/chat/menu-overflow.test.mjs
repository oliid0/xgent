import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const composerSource = readFileSync(
  new URL("../../src/pages/chat/components/ChatComposerBar.tsx", import.meta.url),
  "utf8",
);
const modelSelectorSource = readFileSync(
  new URL("../../src/pages/chat/components/ChatModelSelector.tsx", import.meta.url),
  "utf8",
);
const sidebarActionSource = readFileSync(
  new URL("../../src/components/workspace-tools/SidebarActionMenu.tsx", import.meta.url),
  "utf8",
);
const themeSource = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8");

test("scrollable Astryx menus hide scrollbar chrome without disabling scrolling", () => {
  assert.match(themeSource, /\.astryx-dropdown-menu/);
  assert.match(themeSource, /\.astryx-selector-popup/);
  assert.match(themeSource, /\.astryx-complex-selector-popup/);
  assert.match(themeSource, /scrollbar-width: none/);
  assert.match(themeSource, /-ms-overflow-style: none/);
  assert.match(themeSource, /::-webkit-scrollbar/);
  assert.doesNotMatch(themeSource, /\.astryx-dropdown-menu[^}]*overflow-y:\s*hidden/s);
  assert.match(sidebarActionSource, /<DropdownMenu/);
  assert.match(modelSelectorSource, /className="xgent-model-selector-list"/);
});

test("compact execution mode menu fits its descriptions without horizontal scrolling", () => {
  assert.match(composerSource, /className="xgent-command-safety-menu"/);
  assert.match(composerSource, /menuWidth="min\(28rem, calc\(100dvw - var\(--spacing-6\)\)\)"/);
  assert.match(composerSource, /style=\{\{ overflowX: "hidden" \}\}/);
  assert.match(composerSource, /className="xgent-command-safety-description"/);
  assert.match(themeSource, /\.xgent-command-safety-description\s*\{[^}]*white-space: normal/s);
  assert.match(themeSource, /\.xgent-command-safety-menu\s*\{[^}]*overflow-x: hidden/s);
});
