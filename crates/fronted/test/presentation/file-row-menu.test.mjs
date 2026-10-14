import assert from "node:assert/strict";
import test from "node:test";
import {createTsModuleLoader} from "../helpers/load-ts-module.mjs";
import {createReactHookHarness} from "../helpers/react-hook-harness.mjs";

test("touch file menus reuse desktop operations, exact row identity and capability disablement",async t=>{
  const hooks=createReactHookHarness(),calls=[];t.after(hooks.unmount);
  const loader=createTsModuleLoader({mocks:{react:hooks.react,
    "@astryxdesign/core/ContextMenu":{ContextMenu:"ContextMenu"},"@astryxdesign/core/DropdownMenu":{DropdownMenu:"DropdownMenu"},
    "../../../i18n":{useLocale:()=>({t:key=>key})},"../../astryx/useAppToast":{useAppToast:()=>()=>{}},
    "../../../lib/system/clipboardText":{writeClipboardText:async value=>{calls.push(["copy",value]);return true;}},
    "../../icons":Object.fromEntries(["Copy","Edit3","ExternalLink","Eye","EyeOff","FilePenLine","Folder","FolderOpen","MoreHorizontal","Plus","RefreshCw","Trash2"].map(name=>[name,name])),
  }});
  const {FileTreeRowMenu,FileTreeContextMenu}=loader.loadModule("src/components/project-tools/file-tree/ContextMenu.tsx");
  const props={path:"nested/actual-report.md",kind:"file",canMutate:true,canOpenFile:true,canInsertMention:true,showHidden:false,onClose(){},onOpenFile:path=>calls.push(["open",path]),onOpenExternal(){},onOpenContainingDirectory(){},onStartAction:(action,path)=>calls.push([action,path]),onDelete:path=>calls.push(["delete",path]),onInsertMention:path=>calls.push(["mention",path]),onRefresh:(path,kind)=>calls.push(["refresh",path,kind]),onToggleHidden(){},onActionError:message=>calls.push(["error",message])};
  const row=()=>hooks.render(()=>FileTreeRowMenu(props));
  let menu=row();assert.equal(menu.props.presentation,"adaptive");assert.equal(menu.props.button.isIconOnly,true);
  const select=key=>row().props.items.find(item=>item.label==="projectTools.fileTree."+key).onClick();
  select("rename");select("delete");select("insertReference");select("copyPath");await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[["rename",props.path],["delete",props.path],["mention",props.path],["copy",props.path]]);
  props.canMutate=false;menu=row();assert.equal(menu.props.items.find(item=>item.label==="projectTools.fileTree.rename").isDisabled,true);assert.equal(menu.props.items.find(item=>item.label==="projectTools.fileTree.delete").isDisabled,true);
  props.children="existing-tree";
  const desktop=hooks.render(()=>FileTreeContextMenu(props));assert.equal(desktop.props.children,"existing-tree");assert.deepEqual(desktop.props.items.map(item=>item.label??item.type),menu.props.items.map(item=>item.label??item.type));
});
