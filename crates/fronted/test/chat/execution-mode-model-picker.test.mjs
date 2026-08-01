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
    assert.match(source, /import \{ Popover \} from "@base-ui\/react"/);
    assert.match(source, /<Popover\.Root open=\{isModelPickerOpen\}/);
    assert.match(source, /<Popover\.Popup/);
    assert.match(source, /aria-label=\{t\("chat\.selectModel"\)\}/);
    assert.doesNotMatch(source, /DropdownMenu/);
  }
});

test("execution mode switchers expose a native radio group", () => {
  for (const source of headerSources) {
    assert.match(source, /role="radiogroup"/);
    assert.match(source, /aria-label=\{t\("settings\.executionMode"\)\}/);
    assert.equal((source.match(/type="radio"/g) ?? []).length, executionModes.length);
    for (const mode of executionModes) {
      assert.match(source, new RegExp(`value="${mode}"`));
      assert.match(source, new RegExp(`checked=\\{executionMode === "${mode}"\\}`));
      assert.match(
        source,
        new RegExp(`onChange=\\{\\(\\) => onSelectExecutionMode\\("${mode}"\\)\\}`),
      );
    }
    assert.match(source, /has-\[:focus-visible\]:ring-2/);
  }
});

test("popover interactions preserve mode changes and close after model selection", () => {
  for (const source of headerSources) {
    assert.match(source, /onClick=\{\(\) => toggleGroup\(group\.id\)\}/);
    assert.match(source, /aria-pressed=\{isSelected\}/);
    assert.match(source, /onSelectModel\(parsed\);\s+setIsModelPickerOpen\(false\);/);
  }
});

test("model pickers search models and providers", () => {
  for (const source of headerSources) {
    assert.match(source, /initialFocus=\{searchInputRef\}/);
    assert.match(source, /placeholder=\{t\("chat\.searchModel"\)\}/);
    assert.match(source, /\w+\.model\.toLowerCase\(\)\.includes\(normalizedSearch\)/);
    assert.match(source, /\w+\.providerName\.toLowerCase\(\)\.includes\(normalizedSearch\)/);
    assert.match(source, /t\("chat\.noModelFound"\)/);
  }
});
