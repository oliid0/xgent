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

const { WorkspaceNavigationRail } = createTsModuleLoader({ mocks: {
  "../../i18n": { useLocale: () => ({ t: key => key }) },
  "@astryxdesign/core/SideNav": { SideNav: "SideNav", SideNavItem: "IconButton", SideNavSection: "SideNavSection" },
  "../icons": Object.fromEntries(["Cable", "FolderTree", "MessageSquare", "PanelLeft", "SkillIcon", "SquarePen"].map(name => [name, name])),
  "../MacOsTitleBarSpacer": { MacOsTitleBarSpacer: "MacOsTitleBarSpacer" },
  "../AppUpdateButton": { AppUpdateButton: "AppUpdateButton" },
  "./SidebarActionMenu": { SidebarActionMenu: "SidebarActionMenu" },
} }).loadModule("src/components/workspace-tools/WorkspaceNavigationRail.tsx");

test("sidebar reopening follows responsive transitions with one desktop entry and a mobile toggle", () => {
  let sidebarOpen = false, toggles = 0;
  const toggle = () => { sidebarOpen = !sidebarOpen; toggles++; };
  for (const mobileExperience of [true, false, true, false]) {
    const props = () => ({ sidebarOpen, mobileExperience, onOpenSidebar: toggle });
    const header = buttons(ChatHeader(props()));
    assert.equal(header.length, mobileExperience ? 1 : 0, "Wide chat headers must not duplicate the navigation rail");
    const rail = WorkspaceNavigationRail({ panelOpen: sidebarOpen, activeTarget: "conversations", onTogglePanel: toggle });
    const reopen = mobileExperience ? header[0] : buttons(rail.props.topContent).find(button => button.label === "sidebar.openSidebar");
    assert.ok(reopen); reopen.onClick(); assert.equal(sidebarOpen, true);
    const openedHeader = buttons(ChatHeader(props()));
    if (mobileExperience) {
      assert.equal(openedHeader.length, 1); assert.equal(openedHeader[0].label, "tooltip.closeSidebar");
      openedHeader[0].onClick(); assert.equal(sidebarOpen, false);
    } else {
      assert.equal(openedHeader.length, 0); sidebarOpen = false;
    }
  }
  assert.equal(toggles, 6);
});
