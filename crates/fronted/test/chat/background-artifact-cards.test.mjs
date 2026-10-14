import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const worker=randomUUID(),phone=randomUUID(),entry=randomUUID(),request=randomUUID();
const file={id:randomUUID(),relativePath:"product.docx",bytes:2048,contentHash:"a".repeat(64)};
const result={version:2,conversationId:"original",receiverHostId:phone,sourceHostId:worker,entryId:entry,requestId:request,snapshotHash:"b".repeat(64),artifacts:[file]};
const message={role:"assistant",content:[{type:"text",text:"Actual completed report"}],timestamp:300,api:"openai-completions",provider:"fixture",model:"fixture",stopReason:"stop",xgentBackgroundTask:{requestId:request,hostId:worker},xgentBackgroundResult:result};
const loader=createTsModuleLoader();
const artifacts=loader.loadModule("src/lib/chat/messages/backgroundArtifacts.ts");

test("actual received artifact metadata reaches history rounds without fabricating SDK calls or changing ordinary coding rounds",()=>{
  const {buildUiMessages}=loader.loadModule("src/lib/chat/messages/uiMessages.ts");
  const actual=buildUiMessages([message]);const round=actual[0].rounds[0];assert.equal(round.backgroundArtifacts[0].entryId,entry);assert.equal(round.blocks.some(block=>block.kind==="tool"),false);
  const ordinary=buildUiMessages([{...message,xgentBackgroundResult:undefined}])[0].rounds[0];assert.equal(Object.hasOwn(ordinary,"backgroundArtifacts"),false);
});

test("damaged, legacy, rebound, duplicate or unsafe manifest metadata never supplies interactive file references",()=>{
  assert.equal(artifacts.readBackgroundChatArtifacts(message).length,1);
  for(const patch of [{version:1},{requestId:randomUUID()},{sourceHostId:randomUUID()},{receiverHostId:"unknown"},{artifacts:[file,file]},{artifacts:[{...file,relativePath:"../secret"}]},{artifacts:[{...file,relativePath:"C:\\secret"}]},{artifacts:[{...file,bytes:513*1024*1024}]},{artifacts:Array(33).fill(file)}])assert.deepEqual(artifacts.readBackgroundChatArtifacts({...message,xgentBackgroundResult:{...result,...patch}}),[]);
  const refs=artifacts.readBackgroundChatArtifacts(message);assert.equal(artifacts.collectBackgroundChatArtifacts([{backgroundArtifacts:refs},{backgroundArtifacts:refs}]).length,1);
});

test("Astryx result card downloads through its original artifact reference, without an unowned Open With menu",async()=>{
  const hooks=createReactHookHarness(),opened=[];
  const view=createTsModuleLoader({mocks:{react:hooks.react,"../../i18n":{useLocale:()=>({t:key=>key})},"@astryxdesign/core/Button":{Button:"Button"},"./fileTypeIcons":{getFileTypeIcon:()=>"FileIcon"},"../workspace-editor/OpenWithMenu":{OpenWithMenu:"OpenWithMenu"}}}).loadModule("src/components/chat/GeneratedFilePreviewCard.tsx");
  const ref=artifacts.readBackgroundChatArtifacts(message)[0];
  const tree=hooks.render(()=>view.GeneratedFilePreviewCard({paths:[],previewedFiles:[{path:file.relativePath,toolCallId:"receipt",fileSource:null,backgroundArtifact:ref}],onOpenFileLink:link=>opened.push(link)}));
  const card=tree.props.children[0][0];await card.props.children[2].props.children.props.clickAction();assert.deepEqual(opened[0].backgroundArtifact,ref);assert.equal(card.props.children[2].props.children.type,"Button");
  hooks.unmount();
});

test("SwiftUI transcript uses the same actual file identity, name, type/size label and awaited download action",async()=>{
  const {createNativeChatTranscript}=loader.loadModule("src/presentation/nativeChatTranscript.ts");
  const refs=artifacts.readBackgroundChatArtifacts(message),calls=[],actions=new Map();
  const rounds=[{round:1,key:"r1",blocks:[{kind:"text",id:"text",text:"Actual report"}],backgroundArtifacts:refs}];
  const nodes=createNativeChatTranscript([{kind:"assistant",key:"reply",rounds,timestamp:300}],{liveRounds:[]},false,key=>key,(id,run)=>{actions.set(id,run);return id;},()=>assert.fail("Selected workspace used"),undefined,async file=>{calls.push(file)});
  const card=nodes[0].children.find(node=>node.variant==="generated-file");assert.equal(card.label,"product.docx");assert.equal(card.text,artifacts.backgroundChatArtifactLabel(refs[0]));await actions.get(card.action)();assert.deepEqual(calls[0].backgroundArtifact,refs[0]);
});

test("side chat forwards original artifact/file ownership and waits for the actual transfer rather than using a current workspace path",async()=>{
  const {createSplitFileLinkHandler}=createTsModuleLoader({mocks:{"../transcript/ChatTranscript":{ChatTranscript:"ChatTranscript"}}}).loadModule("src/pages/chat/components/SplitConversationPane.tsx");
  const ref=artifacts.readBackgroundChatArtifacts(message)[0],files=[],workspace=[];
  let finish;const pending=new Promise(resolve=>finish=resolve);
  const handler=createSplitFileLinkHandler({onOpenPreviewedFile:async file=>{files.push(file);await pending},onOpenWorkspaceFile:path=>workspace.push(path)});
  let completed=false;const opening=handler({path:file.relativePath,source:"relative",fileSource:null,backgroundArtifact:ref}).then(()=>completed=true);
  await Promise.resolve();assert.equal(completed,false);assert.equal(workspace.length,0);assert.deepEqual(files[0].backgroundArtifact,ref);finish();await opening;
  const missing=createSplitFileLinkHandler({onOpenWorkspaceFile:path=>workspace.push(path)});await assert.rejects(missing({path:file.relativePath,source:"relative",backgroundArtifact:ref}),/source is unavailable/);assert.equal(workspace.length,0);
});
