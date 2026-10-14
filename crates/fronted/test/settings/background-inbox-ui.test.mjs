import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const item = { id: "entry", sequence: 1, sourceHostId: "original", requestId: "request", name: "Actual task", state: "waiting", success: false, preview: "Actual report saved", artifactCount: 1, receivedAt: 1, readAt: null };
const result = { hostId: "original", requestId: "request", run: { state: "waiting", output: "Full retained implementation report" }, waiting: { waitId: "actual-wait" }, artifacts: [{ id: "file", relativePath: "产品.html", bytes: 27 }], outcomes: { branches: [{ branch: { id: "calendar", title: "Calendar" }, state: "waiting", reason: "Actual connector is unavailable" }] } };
function setup(options = {}) {
  const hooks = createReactHookHarness(), calls = []; let read = false, listCount = 0;
  let savedResponse = options.savedResponse ?? null;
  const submission = { sequence: 1, requestId: "saved-root", sourceHostId: "original", name: "Saved actual request", createdAt: 100, retryAt: 60100, probes: 1, lastError: null, accepted: false, localOwner: true, cancelRequested: false, cancellationConfirmed: false, ...options.submission };
  const backend = {
    async inspectMobileBranches(entryId) { calls.push(["phone_review",entryId]); if(options.phoneReviewFails)throw new Error("Actual local read failed"); return options.phoneReview ?? {requestId:item.requestId,sourceHostId:item.sourceHostId,deviceHostId:"original-phone",cancelRequested:false,branches:[]}; },
    async retryMobileBranchPlanning(entryId,branchId,recovery) { calls.push(["phone_retry",entryId,branchId,recovery]); if(options.phoneRetryFails)throw new Error("Original controller unavailable"); if(options.phoneReview){ options.phoneReview.branches[0].canRetryPlanning=false;options.phoneReview.branches[0].attempts=0;options.phoneReview.branches[0].recovery++; } },
    async decideMobileBranchAuthorization(entryId,branchId,hash,revision,approve) { calls.push(["phone_decide",entryId,branchId,hash,revision,approve]); if(options.phoneDecisionFails)throw new Error("Original controller unavailable"); const branch=options.phoneReview.branches[0]; branch.authorization={...branch.authorization,revision:revision+1,decision:approve?"approved":"revoked",allowed:approve,canApprove:!approve,canRevoke:approve}; },
    async listBackgroundSubmissions(cursor, limit) { calls.push(["submissions", cursor, limit]); return { items: options.emptySubmissions ? [] : [submission], nextCursor: null }; },
    async getBackgroundTask(requestId, peerId) { calls.push(["submission_current", requestId, peerId]); if (options.submissionOffline) throw new Error("Original worker offline"); return options.submissionReply ?? { ...result, requestId, run: { state: "pending", success: false } }; },
    async cancelBackgroundTask(requestId, peerId) { calls.push(["submission_cancel", requestId, peerId]); submission.cancelRequested = true; if (options.submissionOffline) throw new Error("Cancellation awaits original host"); submission.cancellationConfirmed = true; return { ...result, requestId, run: { state: "expired", success: false } }; },
    async listBackgroundInbox(cursor, limit, unread) { calls.push(["list", cursor, limit, unread]); listCount++; if (options.firstRead && listCount === 1) return options.firstRead; return { items: unread && read ? [] : [{ ...item, readAt: read ? 100 : null }], nextCursor: null }; },
    async syncBackgroundInbox() { calls.push(["sync"]); if (options.syncFails) throw new Error("Native synchronization unavailable"); return { inspected: 1, received: 0, unresolved: 1 }; },
    async acknowledgeBackgroundInbox(id) { calls.push(["ack", id]); if (options.ackFails) throw new Error("ACK could not be persisted"); read = true; },
    async getReceivedResponseState(id) { calls.push(["response_state", id]); return savedResponse; },
    async getReceivedBackgroundTask(id) { calls.push(["current", id]); if (options.currentFails) throw new Error("Original host unavailable"); return options.currentReply ?? { ...result, run: { state: "pending", success: false } }; },
    async resumeReceivedBackgroundTask(id, response) { calls.push(["resume", id, response]); if (options.stageFails) throw new Error("Native response capacity reached"); savedResponse ??= { sourceHostId: "original", input: { requestId: "request", waitId: "actual-wait", resumeId: "persisted-native-id", response }, result: null }; if (options.resumeFails) throw new Error("Resume acceptance unconfirmed"); const actual = { ...result, run: { state: "pending", success: false } }; savedResponse.result = actual; return actual; },
  };
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react, "react-dom": { flushSync: (fn) => fn() },
    "@xgent/runtime": { isBrowserRuntime: () => options.browser === true, getLanPcCommandHostConfig: () => ({ enabled: true, localWorkdir: "/actual-phone" }) },
    "../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../lib/automation/backend": { backend }, "../../lib/automation/backgroundInboxSnapshot": { readInboxSnapshot: async (entry) => { calls.push(["read", entry.id]); return options.snapshotReply ?? result; } },
    "../../lib/automation/mobileBranchEvents": { notifyMobileBranchRecovery:entryId=>calls.push(["phone_wake",entryId]), notifyMobileBranchRevocation:entryId=>calls.push(["phone_revoke",entryId]) },
    "../../lib/automation/backgroundInboxArtifacts": { saveInboxArtifact: async (entry, artifact, workdir, current) => { calls.push(["download", entry.id, artifact.id, workdir]); options.downloadCurrent?.(current); if (options.downloadFails) throw new Error("Original host offline"); return await options.downloadReply ?? { path: "background-results/actual-file" }; } },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => options.apple !== false },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" }, "../../presentation/NativeSettingsContent": { NativeSettingsContent: "NativeSettingsContent" },
    "@astryxdesign/core/Banner": { Banner: "Banner" }, "@astryxdesign/core/Button": { Button: "Button" }, "@astryxdesign/core/Layout": { HStack: "HStack", Section: "Section", VStack: "VStack" }, "@astryxdesign/core/Text": { Heading: "Heading", Text: "Text" },
    "@astryxdesign/core/TextInput": { TextInput: "TextInput" },
    "@astryxdesign/core/Icon": { Icon: "Icon" }, "@astryxdesign/core/IconButton": { IconButton: "IconButton" },
    "@astryxdesign/core/DropdownMenu": { DropdownMenu: "DropdownMenu" },
    "@astryxdesign/core/List": { List: "List", ListItem: "ListItem" },
    "../../components/icons": { Check: "Check", Circle: "Circle", MoreHorizontal: "MoreHorizontal", RefreshCw: "RefreshCw" },
  } });
  const { BackgroundInboxSection } = loader.loadModule("src/pages/settings/BackgroundInboxSection.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const props = { settings: { theme: "system" }, setSettings() {}, onBack() { calls.push(["back"]); } };
  const render = () => { const view = hooks.render(() => BackgroundInboxSection(props)); if (options.apple !== false) validatePresentationDocument({ ...view.props.document, version: 1, surface: "inbox", revision: 1 }, view.props.handlers); return view.props; };
  return { calls, hooks, render, async press(id, value = null) { const view = render(), handler = view.handlers.get(id); assert.ok(handler, id); assert.equal(handler.enabled, true); await handler.run(value); await flush(); } };
}
const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

