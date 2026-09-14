import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const icons = readSource("src/components/icons.tsx");
const workspacePanel = readSource("src/components/workspace-tools/WorkspaceSidePanel.tsx");
const cronModal = readSource("src/pages/settings/CronTaskModal.tsx");
const nativeSettings = readSource("src/presentation/NativeSettingsPage.tsx");

test("shared client chrome uses Astryx semantics and one trajectory header", () => {
  for (const name of [
    "warning", "check", "success", "chevronDown", "chevronLeft", "chevronRight", "clock", "copy",
    "externalLink", "eyeSlash", "info", "menu", "microphone", "moreHorizontal", "search",
    "stop", "wrench", "close", "error",
  ]) {
    assert.match(icons, new RegExp(`createIcon\\(\\"${name}\\"\\)`));
  }
  assert.match(workspacePanel, /props\.embedded \|\| props\.target === "trajectory"/);
  assert.match(workspacePanel, /ConversationTrajectorySurface[\s\S]*?onClose=\{props\.onClose\}/);
  assert.doesNotMatch(cronModal, /Clock3/);
});

test("native mobile shell settings expose real install, cancellation and folder actions", () => {
  for (const operation of [
    "installMobileEnvironment", "installMobileToolchains", "cancelMobileExecution",
    "listExternalMobileWorkspaces", "pickExternalMobileWorkspace", "removeExternalMobileWorkspace",
  ]) {
    assert.match(nativeSettings, new RegExp(`\\b${operation}\\b`));
  }
  for (const group of ["shell", "shell-packs", "shell-workspaces"]) {
    assert.match(nativeSettings, new RegExp(`c\\.group\\(\\"${group}\\"`));
  }
});
