import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const appSource = readSource("src/App.tsx");
const chatPageSource = readSource("src/pages/ChatPage.tsx");
const chatHeaderSource = readSource("src/pages/chat/components/ChatHeader.tsx");
const composerSource = readSource("src/pages/chat/components/ChatComposerBar.tsx");
const mobileActionsSource = readSource("src/pages/chat/mobile/MobileQuickActions.tsx");
const sidebarSource = readSource("src/components/chat/ChatHistorySidebar.tsx");
const transcriptSource = readSource("src/pages/chat/transcript/ChatTranscript.tsx");
const mobileSkillsSource = readSource("src/pages/chat/mobile/MobileSkillsPage.tsx");
const settingsSource = readSource("src/pages/SettingsPage.tsx");
const themeSource = readSource("src/theme/xgentTheme.ts");
const stylesSource = readSource("src/index.css");

test("compact chat uses the reference-scale Astryx geometry without changing the desktop theme", () => {
  const compactTheme = themeSource.slice(themeSource.indexOf("export const xgentCompactTheme"));
  assert.match(compactTheme, /"--size-element-lg": "56px"/);
  assert.match(compactTheme, /"--radius-container": "30px"/);
  assert.match(compactTheme, /"--radius-page": "36px"/);
  assert.match(compactTheme, /"--radius-chat": "34px"/);
  assert.match(compactTheme, /"chat-composer": \{[\s\S]*?minHeight: "112px"/);
  assert.match(stylesSource, /--xgent-composer-width: min\(50rem,/);
});

test("mobile chat keeps one accessible header action cluster and a large functional composer", () => {
  const mobileComposerMenu = composerSource.slice(
    composerSource.indexOf("const mobileAddMenuContent"),
    composerSource.indexOf("const toggleComposerExpanded"),
  );
  assert.match(chatHeaderSource, /className="xgent-mobile-chat-toolbar w-full"/);
  assert.match(
    chatHeaderSource,
    /<SegmentedControl[\s\S]*?layout="fill"[\s\S]*?size="lg"/,
  );
  assert.match(composerSource, /density=\{mobileExperience \? "balanced" : "compact"\}/);
  assert.match(composerSource, /className="xgent-mobile-composer-menu-row"/);
  assert.equal(mobileComposerMenu.match(/<ListItem/g)?.length, 5);
  assert.doesNotMatch(mobileComposerMenu, /nativeWebSearchEnabled|planModeEnabled/);
  assert.match(composerSource, /<MobileComposerMenuIcon>[\s\S]*?<Camera \/>[\s\S]*?<\/MobileComposerMenuIcon>/);
  assert.match(composerSource, /size=\{mobileExperience \? "md" : "sm"\}/);
  assert.match(chatPageSource, /onToggleTrajectory=\{/);
  assert.match(mobileActionsSource, /id: "trajectory"/);
  assert.match(transcriptSource, /showMobileBlankState = mobileExperience && showStartChatState/);
  assert.match(
    transcriptSource,
    /\(showNoModelsState \|\| showStartChatState\) && !showMobileBlankState/,
  );
  assert.doesNotMatch(chatPageSource, /size="lg"\s+isPressed=\{chatSurface === "trajectory"\}/);
});

test("mobile navigation and settings retain Astryx drawer and bottom-sheet hierarchy", () => {
  assert.match(sidebarSource, /<MobileNav[\s\S]*?width=\{320\}[\s\S]*?side="start"/);
  for (const destination of ["library", "projects", "plugins", "scheduled", "remote", "more"]) {
    assert.match(sidebarSource, new RegExp(`sidebar\\.mobile\\.${destination}`));
  }
  assert.match(mobileSkillsSource, /<List density="spacious">/);
  assert.doesNotMatch(mobileSkillsSource, /<ClickableCard/);
  assert.match(appSource, /<BottomSheet[\s\S]*?height="tall"[\s\S]*?<SettingsPage/);
  assert.match(settingsSource, /<DialogHeader[\s\S]*?hasDivider=\{false\}/);
  assert.match(chatPageSource, /data-mobile-chat-workspace=\{mobileExperience/);
});
