import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const headerSources = [
  readFileSync(
    new URL("../../src/pages/chat/components/ChatHeader.tsx", import.meta.url),
    "utf8",
  ),
];

const executionModes = ["text", "tools", "agent-dev"];

test("model pickers use popover semantics instead of menu semantics", () => {
  for (const source of headerSources) {
    assert.match(source, /import \{ ComplexSelector \} from "@astryxdesign\/core\/ComplexSelector"/);
    assert.match(source, /<ComplexSelector<string>/);
    assert.match(source, /label=\{t\("chat\.selectModel"\)\}/);
    assert.match(source, /placement="below"/);
    assert.doesNotMatch(source, /DropdownMenu/);
    assert.doesNotMatch(source, /@base-ui\/react/);
  }
});

test("execution mode switchers use Astryx single-select semantics", () => {
  for (const source of headerSources) {
    assert.match(source, /import \{ SegmentedControl, SegmentedControlItem \}/);
    assert.match(source, /<SegmentedControl/);
    assert.match(source, /value=\{props\.executionMode\}/);
    assert.match(source, /label=\{t\("settings\.executionMode"\)\}/);
    for (const mode of executionModes) {
      assert.match(source, new RegExp(`<SegmentedControlItem value="${mode}"`));
    }
    assert.match(source, /onChange=\{\(value\) => props\.onSelectExecutionMode/);
  }
});

test("popover interactions preserve mode changes and close after model selection", () => {
  for (const source of headerSources) {
    assert.match(source, /onOpenChange=\{\(next\) =>/);
    assert.match(source, /isSelected=\{isSelected\}/);
    assert.match(source, /props\.onChange\(option\.value\);\s+props\.close\(\);/);
  }
});

test("model pickers search models and providers", () => {
  for (const source of headerSources) {
    assert.match(source, /<TextInput/);
    assert.match(source, /hasAutoFocus/);
    assert.match(source, /placeholder=\{t\("chat\.searchModel"\)\}/);
    assert.match(source, /\w+\.model\.toLowerCase\(\)\.includes\(normalizedSearch\)/);
    assert.match(source, /\w+\.providerName\.toLowerCase\(\)\.includes\(normalizedSearch\)/);
    assert.match(source, /t\("chat\.noModelFound"\)/);
  }
});
