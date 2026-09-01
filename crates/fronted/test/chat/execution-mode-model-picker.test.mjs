import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const headerSource = readFileSync(
  new URL("../../src/pages/chat/components/ChatHeader.tsx", import.meta.url),
  "utf8",
);
const modelSelectorSource = readFileSync(
  new URL("../../src/pages/chat/components/ChatModelSelector.tsx", import.meta.url),
  "utf8",
);
const composerSource = readFileSync(
  new URL("../../src/pages/chat/components/ChatComposerBar.tsx", import.meta.url),
  "utf8",
);
const chatPageSource = readFileSync(new URL("../../src/pages/ChatPage.tsx", import.meta.url), "utf8");
const appStyles = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8");
const sidebarSource = readFileSync(
  new URL("../../src/components/chat/ChatHistorySidebar.tsx", import.meta.url),
  "utf8",
);
const railSource = readFileSync(
  new URL("../../src/components/workspace-tools/WorkspaceNavigationRail.tsx", import.meta.url),
  "utf8",
);

const visibleExecutionModes = ["text", "tools"];

test("model pickers use popover semantics instead of menu semantics", () => {
  assert.match(
    modelSelectorSource,
    /import \{ ComplexSelector \} from "@astryxdesign\/core\/ComplexSelector"/,
  );
  assert.match(modelSelectorSource, /<ComplexSelector<string>/);
  assert.match(modelSelectorSource, /label=\{t\("chat\.selectModel"\)\}/);
  assert.match(modelSelectorSource, /label=\{t\("chat\.selectModel"\)\}\s+isLabelHidden/);
  assert.match(modelSelectorSource, /placement="above"/);
  assert.doesNotMatch(modelSelectorSource, /DropdownMenu/);
  assert.doesNotMatch(modelSelectorSource, /@base-ui\/react/);
});

