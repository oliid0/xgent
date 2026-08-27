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

const visibleExecutionModes = ["text", "tools"];

test("model pickers use popover semantics instead of menu semantics", () => {
  assert.match(
    modelSelectorSource,
    /import \{ ComplexSelector \} from "@astryxdesign\/core\/ComplexSelector"/,
  );
  assert.match(modelSelectorSource, /<ComplexSelector<string>/);
  assert.match(modelSelectorSource, /label=\{t\("chat\.selectModel"\)\}/);
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
