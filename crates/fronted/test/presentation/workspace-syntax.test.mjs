import assert from "node:assert/strict";
import test from "node:test";
import { TokenizationRegistry } from "monaco-editor/editor/common/languages.js";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { WorkspaceSyntaxController } = loader.loadModule("src/components/workspace-editor/workspaceSyntax.ts");
const { workspaceCodeLanguage } = loader.loadModule("src/components/workspace-editor/workspaceCodeLanguage.ts");
const { workspaceSyntaxProvider, workspaceSyntaxLineLimit } = loader.loadModule("src/components/workspace-editor/workspaceSyntaxProviders.ts");
const appearance = (snapshot, offset, mode = "light") => {
  const run = snapshot.runs.find(([start, length]) => offset >= start && offset < start + length);
  assert.ok(run, `No token at UTF-16 ${offset}`);
  return snapshot.styles[run[2]][mode];
};

test("workspace language IDs cover the actual shared path rules on Windows and Apple paths", () => {
  for (const [path, expected] of [
    ["C:\\work\\Dockerfile", "dockerfile"], ["C:\\work\\a.ts\\", "typescript"], ["/project/Makefile", "makefile"], ["Cargo.lock", "toml"],
    ["Types.D.TS", "typescript"], ["a.tsx", "typescript"], ["a.mjs", "javascript"], ["a.jsonc", "json"],
    ["a.sass", "scss"], ["a.mdx", "markdown"], ["a.rs", "rust"], ["a.kts", "kotlin"], ["a.h", "c"],
    ["a.hpp", "cpp"], ["a.rb", "ruby"], ["a.zsh", "shell"], ["a.yml", "yaml"], ["a.svg", "xml"],
    ["a.gql", "graphql"], ["a.foo", "plaintext"], ["README", "plaintext"],
  ]) assert.equal(workspaceCodeLanguage(path), expected, path);
});

test("actual Monaco lexical states preserve multiline comments, templates and original UTF-16 CRLF offsets", () => {
  const source = 'const count = 42;\r\n/* 😀 comment\r\nstill */ const message = `hello ${count}`;';
  const controller = new WorkspaceSyntaxController(), snapshot = controller.refresh(source, "javascript");
  assert.equal(snapshot.source, source);
  assert.equal(appearance(snapshot, source.indexOf("const")).color, "#0000ff");
  assert.equal(appearance(snapshot, source.indexOf("42")).color, "#098658");
  assert.equal(appearance(snapshot, source.indexOf("still")).color, "#008000");
  assert.equal(appearance(snapshot, source.indexOf("hello")).color, "#a31515");
  assert.notEqual(appearance(snapshot, source.indexOf("${count}") + 2).color, "#a31515");
  const offsets = snapshot.runs.map(([start, length]) => [start, start + length]);
  for (const [start, end] of offsets) {
    assert.ok(start >= 0 && end <= source.length);
    assert.equal(/[\uD800-\uDBFF]/.test(source[start - 1] ?? "") && /[\uDC00-\uDFFF]/.test(source[start] ?? ""), false);
    assert.equal(/[\uD800-\uDBFF]/.test(source[end - 1] ?? "") && /[\uDC00-\uDFFF]/.test(source[end] ?? ""), false);
  }
  const repeated = controller.refresh(source, "javascript");
  assert.equal(repeated, snapshot);
  assert.notEqual(appearance(snapshot, source.indexOf("const"), "dark").color, appearance(snapshot, source.indexOf("const")).color);
});

test("shared JSON scanner differentiates property/value strings and multiline comments", () => {
  const source = '{"key": "value", "n": 42, /* first\r\ncomment */ "valid": true}';
  const value = new WorkspaceSyntaxController().refresh(source, "json");
  assert.equal(appearance(value, source.indexOf("key")).color, "#a31515");
  assert.equal(appearance(value, source.indexOf("value")).color, "#0451a5");
  assert.equal(appearance(value, source.indexOf("42")).color, "#098658");
  assert.equal(appearance(value, source.indexOf("comment")).color, "#008000");
  assert.equal(appearance(value, source.indexOf("true")).color, "#0451a5");
});