test("leaving the original inbox view retires artifact writes, late receipts and old download actions", async () => {
  let resolve, current;
  const downloadReply = new Promise(done => { resolve = done; });
  const f = setup({ downloadReply, downloadCurrent: observed => { current = observed; } });
  f.render(); await flush(); await f.press("inbox:read:entry");
  const old = f.render(), handler = old.handlers.get("inbox:download:file");
  const saving = f.press("inbox:download:file"); await flush();
  assert.equal(current(), true); await f.press("inbox:back"); assert.equal(current(), false);
  resolve({ path: "background-results/late-file" }); await saving;
  await handler.run(null);
  assert.equal(f.calls.filter(([name]) => name === "download").length, 1);
  await f.press("inbox:read:entry");
  assert.ok(!flatten(f.render().document.nodes).some(node => node.id === "inbox:saved:file"));
  f.hooks.unmount(); assert.equal(current(), false);
});

const recoveryReply = { ...result, cloudRecovery: { callId: "cloud-call", taskId: "task-original", waitId: "actual-wait", retryAt: 2000000000000, probes: 2,
  launchError: "Original response lost", lastError: "Actual GET unavailable" } };

test("cloud recovery detail uses native observations and keeps stored evidence separate from a fresh host reply", async () => {
  const f = setup({ snapshotReply: recoveryReply, currentReply: { ...recoveryReply, cloudRecovery: { ...recoveryReply.cloudRecovery, probes: 3, lastError: "Run still unconfirmed" } } });
  f.render(); await flush(); await f.press("inbox:read:entry");
  let view = f.render(), nodes = flatten(view.document.nodes);
  assert.ok(nodes.some(node => node.id === "inbox:stored:cloudRecovery:task" && node.text.endsWith("task-original")));
  assert.ok(nodes.some(node => node.id === "inbox:stored:cloudRecovery:probes" && node.text.endsWith("2")));
  assert.ok(nodes.some(node => node.id === "inbox:stored:cloudRecovery:retry"));
  assert.ok(nodes.filter(node => node.id.includes(":cloudRecovery:") && node.kind === "Text").every(node => node.wrap));
  assert.equal(view.handlers.has("inbox:resume"), false); assert.equal(view.handlers.has("inbox:response"), false);
  await f.press("inbox:current"); view = f.render(); nodes = flatten(view.document.nodes);
  assert.ok(nodes.some(node => node.id === "inbox:current:cloudRecovery:probes" && node.text.endsWith("3")));
  assert.ok(nodes.some(node => node.id === "inbox:stored:cloudRecovery:probes" && node.text.endsWith("2")));
  assert.ok(nodes.some(node => node.id === "inbox:current:cloudRecovery:lastError" && node.text.endsWith("Run still unconfirmed")));
  assert.equal(f.calls.some(([call]) => call === "resume" || call === "submission_cancel"), false); f.hooks.unmount();
});

