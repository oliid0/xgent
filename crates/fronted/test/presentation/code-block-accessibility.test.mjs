import assert from "node:assert/strict";
import test from "node:test";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("terminal output labels reach the focusable code body and preserve copy access", () => {
  const markup = renderToStaticMarkup(createElement(CodeBlock, {
    code: "xgent-shell-ok", title: "stdout", "aria-label": "stdout: xgent-shell-ok",
  }));
  assert.match(markup, /<div[^>]*tabindex="0"[^>]*role="group"[^>]*aria-label="stdout: xgent-shell-ok"/);
  assert.doesNotMatch(markup, /<pre[^>]*aria-label=/);
  assert.match(markup, /<button[^>]*aria-label="Copy code"/);
});
