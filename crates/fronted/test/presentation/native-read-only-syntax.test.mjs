import assert from "node:assert/strict";
import test from "node:test";
import { tokenize, tokenizeAsync } from "@astryxdesign/core/CodeBlock";
import { resolveThemeTokens } from "@astryxdesign/core/theme/tokens";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { readOnlySyntaxPalette, readOnlySyntax, attachReadOnlySyntax } = loader.loadModule("src/presentation/nativeReadOnlySyntax.ts");
const { createAppearanceTheme } = loader.loadModule("src/theme/appearanceTheme.ts");
const { cssColor } = loader.loadModule("src/presentation/nativeColor.ts");
const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
const settings = preset => ({ customSettings: { appearance: { preset, customized: false } } });

test("native chat syntax uses the actual Astryx token ranges and UTF16 LF/CRLF offsets for every supported alias", async () => {
  const palette = readOnlySyntaxPalette(settings("current"), false);
  const languages = ["typescript", "javascript", "tsx", "jsx", "ts", "js", "json", "html", "xml", "svg", "css", "scss", "less", "python", "py", "bash", "sh", "zsh", "shell", "php", "hack", "yaml", "yml", "markdown", "md"];
  for (const language of languages) {
    const source = "\t🧭 const value = 42; <a href=\"text\">\r\n# comment\nprint('next')\n";
    const actual = await readOnlySyntax(source, language, palette);
    const expected = []; let offset = 0;
    for (const line of tokenize(source, language)) {
      for (const token of line) expected.push([offset + token.start, token.end - token.start, palette.types.indexOf(token.type)]);
      const newline = source.indexOf("\n", offset); offset = newline < 0 ? source.length : newline + 1;
    }
    assert.deepEqual(actual.runs, expected, language);
    assert.equal(actual.source, source);
    assert.equal(actual.styles, palette.styles);
  }
  const large = "const emoji = '🧭';\r\n".repeat(150);
  const result = await readOnlySyntax(large, "typescript", palette);
  assert.ok(result.runs.length > 150);
  assert.equal(result.source, large);
  assert.equal((await tokenizeAsync(large, "typescript")).length, 151);
  for (const language of ["swift", "rust", "unknown", "JSON", "plaintext"]) {
    assert.deepEqual((await readOnlySyntax(large, language, palette)).runs, [], "Match shared unsupported/case-sensitive behavior");
  }
});