test("fresh native recovery hides a stale information form; terminal native replies remove active recovery claims", async () => {
  const f = setup({ currentReply: recoveryReply }); f.render(); await flush(); await f.press("inbox:read:entry");
  assert.equal(f.render().handlers.has("inbox:response"), true);
  await f.press("inbox:current"); assert.equal(f.render().handlers.has("inbox:response"), false); f.hooks.unmount();
  const terminal = setup({ snapshotReply: recoveryReply, currentReply: { ...recoveryReply, run: { state: "expired", success: false } } });
  terminal.render(); await flush(); await terminal.press("inbox:read:entry"); await terminal.press("inbox:current");
  const nodes = flatten(terminal.render().document.nodes);
  assert.ok(!nodes.some(node => node.id.startsWith("inbox:current:cloudRecovery:")));
  assert.ok(nodes.some(node => node.id.startsWith("inbox:stored:cloudRecovery:"))); terminal.hooks.unmount();
});

test("inbox distinguishes retained pending cloud cancellation from a fresh observed terminal reply", async () => {
  const f = setup({ snapshotReply: { ...result, run: { state: "expired", success: false, output: "Local execution ended" }, cloudCancellation: { pending: 2, observedTerminal: 1 } },
    currentReply: { ...result, run: { state: "expired", success: false }, cloudCancellation: { pending: 0, observedTerminal: 3 } } });
  f.render(); await flush(); await f.press("inbox:read:entry");
  let nodes = flatten(f.render().document.nodes);
  assert.equal(nodes.find(node => node.id === "inbox:stored:cloudCancel:pending").text, "backgroundInbox.cloudCancellationPending (2)");
  assert.equal(nodes.find(node => node.id === "inbox:stored:cloudCancel:ended").text, "backgroundInbox.cloudCancellationEnded (1)");
  assert.equal(nodes.find(node => node.id === "inbox:stored:cloudCancel:pending").wrap, true);
  await f.press("inbox:current"); nodes = flatten(f.render().document.nodes);
  assert.equal(nodes.find(node => node.id === "inbox:current:cloudCancel:ended").text, "backgroundInbox.cloudCancellationEnded (3)");
  assert.ok(!nodes.some(node => node.id === "inbox:current:cloudCancel:pending"));
  assert.ok(nodes.some(node => node.id === "inbox:stored:cloudCancel:pending"));
  assert.ok(!f.calls.some(call => call[0] === "resume" || call[0] === "submission_cancel"));
});

