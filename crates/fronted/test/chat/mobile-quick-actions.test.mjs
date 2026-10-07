import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const icon = () => null;
const { MobileQuickActions } = createTsModuleLoader({ mocks: {
  "@astryxdesign/core/DropdownMenu": { DropdownMenu() {} },
  "../../../components/icons": Object.fromEntries(["Cpu", "GitBranch", "Globe", "Key", "MoreHorizontal", "Package", "Settings", "Terminal"].map(name => [name, icon])),
  "../../../i18n": { useLocale: () => ({ t: key => key }) },
} }).loadModule("src/pages/chat/mobile/MobileQuickActions.tsx");

test("mobile tool actions dispatch real navigation and XChat exposes only browser controls", () => {
  const calls = [];
  const props = Object.fromEntries(["Terminal", "Rootfs", "Browser", "BrowserSettings", "GitReview", "Ssh", "BackgroundTasks"].map(name => [`onOpen${name}`, () => calls.push(name)]));
  const agent = MobileQuickActions({ ...props, agentToolsEnabled: true });
  assert.equal(agent.props.presentation, "bottom-sheet");
  const actions = agent.props.items.flatMap(group => group.items);
  assert.deepEqual(actions.map(item => item.id), ["terminal", "rootfs", "browser", "browser-settings", "git", "ssh", "background"]);
  for (const action of actions) action.onClick();
  assert.deepEqual(calls, ["Terminal", "Rootfs", "Browser", "BrowserSettings", "GitReview", "Ssh", "BackgroundTasks"]);
  calls.length = 0;
  const chat = MobileQuickActions({ ...props, agentToolsEnabled: false });
  const safe = chat.props.items.flatMap(group => group.items);
  assert.deepEqual(safe.map(item => item.id), ["browser", "browser-settings"]);
  safe[0].onClick();
  assert.deepEqual(calls, ["Browser"]);
});
