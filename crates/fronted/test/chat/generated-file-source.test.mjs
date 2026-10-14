import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("generated file cards retain per-device links, original open-with ports and unknown-source disabled state", async () => {
  const hooks = createReactHookHarness(), opened = [], calls = [];
  const phone = "11111111-1111-4111-8111-111111111111", a = "22222222-2222-4222-8222-222222222222", b = "33333333-3333-4333-8333-333333333333";
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "@astryxdesign/core/Button": { Button: "Button" },
    "../workspace-editor/OpenWithMenu": { OpenWithMenu: "OpenWithMenu" },
    "./fileTypeIcons": { getFileTypeIcon: () => "FileIcon" },
    "@xgent/runtime": { invoke: () => assert.fail("Current route used for source card") },
    "@tauri-apps/api/core": { async invoke(command, args) { calls.push([command, args]); return command === "automation_device_identity" ? { hostId: phone } : []; } },
  } });
  const { GeneratedFilePreviewCard } = loader.loadModule("src/components/chat/GeneratedFilePreviewCard.tsx");
  const previewedFiles = [{ path: "report.md", toolCallId: "a", fileSource: { version: 1, hostId: a, workdir: "/same-project" } },
    { path: "report.md", toolCallId: "b", fileSource: { version: 1, hostId: b, workdir: "/same-project" } },
    { path: "old.pdf", toolCallId: "legacy" }];
  try {
    const tree = hooks.render(() => GeneratedFilePreviewCard({ paths: [], previewedFiles, onOpenFileLink: link => opened.push(link) }));
    const cards = tree.props.children[0]; assert.equal(cards.length, 3); assert.notEqual(cards[0].key, cards[1].key);
    for (const card of cards) card.props.children[1].props.onClick();
    assert.deepEqual(opened.map(link => link.fileSource?.hostId ?? null), [a, b, null]);
    for (const card of cards.slice(0, 2)) {
      const menu = card.props.children[2].props.children;
      assert.equal(menu.props.enabled, true); assert.equal(menu.props.workdir, "/same-project");
      await menu.props.commandPort.invoke("fs_file_applications", { workdir: menu.props.workdir, path: "report.md" });
    }
    assert.deepEqual(calls.filter(([command]) => command === "worker_peer_file_invoke").map(([, args]) => args.peer_id), [a, b]);
    assert.equal(cards[2].props.children[2].props.children.props.enabled, false);
    cards[0].props.children[2].props.children.props.onError("Original peer offline");
    const withError = hooks.render(() => GeneratedFilePreviewCard({ paths: [], previewedFiles, onOpenFileLink: link => opened.push(link) }));
    assert.equal(withError.props.children[1].props.role, "alert");
    const anotherSource = hooks.render(() => GeneratedFilePreviewCard({ paths: [], previewedFiles: [previewedFiles[1]], onOpenFileLink: link => opened.push(link) }));
    assert.equal(anotherSource.props.children[1], null, "A retired device error must not leak into another source's card");
  } finally { hooks.unmount(); }
});