test("inbox approval and offline local revocation use the reviewed native version without claiming SDK success",async()=>{
  const phoneReview={requestId:"request",sourceHostId:"original",deviceHostId:"original-phone",cancelRequested:false,branches:[{
    source:{id:"calendar",requirement:"Arrange event",dependsOn:[],locality:"initiating-device"},plan:null,records:[],labels:[],attempts:1,recovery:0,lastError:null,canRetryPlanning:false,acknowledged:false,
    authorization:{planHash:"native-frozen-plan",revision:0,decision:"pending",required:true,allowed:false,canApprove:true,canRevoke:true,blockedReason:null},
  }]};
  const branch=phoneReview.branches[0];
  branch.plan={version:1,requestId:"request",sourceHostId:"original",source:branch.source,actions:[{sourceId:"actual-source",input:{deviceHostId:"original-phone",operationId:"a".repeat(64),kind:"reminder",request:{title:"Exercise",calendarId:"actual-list",dueMs:2000000000000,recurrence:"daily"}}}]};
  const f=setup({phoneReview});f.render();await flush();await f.press("inbox:read:entry");f.render();await flush();
  await f.press("inbox:phone:branch:calendar:approve");
  assert.deepEqual(f.calls.find(([call])=>call==="phone_decide"),["phone_decide","entry","calendar","native-frozen-plan",0,true]);
  assert.ok(flatten(f.render().document.nodes).some(node=>node.text==="mobileBranch.authorization.approved"));
  await f.press("inbox:phone:branch:calendar:revoke");
  assert.deepEqual(f.calls.filter(([call])=>call==="phone_revoke"),[["phone_revoke","entry"]]);
  assert.ok(flatten(f.render().document.nodes).some(node=>node.text==="mobileBranch.authorization.revoked"));
  assert.equal(f.calls.some(([call])=>call==="ack"),false);f.hooks.unmount();
});

test("phone task detail reads native exhausted planning and recovery acts on the original entry/generation",async()=>{
  const phoneReview={requestId:"request",sourceHostId:"original",deviceHostId:"original-phone",cancelRequested:false,branches:[{
    source:{id:"calendar",requirement:"Arrange the actual requested event",dependsOn:["report"],locality:"initiating-device"},
    plan:null,records:[],labels:[],attempts:3,recovery:2,lastError:"Actual planning failed",canRetryPlanning:true,acknowledged:false,
  }]};
  const f=setup({phoneReview});f.render();await flush();await f.press("inbox:read:entry");f.render();await flush();
  assert.ok(flatten(f.render().document.nodes).some(node=>node.id==="inbox:phone:branch:calendar:error"&&node.text==="Actual planning failed"));
  await f.press("inbox:phone:branch:calendar:retry");
  assert.deepEqual(f.calls.filter(([call])=>call==="phone_retry"),[["phone_retry","entry","calendar",2]]);
  assert.deepEqual(f.calls.filter(([call])=>call==="phone_wake"),[["phone_wake","entry"]]);
  assert.equal(f.render().handlers.has("inbox:phone:branch:calendar:retry"),false);f.hooks.unmount();
});

test("failed original-controller recovery is visible and never sends a scheduling wake",async()=>{
  const f=setup({phoneRetryFails:true,phoneReview:{requestId:"request",sourceHostId:"original",deviceHostId:"original-phone",cancelRequested:false,branches:[{
    source:{id:"calendar",requirement:"Original requirement",dependsOn:[],locality:"initiating-device"},plan:null,records:[],labels:[],attempts:3,recovery:0,lastError:"Model failed",canRetryPlanning:true,acknowledged:false,
  }]}});
  f.render();await flush();await f.press("inbox:read:entry");f.render();await flush();await f.press("inbox:phone:branch:calendar:retry");
  const nodes=flatten(f.render().document.nodes);
  assert.ok(nodes.some(node=>node.id==="inbox:phone:error"&&node.text.includes("unavailable")));
  assert.equal(f.calls.some(([call])=>call==="phone_wake"),false);
  assert.equal(f.render().handlers.get("inbox:phone:branch:calendar:retry").enabled,false);f.hooks.unmount();
});

test("submission UI recovers saved requests without automatic dispatch and keeps acceptance separate from actual execution", async () => {
  const f = setup(); f.render(); await flush(); await f.press("inbox:submissions");
  let nodes = flatten(f.render().document.nodes);
  assert.ok(nodes.some(n => n.text === "backgroundInbox.submissionPending"));
  assert.equal(f.calls.some(([name]) => ["sync", "submission_current", "submission_cancel"].includes(name)), false);
  await f.press("inbox:submission:current:saved-root");
  nodes = flatten(f.render().document.nodes);
  assert.ok(nodes.some(n => n.id === "inbox:submission:actualState" && n.text.includes("backgroundInbox.queued")));
  assert.ok(nodes.some(n => n.text === "backgroundInbox.submissionPending")); // native receipt not fabricated by a status read
  assert.deepEqual(f.calls.find(([name]) => name === "submission_current"), ["submission_current", "saved-root", "original"]);
  assert.equal(f.calls.some(([name]) => name === "ack"), false); f.hooks.unmount();
});