test("embedded HTML and fenced Markdown use the installed nested-language providers without replacing Monaco registrations", () => {
  const shared = { getInitialState() {}, tokenize() {} };
  const registration = TokenizationRegistry.register("javascript", shared);
  try {
    const html = '<style>.a { color: red; }</style>\n<script>const a = "hello";</script>';
    const value = new WorkspaceSyntaxController().refresh(html, "html");
    assert.equal(appearance(value, html.indexOf("const")).color, "#0000ff");
    assert.equal(appearance(value, html.indexOf("hello")).color, "#a31515");
    const markdown = '## Heading\n```typescript\nconst answer: number = 42;\n```\n*emphasis*';
    const fenced = new WorkspaceSyntaxController().refresh(markdown, "markdown");
    assert.equal(appearance(fenced, markdown.indexOf("const")).color, "#0000ff");
    assert.equal(appearance(fenced, markdown.indexOf("42")).color, "#098658");
    assert.equal(appearance(fenced, markdown.indexOf("emphasis")).fontStyle & 1, 1);
    const cpp = '```c++\nint value = 42;\n```';
    const alias = new WorkspaceSyntaxController().refresh(cpp, "markdown");
    assert.equal(appearance(alias, cpp.indexOf("int")).color, "#0000ff");
    assert.equal(TokenizationRegistry.get("javascript"), shared);
  } finally { registration.dispose(); }
});

test("incremental lexical caching converges after state-changing edits and file switches never share stale state", () => {
  const before = "const a = 1;\n/* open\ninside\n*/\nconst end = 2;\nconst stable = 3;", controller = new WorkspaceSyntaxController();
  controller.refresh(before, "typescript");
  const changed = before.replace("/* open", "// closed");
  const incremental = controller.refresh(changed, "typescript");
  const full = new WorkspaceSyntaxController().refresh(changed, "typescript");
  assert.deepEqual(incremental.runs, full.runs); assert.deepEqual(incremental.styles, full.styles);
  assert.ok(controller.tokenizedLines < changed.split("\n").length);
  const inserted = "// added\r\n" + changed;
  const shifted = controller.refresh(inserted, "typescript"), fresh = new WorkspaceSyntaxController().refresh(inserted, "typescript");
  assert.deepEqual(shifted.runs, fresh.runs); assert.deepEqual(shifted.styles, fresh.styles);
  const other = new WorkspaceSyntaxController().refresh("return 'value'", "python");
  assert.equal(appearance(other, 8).color, "#a31515");
  const languageChanged = controller.refresh(inserted, "html"), freshHTML = new WorkspaceSyntaxController().refresh(inserted, "html");
  assert.deepEqual(languageChanged.runs, freshHTML.runs); assert.deepEqual(languageChanged.styles, freshHTML.styles);
});

test("every shared registered grammar initializes and the editor line limit never drops file content", () => {
  for (const language of ["c", "cpp", "csharp", "css", "dockerfile", "go", "graphql", "html", "java", "javascript", "json", "kotlin", "less", "markdown", "php", "python", "ruby", "rust", "scss", "shell", "sql", "swift", "typescript", "xml", "yaml"])
    assert.ok(workspaceSyntaxProvider(language), language);
  assert.equal(workspaceSyntaxProvider("toml"), null);
  const source = "//" + "x".repeat(workspaceSyntaxLineLimit) + "\nconst value = 42;";
  const value = new WorkspaceSyntaxController().refresh(source, "javascript");
  assert.equal(value.source, source);
  assert.equal(appearance(value, 2).color, "#000000");
  assert.equal(appearance(value, source.indexOf("const")).color, "#0000ff");
});
