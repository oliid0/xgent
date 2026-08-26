import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const implementations = [
  {
    label: "Unified frontend",
    loader: createTsModuleLoader(),
    page: new URL("../../src/pages/skills-hub/SkillsHubPage.tsx", import.meta.url),
  },
];

function skill(name, installedAt = null) {
  return {
    name,
    description: name,
    skillFile: `${name}/SKILL.md`,
    baseDir: name,
    installedAt,
  };
}

for (const { label, loader, page } of implementations) {
  const sorting = loader.loadModule("src/lib/skills/installedSort.ts");

  test(`${label} keeps built-ins ahead of enabled and disabled skills`, () => {
    const items = [
      skill("z-disabled"),
      skill("z-enabled"),
      skill("skills-creator"),
      skill("skills-installer"),
      skill("a-disabled"),
    ];
    const selected = new Set(["z-enabled"]);

    assert.deepEqual(
      sorting
        .sortInstalledSkillItems(items, "name-asc", selected, (item) => item)
        .map((item) => item.name),
      ["skills-creator", "skills-installer", "z-enabled", "a-disabled", "z-disabled"],
    );
    assert.deepEqual(
      sorting
        .sortInstalledSkillItems(items, "name-desc", selected, (item) => item)
        .map((item) => item.name),
      ["skills-installer", "skills-creator", "z-enabled", "z-disabled", "a-disabled"],
    );
    assert.deepEqual(
      items.map((item) => item.name),
      ["z-disabled", "z-enabled", "skills-creator", "skills-installer", "a-disabled"],
      "sorting must not mutate the discovery result",
    );
  });

  test(`${label} sorts newest installs within enabled groups and leaves missing dates last`, () => {
    const items = [
      skill("disabled-missing"),
      skill("enabled-missing"),
      skill("skills-creator", 50),
      skill("disabled-old", 100),
      skill("enabled-old", 200),
      skill("skills-installer", 600),
      skill("disabled-new", 500),
    ];
    const selected = new Set(["enabled-missing", "enabled-old"]);

    assert.deepEqual(
      sorting
        .sortInstalledSkillItems(items, "installed-desc", selected, (item) => item)
        .map((item) => item.name),
      [
        "skills-installer",
        "skills-creator",
        "enabled-old",
        "enabled-missing",
        "disabled-new",
        "disabled-old",
        "disabled-missing",
      ],
    );
  });

  test(`${label} validates persisted installed sort values`, () => {
    assert.equal(sorting.isInstalledSkillSort("name-asc"), true);
    assert.equal(sorting.isInstalledSkillSort("name-desc"), true);
    assert.equal(sorting.isInstalledSkillSort("installed-desc"), true);
    assert.equal(sorting.isInstalledSkillSort("downloads"), false);
    assert.equal(sorting.isInstalledSkillSort(null), false);
  });

  test(`${label} wires visual order, selection order, persistence, and reduced-motion FLIP`, () => {
    const source = readFileSync(page, "utf8");

    assert.match(source, /skillsHub\.installedSort/);
    assert.match(source, /sortInstalledSkillItems\(filtered, installedSort, selected/);
    assert.match(source, /sortedFiltered\.map/);
    assert.match(source, /sortedFiltered[\s\S]*handleBulkInstalledCardClick/);
    assert.match(source, /ref=\{installedGridRef\}/);
    assert.equal(source.match(/data-flip-key=\{key\}/g)?.length, 2);
    assert.match(source, /prefers-reduced-motion: reduce/);
    assert.match(source, /import \{ Switch \} from "@astryxdesign\/core\/Switch"/);
    assert.match(source, /import \{ Tab, TabList \} from "@astryxdesign\/core\/TabList"/);
    assert.match(source, /import \{ TextInput \} from "@astryxdesign\/core\/TextInput"/);
    assert.match(source, /followElement\?\.scrollIntoView\(\{/);
    assert.match(source, /block: "nearest"/);
    assert.match(source, /behavior: reducedMotion \? "auto" : "smooth"/);
    assert.match(source, /left: rect\.left - gridRect\.left/);
    assert.match(source, /top: rect\.top - gridRect\.top/);
    assert.match(source, /const previousOrderRef = useRef<string\[\]>\(\[\]\)/);
    assert.match(source, /const orderChanged =/);
    assert.match(source, /!orderChanged/);
    assert.match(
      source,
      /requestInstalledSkillFlip\("single", \[name\], on \? \[name\] : \[\]\)/,
    );
    assert.match(
      source,
      /requestInstalledSkillFlip\("batch", changedNames, target \? changedNames : \[\]\)/,
    );
    assert.match(source, /const followKeys = followNames\.map/);
    assert.match(source, /requestInstalledFlip\(mode, keys, followKeys\)/);
    assert.match(
      source,
      /const followNames = changedNames\.filter\([\s\S]*restoreSet\.has\(name\) && !current\.has\(name\)/,
    );
    assert.match(source, /requestInstalledSkillFlip\("batch", changedNames, followNames\)/);
    assert.match(source, /overflow-y-auto[^"]*\[overflow-anchor:none\]/);
    assert.match(source, /requestInstalledFlip\("wave", \[\], followKey \? \[followKey\] : \[\]\)/);
    assert.match(source, /const FLIP_HERO_DURATION_MS = 380/);
    assert.match(source, /const FLIP_BATCH_HERO_DELAY_MS = 90/);
    assert.match(source, /const FLIP_BATCH_STAGGER_LIMIT = 8/);
    assert.match(source, /cubic-bezier\(0\.34, 1\.3, 0\.64, 1\)/);
    assert.match(source, /const FLIP_WAVE_DURATION_MS = 280/);
    assert.match(source, /const FLIP_WAVE_DELAY_MS = 30/);
    assert.match(source, /const FLIP_WAVE_MAX_DELAY_MS = 400/);
    assert.match(source, /if \(mode === "batch"\)/);
    assert.match(source, /const heroPhaseDuration =/);
    assert.match(source, /phaseTimerRef\.current = window\.setTimeout/);
    assert.match(source, /window\.clearTimeout\(phaseTimerRef\.current\)/);
    assert.match(source, /startWave\(\)/);
    assert.match(source, /element\.style\.willChange = "translate"/);
    assert.match(source, /element\.style\.willChange = ""/);
    assert.match(source, /element\.style\.zIndex = "30"/);
    assert.match(source, /element\.style\.zIndex = ""/);
    assert.match(source, /clearAnimation\(\);[\s\S]*const grid = gridRef\.current/);
    assert.match(source, /element\.style\.translate/);
    assert.match(source, /<Banner/);
    assert.match(source, /<Switch[\s\S]*onChange=\{setSkillsEnabled\}/);
    assert.match(source, /<TabList[\s\S]*role="tablist"/);
    assert.match(source, /panelId="skills-panel-installed"/);
    assert.match(source, /<TextInput[\s\S]*startIcon=\{Search\}[\s\S]*hasClear/);
    assert.doesNotMatch(source, /role="switch"/);
    assert.doesNotMatch(source, /HubSegmentedControl/);
    assert.match(source, /id=\{`skills-panel-\$\{view\}`\}/);
    assert.match(source, /role="tabpanel"/);
    assert.match(source, /<Badge label=\{selectableSkills\.length\}/);
    assert.doesNotMatch(source, /AstryxInput/);
  });
}