const mixedReply = {
  ...result,
  run: { state: "leased", success: false, output: "Current worker report" },
  artifacts: [...result.artifacts, { id: "new-file", relativePath: "最新实施方案.pdf", bytes: 150 }],
  outcomes: { verified: false, branches: [
    { branch: { id: "documents", title: "Documents", requirement: "Use the supplied documents" }, state: "verified", evidence: { answer: "Actual document answer" }, reason: null },
    { branch: { id: "calendar", title: "Calendar", requirement: "Arrange tomorrow" }, state: "waiting", evidence: { answer: "Retained calendar proposal" }, reason: "Calendar permission unavailable" },
    { branch: { id: "ppt", title: "Presentation", requirement: "Create the presentation file" }, state: "pending", evidence: null, reason: null },
  ] },
};

test("current task detail projects actual branch evidence and manifest while retaining the saved snapshot and download authority", async () => {
  const f = setup({ currentReply: mixedReply }); f.render(); await flush(); await f.press("inbox:read:entry");
  assert.equal(f.calls.some(([name]) => name === "current"), false);
  await f.press("inbox:current"); const view = f.render(), nodes = flatten(view.document.nodes);
  assert.ok(nodes.some(n => n.id === "inbox:current:verification" && n.text === "backgroundInbox.verifiedBranches: 1/3"));
  assert.ok(nodes.some(n => n.id === "inbox:current:branchState:documents" && n.text === "backgroundInbox.branchVerified"));
  assert.ok(nodes.some(n => n.id === "inbox:current:branchState:calendar" && n.text === "backgroundInbox.waiting"));
  assert.ok(nodes.some(n => n.id === "inbox:current:branchState:ppt" && n.text === "backgroundInbox.branchPending"));
  assert.ok(nodes.some(n => n.id === "inbox:current:proof:calendar" && n.text === "Retained calendar proposal\nCalendar permission unavailable"));
  assert.ok(nodes.some(n => n.id === "inbox:current:requirement:documents" && n.text === "Use the supplied documents"));
  assert.ok(nodes.some(n => n.id === "inbox:currentOutput" && n.text === "Current worker report"));
  assert.ok(nodes.some(n => n.id === "inbox:output" && n.text === "Full retained implementation report"));
  assert.ok(nodes.some(n => n.id === "inbox:proof:calendar" && n.text === "Actual connector is unavailable"));
  assert.ok(nodes.some(n => n.id === "inbox:current:artifact:new-file" && n.wrap && n.text === "最新实施方案.pdf (150 B)"));
  assert.ok(!nodes.some(n => n.id === "inbox:current:manifestHint"));
  assert.equal(view.handlers.has("inbox:download:new-file"), false);
  assert.equal(view.handlers.has("inbox:resume"), false);
  assert.equal(f.calls.some(([name]) => ["ack", "download", "sync"].includes(name)), false);
  f.hooks.unmount();
});

test("saved submission detail exposes the original host's actual outcomes without fabricating a receipt or downloaded file", async () => {
  const f = setup({ submissionReply: { ...mixedReply, requestId: "saved-root" } }); f.render(); await flush(); await f.press("inbox:submissions"); await f.press("inbox:submission:current:saved-root");
  const nodes = flatten(f.render().document.nodes);
  assert.ok(nodes.some(n => n.id === "inbox:submission:verification" && n.text === "backgroundInbox.verifiedBranches: 1/3"));
  assert.ok(nodes.some(n => n.id === "inbox:submission:identity" && n.text.includes("original") && n.text.includes("saved-root")));
  assert.ok(nodes.some(n => n.id === "inbox:submission:proof:documents" && n.text === "Actual document answer"));
  assert.ok(nodes.some(n => n.id === "inbox:submission:artifact:new-file"));
  assert.ok(nodes.some(n => n.text === "backgroundInbox.submissionPending"));
  assert.equal(f.calls.some(([name]) => ["ack", "download", "submission_cancel"].includes(name)), false); f.hooks.unmount();
});

test("absent plans and offline status reads keep unknown progress distinct from completed work", async () => {
  const queued = setup({ currentReply: { ...result, run: { state: "pending", success: false }, outcomes: null, artifacts: [] } }); queued.render(); await flush(); await queued.press("inbox:read:entry"); await queued.press("inbox:current");
  const nodes = flatten(queued.render().document.nodes);
  assert.ok(nodes.some(n => n.id === "inbox:current:verification" && n.text === "backgroundInbox.noPlan"));
  assert.equal(nodes.some(n => n.id.startsWith("inbox:current:branch:")), false);
  assert.equal(nodes.some(n => n.text?.includes("backgroundInbox.completed")), false); queued.hooks.unmount();
  const offline = setup({ currentFails: true }); offline.render(); await flush(); await offline.press("inbox:read:entry"); await offline.press("inbox:current");
  const saved = flatten(offline.render().document.nodes);
  assert.ok(saved.some(n => n.id === "inbox:output")); assert.equal(saved.some(n => n.id === "inbox:currentDetail"), false);
  assert.ok(saved.some(n => n.kind === "Banner" && n.text.includes("unavailable"))); offline.hooks.unmount();
});

