import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const skill = { name: "slides", description: "Slides", baseDir: "slides", skillFile: "slides/SKILL.md" };
function harness(custom = false) {
  const hooks = createReactHookHarness();
  const loader = createTsModuleLoader({ mocks: { react: hooks.react } });
  const settings = loader.loadModule("src/lib/settings/index.ts");
  const { useComposerSkillSelection } = loader.loadModule("src/pages/chat/composer/useComposerSkillSelection.ts");
  let value = settings.getDefaultSettings();
  if (custom) value = settings.updateWorkspaceResourceSettings(value, "/project", {
    mode: "custom", skillNames: ["review"], mcpServerIds: [],
  });
  let writes = 0;
  let props = { availableSkills: [skill], conversationId: "conversation", workdir: "/project", enabled: true,
    setSettings: updater => { writes++; value = updater(value); } };
  return { settings, value: () => value, writes: () => writes,
    render: changes => { props = { ...props, ...changes }; return hooks.render(() => useComposerSkillSelection(props)); },
    unmount: () => hooks.unmount() };
}

test("installed Skill selection updates the effective inherited or custom workspace", () => {
  for (const custom of [false, true]) {
    const h = harness(custom);
    try {
      const original = h.value();
      assert.equal(h.render()(skill), true);
      const resources = h.settings.resolveWorkspaceResources(h.value(), "/project");
      assert.equal(resources.mode, custom ? "custom" : "inherit");
      assert.ok(resources.skillNames.includes("slides"));
      if (custom) { assert.ok(resources.skillNames.includes("review")); assert.deepEqual(h.value().skills, original.skills); }
      const selected = h.value();
      h.render()(skill); assert.equal(h.value(), selected, "repeated selection is idempotent");
    } finally { h.unmount(); }
  }
});

test("retired, disabled, removed and forged Skill choices cannot change resources", () => {
  const h = harness();
  try {
    const old = h.render();
    assert.equal(old({ ...skill, skillFile: "other/SKILL.md" }), false);
    assert.equal(old({ ...skill, name: "skills-creator" }), false);
    h.render({ conversationId: "next" }); assert.equal(old(skill), false);
    const next = h.render(); h.render({ workdir: "/next" }); assert.equal(next(skill), false);
    const disabled = h.render({ enabled: false }); assert.equal(disabled(skill), false);
    const removed = h.render({ enabled: true, availableSkills: [] }); assert.equal(removed(skill), false);
    const active = h.render({ availableSkills: [skill] }); h.unmount(); assert.equal(active(skill), false);
    assert.equal(h.writes(), 0);
  } finally { h.unmount(); }
});
