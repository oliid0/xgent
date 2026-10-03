import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const helper = path.join(root, "scripts/release/prepare-apple-ui-resources.py");
const python = process.platform === "win32" ? "python" : "python3";
function run(...args) {
  return spawnSync(python, [helper, ...args], { encoding: "utf8" });
}
function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "xgent-apple-resources-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("static Apple UI copies complete localization and shader bundles, preserving other app resources", (t) => {
  const directory = fixture(t);
  const binary = path.join(directory, "swift-product"), resources = path.join(directory, "Xgent.app/Contents/Resources");
  const localization = "KeyboardShortcuts_KeyboardShortcuts.bundle/zh-Hans.lproj/Localizable.strings";
  const shader = "SwiftTerm_SwiftTerm.bundle/default.metallib";
  const fonts = ["Main-Regular", "Math-Italic", "Size4-Regular"].map((name) =>
    [`SwaTex_SwaTexRender.bundle/Fonts/KaTeX_${name}.ttf`, "font"]);
  for (const [name, content] of [[localization, '"space_key" = "空格";'], [shader, "shader"], ...fonts]) {
    const file = path.join(binary, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  writeFileSync(path.join(binary, "libXgentNativeUI.a"), "archive");
  mkdirSync(resources, { recursive: true });
  writeFileSync(path.join(resources, "icon.icns"), "icon");
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run("copy", binary, resources);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.match(readFileSync(path.join(resources, localization), "utf8"), /空格/);
  assert.equal(readFileSync(path.join(resources, shader), "utf8"), "shader");
  assert.equal(readFileSync(path.join(resources, "icon.icns"), "utf8"), "icon");
  assert.equal(existsSync(path.join(resources, "libXgentNativeUI.a")), false);
  assert.equal(run("verify-macos", resources).status, 0);
  rmSync(path.join(resources, shader));
  assert.notEqual(run("verify-macos", resources).status, 0, "A bundle directory without shaders is insufficient");
  const missing = path.join(directory, "empty");
  mkdirSync(missing);
  assert.notEqual(run("copy", missing, resources).status, 0, "Missing production resources must fail packaging");
});

test("IPA resource checks accept only terminal shaders carried inside the installed main application", (t) => {
  const directory = fixture(t);
  const ipa = path.join(directory, "Xgent.ipa");
  for (const valid of [true, false]) {
    const result = spawnSync(python, ["-c",
      "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr(sys.argv[2],'shader'); " +
      "[z.writestr('Payload/Xgent.app/SwaTex_SwaTexRender.bundle/Fonts/KaTeX_'+name+'.ttf','font') for name in ['Main-Regular','Math-Italic','Size4-Regular']]; z.close()",
      ipa, valid ? "Payload/Xgent.app/SwiftTerm_SwiftTerm.bundle/Shaders.metal" : "ci-build/SwiftTerm_SwiftTerm.bundle/Shaders.metal",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(run("verify-ios", ipa).status === 0, valid);
  }
});

test("math font lookup uses signed app resources and fails closed when its pinned source changes", (t) => {
  const directory = fixture(t);
  const source = path.join(directory, "SwaTex/Sources/SwaTexRender/KaTeXFontProvider.swift");
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, 'import Foundation\n            let url = Bundle.module.url(\n                forResource: name, withExtension: "ttf", subdirectory: "Fonts"),\n');
  assert.equal(run("patch-math", directory).status, 0);
  const patched = readFileSync(source, "utf8");
  assert.match(patched, /Bundle\.main\.resourceURL/);
  assert.match(patched, /SwaTex_SwaTexRender\.bundle/);
  assert.doesNotMatch(patched, /Bundle\.module/);
  assert.equal(run("patch-math", directory).status, 0);
  assert.equal(readFileSync(source, "utf8"), patched);
  writeFileSync(source, "import Foundation\n// Changed upstream loader\n");
  assert.notEqual(run("patch-math", directory).status, 0);
});

test("pinned shortcut resource compatibility is idempotent and rejects upstream lookup drift", (t) => {
  const directory = fixture(t);
  const source = path.join(directory, "KeyboardShortcuts/Sources/KeyboardShortcuts/Utilities.swift");
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, "import AppKit\nextension String { var localized: String { NSLocalizedString(self, bundle: .module, comment: self) } }\n");
  chmodSync(source, 0o444);
  const first = run("patch-keyboard", directory);
  assert.equal(first.status, 0, first.stderr);
  const patched = readFileSync(source, "utf8");
  assert.match(patched, /bundle: xgentKeyboardShortcutResourceBundle/);
  assert.match(patched, /Bundle\.main\.resourceURL/);
  assert.match(patched, /KeyboardShortcuts_KeyboardShortcuts\.bundle/);
  assert.match(patched, /return \.module/);
  assert.equal(run("patch-keyboard", directory).status, 0);
  assert.equal(readFileSync(source, "utf8"), patched);
  writeFileSync(source, "import AppKit\n// The upstream loader changed.\n");
  assert.notEqual(run("patch-keyboard", directory).status, 0);
});