test("returning during a snapshot read invalidates late success and failure without reopening a task or canceling it", async () => {
  for (const fail of [false, true]) {
    let resolve, reject; const f = setup({ snapshotReply: new Promise((yes, no) => { resolve = yes; reject = no; }) }); f.render(); await flush();
    const pending = f.press("inbox:read:entry"); await flush(); await f.press("inbox:back");
    if (fail) reject(new Error("Late abandoned read")); else resolve(result);
    await pending; const view = f.render(), nodes = flatten(view.document.nodes);
    assert.equal(nodes.some(n => n.id === "inbox:output" || n.kind === "Banner"), false);
    assert.equal(view.handlers.has("inbox:read:entry"), true);
    assert.equal(f.calls.some(([name]) => ["ack", "resume", "submission_cancel"].includes(name)), false); f.hooks.unmount();
  }
});

test("leaving current task detail prevents a late reply from appearing when the retained snapshot is reopened", async () => {
  let resolve; const f = setup({ currentReply: new Promise(yes => { resolve = yes; }) }); f.render(); await flush(); await f.press("inbox:read:entry");
  const pending = f.press("inbox:current"); await flush(); await f.press("inbox:back"); resolve(mixedReply); await pending;
  await f.press("inbox:read:entry"); const nodes = flatten(f.render().document.nodes);
  assert.equal(nodes.some(n => n.id === "inbox:currentDetail"), false);
  assert.ok(nodes.some(n => n.id === "inbox:proof:calendar")); f.hooks.unmount();
});

test("leaving saved submissions invalidates a late original-host detail and clears it on reopening", async () => {
  let resolve; const f = setup({ submissionReply: new Promise(yes => { resolve = yes; }) }); f.render(); await flush(); await f.press("inbox:submissions");
  const pending = f.press("inbox:submission:current:saved-root"); await flush(); await f.press("inbox:back"); resolve({ ...mixedReply, requestId: "saved-root" }); await pending;
  await f.press("inbox:submissions"); assert.equal(flatten(f.render().document.nodes).some(n => n.id === "inbox:submission:actual"), false); f.hooks.unmount();
});

const elements = (children) => [children].flat(Infinity).flatMap(child => child && typeof child === "object" ? [child, ...elements(child.props?.children)] : []);
test("Astryx task detail uses the same real branch data with semantic headings and disabled in-flight controls", async () => {
  let resolve; const f = setup({ apple: false, currentReply: new Promise(yes => { resolve = yes; }) }); f.render(); await flush();
  let tree = elements(f.render().children); tree.find(n => n.key === "inbox:read:entry").props.onClick(); await flush();
  tree = elements(f.render().children); tree.find(n => n.key === "inbox:current").props.onClick(); await flush();
  tree = elements(f.render().children); assert.equal(tree.find(n => n.key === "inbox:current").props.isDisabled, true);
  resolve(mixedReply); await flush(); tree = elements(f.render().children);
  assert.ok(tree.some(n => n.type === "Heading" && n.props.level === 2 && n.props.children === "backgroundInbox.hostReceipt"));
  assert.ok(tree.some(n => n.key === "inbox:current:branch:calendar" && n.type === "Heading" && n.props.level === 3));
  assert.ok(tree.some(n => n.type === "Text" && n.props.children === "backgroundInbox.verifiedBranches: 1/3"));
  assert.ok(tree.some(n => n.type === "Text" && n.props.children === "Full retained implementation report"));
  assert.equal(tree.some(n => n.key === "inbox:download:new-file"), false); f.hooks.unmount();
});

test("offline cancellation shows persisted stop and pending confirmation while disabling duplicate controls", async () => {
  const f = setup({ submissionOffline: true }); f.render(); await flush(); await f.press("inbox:submissions"); await f.press("inbox:submission:cancel:saved-root");
  const view = f.render(), nodes = flatten(view.document.nodes);
  assert.ok(nodes.some(n => n.text === "backgroundInbox.cancelPending"));
  assert.equal(nodes.some(n => n.text === "backgroundInbox.cancelConfirmed"), false);
  assert.ok(nodes.some(n => n.kind === "Banner" && n.text.includes("original host")));
  assert.equal(view.handlers.get("inbox:submission:cancel:saved-root").enabled, false);
  assert.equal(nodes.some(n => n.id === "inbox:submission:actualState"), false);
  assert.equal(f.calls.some(([name]) => name === "ack"), false); f.hooks.unmount();
});

