import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const source = { version: 1, hostId: "11111111-1111-4111-8111-111111111111", workdir: "/original-host/project" };
const receipt = { kind: "cloud_task_manager", action: "extract_artifact", taskId: "task-actual", artifactId: 42, artifactName: "xgent-task-actual", localPath: "/original-host/project/archive.zip", sizeBytes: 100, runConclusion: "failure", fileSource: source,
  files: [{ path: "import/product.html", bytes: 10, contentHash: "a".repeat(64) }, { path: "import/plan.docx", bytes: 20, contentHash: "b".repeat(64) }, { path: "import/.xgent-agent/result.json", bytes: 30, contentHash: "c".repeat(64) }] };
const round = (details = receipt, isError = false) => ({ blocks: [{ kind: "tool", item: { toolCall: { name: "CloudTaskManager", id: "extract-call", arguments: { action: "extract_artifact" } }, toolResult: { isError, details, content: [], timestamp: 1 } } }] });

test("actual extracted files are discoverable with original source; internal/failed/malformed entries cannot become result cards", () => {
  const { collectCloudExtractedFiles, collectCloudArtifacts } = createTsModuleLoader().loadModule("src/lib/chat/messages/cloudArtifacts.ts");
  const files = collectCloudExtractedFiles([round()]);
  assert.deepEqual(files.map(f => f.path), ["import/product.html", "import/plan.docx"]);
  assert.ok(files.every(f => f.fileSource.hostId === source.hostId));
  assert.equal(collectCloudArtifacts([round()])[0].runConclusion, "failure");
  assert.equal(collectCloudExtractedFiles([round(receipt, true)]).length, 0);
  assert.equal(collectCloudExtractedFiles([round({ ...receipt, fileSource: null })]).length, 0);
  assert.equal(collectCloudArtifacts([round({ ...receipt, fileSource: null })]).length, 0);
  for (const path of ["../escape", "/absolute", "bad\\path", "bad:stream", "a\0b"]) assert.equal(collectCloudExtractedFiles([round({ ...receipt, files: [{ ...receipt.files[0], path }] })]).length, 0);
  assert.equal(collectCloudExtractedFiles([round({ ...receipt, files: [{ ...receipt.files[0], contentHash: "invented" }] })]).length, 0);
});

test("native imported file actions are unique for one call with multiple files and preserve source ownership", async () => {
  const loader = createTsModuleLoader(), { createNativeChatTranscript } = loader.loadModule("src/presentation/nativeChatTranscript.ts");
  const actions = new Map(), opened = [];
  const nodes = createNativeChatTranscript([{ kind: "assistant", key: "result", rounds: [round()], timestamp: 1 }], { isSettled: true, liveRounds: [] }, false, k => k, (id, run) => { assert.equal(actions.has(id), false, `Duplicate action ${id}`); actions.set(id, run); return id; }, () => assert.fail("Global workspace used"), undefined, file => opened.push(file));
  const children = nodes[0].children;
  const files = children.filter(n => n.id?.includes(":previewed-file:")); assert.equal(files.length, 2); assert.notEqual(files[0].id, files[1].id);
  for (const file of files) await actions.get(file.action)();
  assert.deepEqual(opened.map(f => f.path), ["import/product.html", "import/plan.docx"]); assert.ok(opened.every(f => f.fileSource.hostId === source.hostId));
  assert.match(children.find(n => n.id.includes(":cloud-artifact:")).label, /chat.cloudArtifacts.partial/);
});

test("HTML archive link reports partial state and opens through its original file source", async () => {
  const hooks = createReactHookHarness(), opened = [];
  const loader = createTsModuleLoader({ mocks: { react: { ...hooks.react, Fragment: "Fragment", memo: x => x }, "@astryxdesign/core/Link": { Link: "Link" }, "@astryxdesign/core/Text": { Text: "Text" }, "../../i18n": { useLocale: () => ({ t: k => k }) }, "@xgent/runtime": { invoke: () => assert.fail("Unowned global cloud opener used") } } });
  const { CloudArtifactsCard } = loader.loadModule("src/components/chat/CloudArtifactsCard.tsx");
  try {
    const tree = hooks.render(() => CloudArtifactsCard({ artifacts: [{ ...receipt, toolCallId: "extract-call" }], onOpenFileLink: link => opened.push(link) }));
    const flatten = x => !x ? [] : Array.isArray(x) ? x.flatMap(flatten) : [x, ...flatten(x.props?.children)];
    const nodes = flatten(tree); assert.ok(nodes.some(n => n.props?.children?.includes?.("chat.cloudArtifacts.partial")));
    nodes.find(n => n.type === "Link").props.onClick({ preventDefault() {} });
    assert.deepEqual(opened, [{ path: receipt.localPath, source: "absolute", fileSource: source }]);
  } finally { hooks.unmount(); }
});

test("HTML imported files from one tool call have distinct card keys and actionable original-source links", () => {
  const hooks = createReactHookHarness(), opened = [];
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../workspace-editor/OpenWithMenu": { OpenWithMenu: "OpenWithMenu" },
    "./fileTypeIcons": { getFileTypeIcon: () => "FileIcon" },
  } });
  const { GeneratedFilePreviewCard } = loader.loadModule("src/components/chat/GeneratedFilePreviewCard.tsx");
  const { collectCloudExtractedFiles } = loader.loadModule("src/lib/chat/messages/cloudArtifacts.ts");
  try {
    const tree = hooks.render(() => GeneratedFilePreviewCard({ paths: [], previewedFiles: collectCloudExtractedFiles([round()]), onOpenFileLink: link => opened.push(link) }));
    const cards = tree.props.children[0]; assert.equal(cards.length, 2); assert.notEqual(cards[0].key, cards[1].key);
    for (const card of cards) card.props.children.find(node => node?.type === "button").props.onClick();
    assert.deepEqual(opened.map(link => link.path), ["import/product.html", "import/plan.docx"]);
    assert.ok(opened.every(link => link.fileSource.hostId === source.hostId));
  } finally { hooks.unmount(); }
});