test("execution mode switchers use Astryx single-select semantics", () => {
  assert.match(headerSource, /import \{ SegmentedControl, SegmentedControlItem \}/);
  assert.match(headerSource, /<SegmentedControl/);
  assert.match(
    headerSource,
    /const visibleExecutionMode = settings\.system\.executionMode === "text" \? "text" : "tools"/,
  );
  assert.match(headerSource, /value=\{visibleExecutionMode\}/);
  assert.match(headerSource, /label=\{t\("settings\.executionMode"\)\}/);
  for (const mode of visibleExecutionModes) {
    assert.match(headerSource, new RegExp(`<SegmentedControlItem value="${mode}"`));
  }
  assert.match(headerSource, /onChange=\{\(value\) => onSelectExecutionMode/);
});

test("expanded sidebar owns mode, search, and collapse controls", () => {
  assert.match(sidebarSource, /className="chat-sidebar-mode-bar/);
  assert.match(sidebarSource, /<SegmentedControl/);
  assert.match(sidebarSource, /label=\{t\("chat\.history\.search"\)\}/);
  assert.match(sidebarSource, /label=\{t\("sidebar\.closeSidebar"\)\}/);
  assert.match(chatPageSource, /className="workspace-navigation-rail-shell"/);
  assert.match(appStyles, /\.workspace-navigation-rail-shell\[data-panel-open="true"\]/);
});

test("permanent rail keeps hubs and files while duplicate workspace tools stay in the Soul menu", () => {
  const railItems = railSource.slice(
    railSource.indexOf("const items: RailItem[]"),
    railSource.indexOf("const selectFromSoulMenu"),
  );
  assert.match(railItems, /target: "conversations"/);
  assert.match(railItems, /target: "mcp"/);
  assert.match(railItems, /target: "skills"/);
  assert.match(railItems, /target: "fileTree"/);
  for (const target of ["terminal", "gitReview", "sshConnection", "backgroundTasks"]) {
    assert.doesNotMatch(railItems, new RegExp(`target: "${target}"`));
    if (target === "terminal") {
      assert.match(railSource, /selectFromSoulMenu\("terminal"\)/);
    } else {
      assert.match(railSource, new RegExp(`target: "${target}"`));
    }
  }
});

test("popover interactions preserve mode changes and close after model selection", () => {
  assert.match(modelSelectorSource, /isSelected=\{isSelected\}/);
  assert.match(
    modelSelectorSource,
    /props\.onChange\(option\.value\);\s+props\.close\(\);/,
  );
  assert.match(modelSelectorSource, /parseModelValue\(value\)/);
  assert.match(modelSelectorSource, /if \(parsed\) props\.onSelectModel\(parsed\)/);
});

test("model pickers search models and providers", () => {
  assert.match(modelSelectorSource, /<TextInput/);
  assert.match(modelSelectorSource, /hasAutoFocus/);
  assert.match(modelSelectorSource, /placeholder=\{t\("chat\.searchModel"\)\}/);
  assert.match(modelSelectorSource, /\w+\.model\.toLowerCase\(\)\.includes\(normalizedSearch\)/);
  assert.match(
    modelSelectorSource,
    /\w+\.providerName\.toLowerCase\(\)\.includes\(normalizedSearch\)/,
  );
  assert.match(modelSelectorSource, /t\("chat\.noModelFound"\)/);
});

test("composer exposes the requested controls through Astryx slots", () => {
  assert.match(composerSource, /<Popover/);
  assert.match(composerSource, /<ChatComposerDrawer>/);
  assert.match(composerSource, /<Thumbnail/);
  assert.match(composerSource, /planModeEnabled: value/);
  assert.match(composerSource, /nativeWebSearchEnabled: value/);
  assert.match(composerSource, /thinkingEnabled: value/);
  assert.match(composerSource, /settings\.commandSafety/);
  assert.match(composerSource, /<Selector[\s\S]*?settings\.commandSafety[\s\S]*?placement="above"/);
  assert.match(composerSource, /sendActions=\{/);
  assert.match(composerSource, /const usedTokens = Math\.max\(0, tokens \?\? 0\)/);
  assert.match(
    composerSource,
    /chat\.composer\.addMention[\s\S]*?insertText\("@"\)[\s\S]*?\.focus\(\)/,
  );
  assert.doesNotMatch(composerSource, /chat\.composer\.addCommand/);
});

test("composer git repository uses an in-popover drill-in menu", () => {
  const gitSource = readFileSync(
    new URL("../../src/pages/chat/components/ComposerGitRepositoryControl.tsx", import.meta.url),
    "utf8",
  );
  assert.match(gitSource, /const \[showOperations, setShowOperations\]/);
  assert.match(gitSource, /label=\{repositoryMenuLabel\}/);
  assert.match(gitSource, /endContent=\{<ChevronRight \/>\}/);
  assert.match(gitSource, /git\.branchSelector\.initRepository/);
  assert.match(gitSource, /git\.branchSelector\.refresh/);
  assert.doesNotMatch(gitSource, /<Popover/);
});

test("Skills and MCP side panels retain the Astryx resize handle width", () => {
  const skillsHubSource = readFileSync(
    new URL("../../src/pages/skills-hub/SkillsHubPage.tsx", import.meta.url),
    "utf8",
  );
  const mcpHubSource = readFileSync(
    new URL("../../src/pages/mcp-hub/McpHubPage.tsx", import.meta.url),
    "utf8",
  );
  const hubPanelRule = appStyles.slice(
    appStyles.indexOf('.workspace-side-panel[data-workspace-tool="skills"]'),
    appStyles.indexOf(".hub-page-embedded"),
  );
  assert.match(chatPageSource, /\? workspaceHubPanelResize\.props[\s\S]*: workspacePanelResize\.props/);
  assert.match(hubPanelRule, /min-width:\s*var\(--xgent-hub-panel-min-width\)/);
  assert.doesNotMatch(hubPanelRule, /width:\s*min\(/);
  assert.match(skillsHubSource, /className=\{embedded \? "hub-page-embedded" : undefined\}/);
  assert.match(mcpHubSource, /className=\{embedded \? "hub-page-embedded" : undefined\}/);
  assert.match(mcpHubSource, /padding=\{embedded \? 2 : 5\}/);
});

test("model selector keeps reasoning depth above provider model groups", () => {
  assert.match(modelSelectorSource, /import \{ RadioList, RadioListItem \}/);
  assert.match(
    modelSelectorSource,
    /COMPOSER_REASONING_ORDER[^=]*= \["minimal", "low", "medium", "high"\]/,
  );
  assert.ok(modelSelectorSource.indexOf("<RadioList") < modelSelectorSource.indexOf("<CollapsibleGroup"));
});

test("agent turns receive the composer plan-mode state", () => {
  assert.match(chatPageSource, /planModeEnabled: runtimeControls\.planModeEnabled/);
});