test("submission UI handles empty and copied installation records without acquiring execution authority", async () => {
  const empty = setup({ emptySubmissions: true }); empty.render(); await flush(); await empty.press("inbox:submissions");
  assert.ok(flatten(empty.render().document.nodes).some(n => n.id === "inbox:submissions:empty")); empty.hooks.unmount();
  const foreign = setup({ submission: { localOwner: false } }); foreign.render(); await flush(); await foreign.press("inbox:submissions");
  const view = foreign.render(); assert.equal(view.handlers.get("inbox:submission:current:saved-root").enabled, false); assert.equal(view.handlers.get("inbox:submission:cancel:saved-root").enabled, false);
  assert.ok(flatten(view.document.nodes).some(n => n.text === "backgroundInbox.otherInstallation")); foreign.hooks.unmount();
});

test("native inbox UI reads actual full results, preserves waiting/file manifests and ACK is a separate explicit action", async () => {
  const f = setup(); f.render(); await flush();
  await f.press("inbox:read:entry"); const nodes = flatten(f.render().document.nodes);
  assert.ok(nodes.some((n) => n.text === "Full retained implementation report")); assert.ok(nodes.some((n) => n.text === "Actual connector is unavailable"));
  assert.ok(nodes.some((n) => n.text === "产品.html (27 B)")); assert.equal(f.calls.some(([call]) => call === "ack"), false);
  await f.press("inbox:ack"); assert.deepEqual(f.calls.filter(([call]) => call === "ack"), [["ack", "entry"]]);
  assert.ok(flatten(f.render().document.nodes).some((n) => n.text === "backgroundInbox.empty")); f.hooks.unmount();
});
test("failed synchronization or ACK leaves cached results available with a real error and no fake read state", async () => {
  const f = setup({ syncFails: true, ackFails: true }); f.render(); await flush(); await f.press("inbox:refresh");
  assert.ok(flatten(f.render().document.nodes).some((n) => n.kind === "Banner" && n.text.includes("unavailable")));
  await f.press("inbox:read:entry"); await f.press("inbox:ack"); const view = f.render();
  assert.equal(view.handlers.get("inbox:ack").enabled, true); assert.ok(flatten(view.document.nodes).some((n) => n.text?.includes("persisted"))); f.hooks.unmount();
});
test("StrictMode replay keeps the replacement read and browser mode cannot synchronize native peer credentials", async () => {
  let release; const f = setup({ firstRead: new Promise((resolve) => { release = resolve; }) }); f.render(); f.hooks.replayEffects(); await flush();
  assert.ok(f.render().handlers.has("inbox:read:entry")); release({ items: [], nextCursor: null }); await flush(); assert.ok(f.render().handlers.has("inbox:read:entry")); f.hooks.unmount();
  const browser = setup({ browser: true }); const view = browser.render(); await flush(); assert.deepEqual(browser.calls, []); assert.equal(view.handlers.has("inbox:refresh"), false); browser.hooks.unmount();
});

test("a superseded initial read cannot overwrite replacement data with its late failure", async () => {
  let reject;
  const f = setup({ firstRead: new Promise((_, fail) => { reject = fail; }) });
  f.render(); f.hooks.replayEffects(); await flush();
  assert.equal(f.render().handlers.get("inbox:read:entry").enabled, true);
  reject(new Error("Obsolete initial read failed")); await flush();
  const view = f.render();
  assert.equal(view.handlers.get("inbox:read:entry").enabled, true);
  assert.equal(flatten(view.document.nodes).some((n) => n.kind === "Banner"), false);
  f.hooks.unmount();
});

test("artifact UI saves to the actual local workspace and offline failure cannot show a saved file or ACK", async () => {
  const f = setup(); f.render(); await flush(); await f.press("inbox:read:entry");
  await f.press("inbox:download:file");
  assert.deepEqual(f.calls.filter(([call]) => call === "download"), [["download", "entry", "file", "/actual-phone"]]);
  assert.ok(flatten(f.render().document.nodes).some((n) => n.id === "inbox:saved:file")); assert.equal(f.calls.some(([call]) => call === "ack"), false); f.hooks.unmount();
  const offline = setup({ downloadFails: true }); offline.render(); await flush(); await offline.press("inbox:read:entry"); await offline.press("inbox:download:file");
  const view = offline.render(); assert.equal(view.handlers.get("inbox:download:file").enabled, true); assert.equal(flatten(view.document.nodes).some((n) => n.id === "inbox:saved:file"), false);
  assert.ok(flatten(view.document.nodes).some((n) => n.kind === "Banner" && n.text.includes("offline"))); offline.hooks.unmount();
});

