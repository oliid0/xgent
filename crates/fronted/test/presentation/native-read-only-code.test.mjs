import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const policy = loader.loadModule("src/lib/readOnlyCode.ts");
const { nativeReadOnlyCodeNodes } = loader.loadModule("src/presentation/nativeReadOnlyCode.ts");
const { createNativeChatTranscript } = loader.loadModule("src/presentation/nativeChatTranscript.ts");
const { t } = loader.loadModule("src/i18n/config.ts");
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

test("the installed shared code block becomes a disclosure at exactly twelve visual lines", () => {
  assert.equal(policy.CHAT_CODE_MAX_HEIGHT_CSS, "min(60dvh, 36rem)");
  for (const count of [11, 12, 13]) {
    const code = Array.from({ length: count }, (_, index) => `line ${index}`).join("\n") + "\n";
    const html = renderToStaticMarkup(createElement(CodeBlock, {
      code, language: "swift", isCollapsible: true, collapsibleThreshold: policy.CHAT_CODE_COLLAPSE_LINES,
      maxHeight: policy.CHAT_CODE_MAX_HEIGHT_CSS,
    }));
    assert.equal(/aria-expanded="true"/.test(html), count >= 12);
    assert.match(html, /max-height:min\(60dvh, 36rem\)/);
    assert.match(html, /line 0/);
    assert.match(html, new RegExp(`line ${count - 1}`));
  }
});

test("the actual shared Markdown parser exposes the full fenced source and first language token", () => {
  for (const [body, expected] of [["", ""], ["let emoji = '🧭';", "let emoji = '🧭';\n"], ["line\n\n", "line\n\n\n"]]) {
    const captured = [];
    renderToStaticMarkup(createElement(Streamdown, {
      mode: "static", plugins: {},
      components: { pre: ({ children }) => {
        assert.ok(isValidElement(children));
        const raw = children.props.children;
        captured.push({ text: typeof raw === "string" ? raw : "", language: children.props.className });
        return children;
      } },
      children: `\`\`\`swift title=Example.swift\n${body}${body ? "\n" : ""}\`\`\``,
    }));
    assert.deepEqual(captured, [{ text: expected, language: "language-swift" }]);
  }
});

test("native read-only policies keep full source and existing actions while matching shared tool height limits", () => {
  const code = "\t  🧭\r\n".repeat(500);
  const original = [{ id: "work", kind: "ToolCall", children: [
    { id: "tool:arguments", kind: "CodeBlock", language: "json", text: code },
    { id: "tool:result", kind: "CodeBlock", language: "text", text: code },
    { id: "tool:diff", kind: "CodeBlock", language: "diff", text: code },
    { id: "open", kind: "Button", action: "open-file", label: "report.md" },
  ] }];
  const nodes = nativeReadOnlyCodeNodes(original, key => t(key, "zh-CN"));
  const css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8");
  for (const [index, cssName] of [[0, "input"], [1, "output"], [2, "preview"]]) {
    const config = JSON.parse(nodes[0].children[index].value);
    const rem = Number(css.match(new RegExp(`--xgent-tool-${cssName}-max-height:\\s*([0-9]+)rem`))[1]);
    assert.equal(config.maxHeight, rem * 16);
    assert.equal(config.hasLanguageLabel, false);
    assert.equal(config.container, index === 2 ? "card" : "section");
    assert.equal(config.labels.copy, "复制代码");
    assert.equal(nodes[0].children[index].text, code);
    assert.equal(original[0].children[index].value, undefined, "No mutation of authoritative evidence");
  }
  assert.equal(nodes[0].children[3], original[0].children[3]);
});

test("history, live, user and system Markdown share localized policies through the actual transcript controller", () => {
  const fence = "```json\n{\"value\": 42}\n```";
  const history = [
    { kind: "user", key: "user", timestamp: 1, text: fence, attachments: [] },
    { kind: "summary", key: "summary", content: fence },
    { kind: "assistant", key: "answer", timestamp: 3, rounds: [{ key: "round", round: 1,
      blocks: [{ kind: "text", id: "text", text: fence }] }] },
  ];
  for (const locale of ["zh-CN", "en-US"]) {
    const nodes = createNativeChatTranscript(history, { isSettled: false, liveRounds: [], draftAssistantText: fence },
      true, key => t(key, locale), id => id, () => {});
    const markdown = flatten(nodes).filter(node => node.kind === "Markdown");
    assert.equal(markdown.length, 4);
    for (const node of markdown) {
      const config = JSON.parse(node.value);
      assert.equal(node.text, fence);
      assert.equal(config.maxHeight, 576);
      assert.equal(config.viewportFraction, 0.6);
      assert.equal(config.collapseLines, 12);
      assert.equal(config.labels.copy, t("chat.markdown.copyCode", locale));
      assert.equal(config.labels.expand, t("chat.markdown.expandCode", locale));
    }
  }
});