test("read-only colors, backgrounds and header comments follow actual light/dark current/stone/matcha themes", () => {
  for (const preset of ["current", "stone", "matcha"]) {
    for (const compact of [false, true]) {
      const config = settings(preset), palette = readOnlySyntaxPalette(config, compact);
      const theme = createAppearanceTheme(config.customSettings.appearance, compact);
      for (const mode of ["light", "dark"]) {
        const resolved = resolveThemeTokens(theme, { mode });
        for (const [index, type] of palette.types.entries()) {
          assert.equal(palette.styles[index][mode], cssColor(resolved[`--color-syntax-${type}`], "invalid"));
          assert.match(palette.styles[index][mode], /^#[0-9a-f]{6}([0-9a-f]{2})?$/);
        }
      }
      assert.equal(readOnlySyntaxPalette(config, compact).signature, palette.signature);
    }
  }
  assert.notEqual(readOnlySyntaxPalette(settings("stone"), false).signature, readOnlySyntaxPalette(settings("matcha"), false).signature);
  assert.equal(cssColor("rgb(50% 0% 100% / 50%)", "invalid"), "#8000ff80");
  assert.equal(cssColor("rgba(1, 2, 3, 0.5)", "invalid"), "#01020380");
  assert.equal(cssColor("#abc8", "invalid"), "#aabbcc88");
  assert.equal(cssColor("rgb(NaN 0 0)", "invalid"), "invalid");
});

test("multiline comment and string tokens are clipped like the shared per-line range/span renderers", async () => {
  const palette = readOnlySyntaxPalette(settings("current"), false);
  for (const [language, source] of [["javascript", "/* first\nconst value = 42;\n*/\n"], ["python", "\"\"\"first\r\nreturn '🧭'\r\nlast\"\"\"\r\n"]]) {
    const raw = tokenize(source, language);
    assert.ok(raw[0][0].end > source.indexOf("\n"), "Exercise actual cross-line regex ranges");
    const result = await readOnlySyntax(source, language, palette);
    assert.equal(result.runs[0][1], source.indexOf("\n"));
    let end = 0;
    for (const [start, length] of result.runs) {
      assert.ok(start >= end && length > 0);
      assert.equal(source.slice(start, start + length).includes("\n"), false);
      end = start + length;
    }
    assert.equal(result.source, source);
  }
});

test("code requests return explicit read-only replies through the actual action registry without changing policy or source", async () => {
  const registry = createPresentationActionRegistry(), handlers = new Map();
  const palette = readOnlySyntaxPalette(settings("stone"), false);
  const nodes = attachReadOnlySyntax([{ id: "answer", kind: "Markdown", text: "```json\n42\n```", value: JSON.stringify({ collapseLines: 12 }),
    children: [{ id: "args", kind: "CodeBlock", language: "json", text: "{\"value\":42}" }] }], handlers, palette);
  registry.register("chat", handlers);
  const input = { source: "{\"value\":42}\n", language: "json" };
  const event = { surface: "chat", requestId: "one", action: nodes[0].action, value: JSON.stringify(input) };
  const reply = await registry.dispatch(event), repeated = await registry.dispatch(event);
  assert.equal(reply.ok, true); assert.deepEqual(repeated, reply);
  const syntax = JSON.parse(reply.acceptedValue);
  assert.equal(syntax.source, input.source); assert.ok(syntax.runs.length > 0);
  assert.equal(nodes[0].text, "```json\n42\n```");
  assert.equal(JSON.parse(nodes[0].value).collapseLines, 12);
  assert.deepEqual(JSON.parse(nodes[0].value).syntaxBackground, palette.styles[palette.types.indexOf("background")]);
  for (const value of [null, "invalid", JSON.stringify({ source: 42, language: "json" }), JSON.stringify({ source: "ok", language: "" })]) {
    assert.equal((await registry.dispatch({ ...event, requestId: `invalid-${String(value)}`, value })).ok, false);
  }
  registry.remove("chat");
  assert.equal((await registry.dispatch({ ...event, requestId: "removed" })).ok, false);
});

test("ordinary action outputs stay ignored and invalid explicit replies are rejected", async () => {
  const registry = createPresentationActionRegistry();
  registry.register("test", new Map([
    ["ordinary", { enabled: true, accepts: () => true, run: () => ({ backendOutput: 42 }) }],
    ["invalid", { enabled: true, accepts: () => true, run: () => ({}), resultValue: value => value }],
    ["undefined", { enabled: true, accepts: () => true, run: () => undefined, resultValue: value => value }],
    ["normalized", { enabled: true, accepts: value => typeof value === "string", normalize: value => value.trim(), run: () => "ignored" }],
  ]));
  assert.equal((await registry.dispatch({ surface: "test", requestId: "one", action: "ordinary", value: null })).acceptedValue, undefined);
  assert.equal((await registry.dispatch({ surface: "test", requestId: "two", action: "invalid", value: null })).ok, false);
  assert.equal((await registry.dispatch({ surface: "test", requestId: "empty", action: "undefined", value: null })).ok, false);
  assert.equal((await registry.dispatch({ surface: "test", requestId: "three", action: "normalized", value: " spaced " })).acceptedValue, "spaced");
});

test("streamed read-only replies cannot evict ordinary action replay protection and are cleared on surface removal", async () => {
  const registry = createPresentationActionRegistry();
  let writes = 0;
  registry.register("chat", new Map([
    ["save", { enabled: true, accepts: () => true, run: () => ++writes }],
    ["highlight", { enabled: true, accepts: value => typeof value === "string", run: value => value, resultValue: value => value }],
  ]));
  const save = { surface: "chat", requestId: "save-once", action: "save", value: null };
  await registry.dispatch(save);
  for (let index = 0; index < 300; index++) {
    assert.equal((await registry.dispatch({ surface: "chat", requestId: `highlight-${index}`, action: "highlight", value: "code" })).ok, true);
  }
  await registry.dispatch(save);
  assert.equal(writes, 1, "Highlight traffic must not allow a replayed write to execute twice");
  registry.remove("chat");
  assert.equal((await registry.dispatch({ surface: "chat", requestId: "highlight-299", action: "highlight", value: "code" })).ok, false);
});
