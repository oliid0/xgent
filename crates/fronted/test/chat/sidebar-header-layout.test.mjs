import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { ChatHeader } = createTsModuleLoader({ mocks: {
  react: { memo: component => component },
  "../../../i18n": { useLocale: () => ({ t: key => key }) },
  "../../../components/icons": { MobileMenu: "MobileMenu" },
  "../../../components/MacOsTitleBarSpacer": { isMacOsTauri: () => false },
  "@astryxdesign/core/Grid": { Grid: "Grid" },
  "@astryxdesign/core/IconButton": { IconButton: "IconButton" },
  "@astryxdesign/core/Stack": { HStack: "HStack" },
  "@astryxdesign/core/Toolbar": { Toolbar: "Toolbar" },
} }).loadModule("src/pages/chat/components/ChatHeader.tsx");

function buttons(node) {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!node?.props) return [];
  return [
    ...(node.type === "IconButton" ? [node.props] : []),
    ...buttons(node.props.children),
    ...buttons(node.props.startContent),
    ...buttons(node.props.endContent),
  ];
}

test("a collapsed sidebar can reopen after compact-to-wide and wide-to-compact transitions", () => {
  let sidebarOpen = false, opens = 0;
  for (const mobileExperience of [true, false, true, false]) {
    const props = () => ({ sidebarOpen, mobileExperience, onOpenSidebar() { sidebarOpen = true; opens++; } });
    const reopen = buttons(ChatHeader(props())).filter(button => button.label === "tooltip.openSidebar");
    assert.equal(reopen.length, 1);
    assert.equal(reopen[0].size, "lg");
    reopen[0].onClick();
    assert.equal(sidebarOpen, true);
    assert.equal(buttons(ChatHeader(props())).length, 0);
    sidebarOpen = false;
  }
  assert.equal(opens, 4);
});