test("an unsent withdrawn native event has a truthful local state and no remote query, cancel or retry control",async()=>{
  const f=setup({submission:{locallyWithdrawn:true,cancelRequested:true,cancellationConfirmed:false,probes:0}});
  try {
    f.render();await flush();await f.press("inbox:submissions");const view=f.render();const nodes=flatten(view.document.nodes);
    assert.ok(nodes.some(node=>node.id==="inbox:submission:state:saved-root" && node.text==="backgroundInbox.locallyWithdrawn"));
    assert.equal(view.handlers.get("inbox:submission:current:saved-root").enabled,false);
    assert.equal(view.handlers.get("inbox:submission:cancel:saved-root").enabled,false);
    assert.equal(nodes.some(node=>node.id==="inbox:submission:retry:saved-root"),false);
    assert.equal(nodes.some(node=>node.id==="inbox:submission:state:saved-root" && node.text==="backgroundInbox.cancelConfirmed"),false);
    assert.equal(f.calls.some(([name])=>name==="submission_current" || name==="submission_cancel"),false);
  }finally{f.hooks.unmount();}
});

test("current status is a separate original-host reply and cannot overwrite the retained report or ACK", async () => {
  const f = setup(); f.render(); await flush(); await f.press("inbox:read:entry"); await f.press("inbox:current");
  const nodes = flatten(f.render().document.nodes); assert.ok(nodes.some((n) => n.id === "inbox:currentState" && n.text.includes("backgroundInbox.queued")));
  assert.ok(nodes.some((n) => n.text === "Full retained implementation report")); assert.equal(f.calls.some(([name]) => name === "ack"), false); assert.equal(f.render().handlers.has("inbox:resume"), false); f.hooks.unmount();
  const wrong = setup({ currentReply: { ...result, hostId: "different-host" } }); wrong.render(); await flush(); await wrong.press("inbox:read:entry"); await wrong.press("inbox:current");
  assert.equal(flatten(wrong.render().document.nodes).some((n) => n.id === "inbox:currentState"), false); assert.ok(flatten(wrong.render().document.nodes).some((n) => n.kind === "Banner")); wrong.hooks.unmount();
});
test("actual response resumes the same occurrence and displays acceptance without claiming completion", async () => {
  const f = setup(); f.render(); await flush(); await f.press("inbox:read:entry"); assert.equal(f.render().handlers.get("inbox:resume").enabled, false);
  await f.press("inbox:response", "Tomorrow at 10:00"); await f.press("inbox:resume");
  assert.deepEqual(f.calls.filter(([name]) => name === "resume"), [["resume", "entry", "Tomorrow at 10:00"]]);
  assert.ok(flatten(f.render().document.nodes).some((n) => n.id === "inbox:currentState" && n.text.includes("backgroundInbox.queued"))); assert.equal(f.calls.some(([name]) => name === "ack"), false); f.hooks.unmount();
});
test("uncertain delivery restores the native immutable response and missing staging never claims persistence", async () => {
  const f = setup({ resumeFails: true }); f.render(); await flush(); await f.press("inbox:read:entry"); await f.press("inbox:response", "Actual requested information"); await f.press("inbox:resume");
  let view = f.render(); assert.equal(view.handlers.get("inbox:response").enabled, false); assert.ok(flatten(view.document.nodes).some((n) => n.text === "backgroundInbox.responsePending"));
  await f.press("inbox:back"); await f.press("inbox:read:entry"); view = f.render(); assert.equal(view.handlers.get("inbox:response").enabled, false); assert.ok(flatten(view.document.nodes).some((n) => n.kind === "TextInput" && n.value === "Actual requested information")); f.hooks.unmount();
  const failure = setup({ stageFails: true }); failure.render(); await flush(); await failure.press("inbox:read:entry"); await failure.press("inbox:response", "Actual"); await failure.press("inbox:resume");
  view = failure.render(); assert.equal(view.handlers.get("inbox:response").enabled, true); assert.equal(flatten(view.document.nodes).some((n) => n.id === "inbox:responseSaved"), false); failure.hooks.unmount();
});
