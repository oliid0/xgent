import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { reconcileTabOrder, resolveActiveTab, tabForKey } = createTsModuleLoader().loadModule("src/pages/chat/right-sidebar/tabState.ts");

test("mixed tabs keep creation order when browser metadata changes", () => {
  const before = ["browser:main", "terminal:1", "preview:1"];
  assert.deepEqual(reconcileTabOrder(before, ["browser:new", "browser:main", "terminal:1", "preview:1"]), [...before, "browser:new"]);
  assert.deepEqual(reconcileTabOrder(before, ["browser:main", "preview:1"]), ["browser:main", "preview:1"]);
});

test("closing selects the neighboring tab without changing an unrelated active tab", () => {
  const before = ["browser:main", "terminal:1", "preview:1"];
  assert.equal(resolveActiveTab("terminal:1", before, ["browser:main", "preview:1"]), "preview:1");
  assert.equal(resolveActiveTab("preview:1", before, ["browser:main", "terminal:1"]), "terminal:1");
  assert.equal(resolveActiveTab("browser:main", before, ["browser:main", "preview:1"]), "browser:main");
  assert.equal(resolveActiveTab("browser:main", before, []), null);
});

test("tab keyboard navigation wraps and respects RTL", () => {
  assert.equal(tabForKey(["a", "b", "c"], "c", "ArrowRight"), "a");
  assert.equal(tabForKey(["a", "b", "c"], "a", "ArrowRight", true), "c");
  assert.equal(tabForKey(["a", "b", "c"], "b", "Home"), "a");
  assert.equal(tabForKey(["a", "b", "c"], "a", "End"), "c");
});


test("side and bottom plus buttons create the correct session and respect mode/availability", () => {
  const buttons = [];
  const require = createRequire(import.meta.url);
  const box = props => createElement("div", { id: props.id, role: props.role, "aria-label": props["aria-label"], children: props.children });
  const { RightSidebar } = createTsModuleLoader({ mocks: {
    react: require("react"),
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@astryxdesign/core/EmptyState": { EmptyState: () => null },
    "@astryxdesign/core/Icon": { Icon: () => null },
    "@astryxdesign/core/IconButton": { IconButton: props => { buttons.push(props); return null; } },
    "@astryxdesign/core/Layout": { HStack: box, VStack: box, StackItem: box },
    "../../../components/icons": Object.fromEntries(["FileText", "GitBranch", "Globe", "Maximize2", "MessageSquare", "Minimize2", "PanelRightClose", "Plus", "Terminal", "X"].map(name => [name, () => null])),
    "../../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../../lib/browser/browserSessionController": { browserSessionController: { setSurfaceOccluded() {} } },
  } }).loadModule("src/pages/chat/right-sidebar/RightSidebar.tsx");
  const calls = [], props = { presentation: "side", width: 400, onSelectTab() {}, onNewBrowser: () => calls.push("browser"), onNewTerminal: () => calls.push("terminal"), onNewSideChat: () => calls.push("chat"), onOpenReview: () => calls.push("review"), onOpenFiles: () => calls.push("files"), onCloseTab() {}, onPresentationChange() {}, onClose() {} };
  const markup = renderToStaticMarkup(createElement("main", null,
    createElement(RightSidebar, { ...props, tabs: [{ id: "browser:1", label: "Browser" }], activeTabId: "browser:1" }),
    createElement(RightSidebar, { ...props, tabs: [{ id: "terminal:1", label: "Terminal" }], activeTabId: "terminal:1", terminalIsDocked: true }),
  ));
  const controls = [...markup.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  assert.equal(controls.length, 2); assert.equal(new Set(controls).size, 2);
  for (const id of controls) assert.ok(markup.includes(`id="${id}" role="tabpanel"`));
  buttons.find(button => button.label === "browser.newTab").onClick();
  buttons.find(button => button.label === "projectTools.newTerminal").onClick();
  assert.deepEqual(calls, ["browser", "terminal"]);
  buttons.length = 0;
  renderToStaticMarkup(createElement(RightSidebar, { ...props, tabs: [], activeTabId: null, agentToolsEnabled: false }));
  buttons.find(button => button.label === "browser.newTab").onClick();
  assert.deepEqual(calls, ["browser", "terminal", "browser"]);
  for (const disabled of [{ agentToolsEnabled: false }, { terminalDisabled: true }]) {
    buttons.length = 0;
    renderToStaticMarkup(createElement(RightSidebar, { ...props, ...disabled, tabs: [], activeTabId: null, terminalIsDocked: true }));
    const add = buttons.find(button => button.label === "projectTools.newTerminal");
    assert.equal(add.isDisabled, true); add.onClick();
  }
  buttons.length = 0;
  renderToStaticMarkup(createElement(RightSidebar, { ...props, tabs: [], activeTabId: null, browserDisabled: true }));
  const add = buttons.find(button => button.label === "browser.newTab");
  assert.equal(add.isDisabled, true); add.onClick();
  assert.deepEqual(calls, ["browser", "terminal", "browser"]);
});
