import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const loader = createTsModuleLoader({ mocks: {
  "@astryxdesign/core/Switch": { Switch: "switch" },
  "../../../components/icons": { Sparkle: "icon" },
  "../../../i18n": { useLocale: () => ({ t: key => key }) },
} });
const { IntelligentSchedulingControl } = loader.loadModule("src/pages/chat/components/IntelligentSchedulingControl.tsx");

test("composer + control starts off, dispatches exact runtime patches and respects chat/input locks", () => {
  const patches = [];
  const props = { controls: {}, disabled: false, agentMode: true, onChange: patch => patches.push(JSON.parse(JSON.stringify(patch))) };
  const off = IntelligentSchedulingControl(props);
  assert.equal(off.props.value, false); assert.equal(off.props.isDisabled, false);
  off.props.onChange(true);
  const on = IntelligentSchedulingControl({ ...props, controls: patches[0] });
  assert.equal(on.props.value, true); on.props.onChange(false);
  assert.deepEqual(patches, [{ intelligentSchedulingEnabled: true }, { intelligentSchedulingEnabled: false }]);
  for (const overrides of [{ disabled: true }, { agentMode: false }]) {
    const disabled = IntelligentSchedulingControl({ ...props, ...overrides });
    assert.equal(disabled.props.isDisabled, true); disabled.props.onChange(true);
  }
  assert.equal(patches.length, 2);
});
