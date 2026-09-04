import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const appSource = readSource("src/App.tsx");
const chatPageSource = readSource("src/pages/ChatPage.tsx");
const chatHeaderSource = readSource("src/pages/chat/components/ChatHeader.tsx");
const composerSource = readSource("src/pages/chat/components/ChatComposerBar.tsx");
const mentionComposerSource = readSource("src/components/chat/MentionComposer.tsx");
const toolApprovalSource = readSource("src/components/chat/ToolApprovalBar.tsx");
const mobileActionsSource = readSource("src/pages/chat/mobile/MobileQuickActions.tsx");
const sidebarSource = readSource("src/components/chat/ChatHistorySidebar.tsx");
const transcriptSource = readSource("src/pages/chat/transcript/ChatTranscript.tsx");
const mobileSkillsSource = readSource("src/pages/chat/mobile/MobileSkillsPage.tsx");
const settingsSource = readSource("src/pages/SettingsPage.tsx");
const mobileTerminalSource = readSource("src/pages/chat/mobile/MobileTerminalPanel.tsx");
const mobileSshSource = readSource("src/pages/chat/mobile/MobileSshPanel.tsx");
const mobileGitSource = readSource("src/pages/chat/mobile/MobileGitReviewPanel.tsx");
const themeSource = readSource("src/theme/xgentTheme.ts");
const stylesSource = readSource("src/index.css");

test("compact chat uses the reference-scale Astryx geometry without changing the desktop theme", () => {
  const compactTheme = themeSource.slice(themeSource.indexOf("export const xgentCompactTheme"));
  assert.match(compactTheme, /"--size-element-lg": "44px"/);
  assert.match(compactTheme, /"--radius-container": "14px"/);
  assert.match(compactTheme, /"--radius-page": "20px"/);
  assert.match(compactTheme, /"--radius-chat": "28px"/);
  assert.match(compactTheme, /"chat-composer": \{[\s\S]*?minHeight: "52px"/);
  assert.match(compactTheme, /section: \{[\s\S]*?backgroundColor:[\s\S]*?boxShadow: "none"/);
  assert.match(stylesSource, /--xgent-composer-width: min\(50rem,/);
});

test("mobile chat keeps one accessible header action cluster and a one-line functional composer", () => {
  assert.match(chatHeaderSource, /className="xgent-mobile-chat-toolbar w-full"/);
  assert.match(
    chatHeaderSource,
    /<SegmentedControl[\s\S]*?layout="fill"[\s\S]*?size="lg"/,
  );
  assert.match(composerSource, /density=\{mobileExperience \? "balanced" : "compact"\}/);
  assert.match(composerSource, /content=\{addMenuContent\}/);
  assert.doesNotMatch(composerSource, /mobileAddMenuContent|<AtSign \/>/);
  assert.doesNotMatch(toolApprovalSource, /backdrop-blur/);
  assert.match(composerSource, /onThreeLineOverflowChange=\{setShowComposerExpandControl\}/);
  assert.match(mentionComposerSource, /mention-composer min-h-11 max-h-\[160px\]/);
  assert.match(composerSource, /size=\{mobileExperience \? "md" : "sm"\}/);
  assert.doesNotMatch(chatPageSource, /<MobileQuickActions[\s\S]*?onToggleTrajectory=\{/);
  assert.doesNotMatch(mobileActionsSource, /id: "trajectory"/);
  assert.match(chatPageSource, /!mobileExperience && canShowTrajectory/);
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
  assert.match(
    appSource,
    /<BottomSheet[\s\S]*?paddingBlockStart=\{5\}[\s\S]*?<SettingsPage/,
  );
  assert.match(settingsSource, /<DialogHeader[\s\S]*?hasDivider=\{false\}/);
  assert.match(
    settingsSource,
    /padding=\{section === "toolPermissions" \|\| section === "voice" \? 5 : 4\}/,
  );
  assert.doesNotMatch(settingsSource, /settings-section-balanced-inset/);
  for (const panelSource of [mobileTerminalSource, mobileSshSource, mobileGitSource]) {
    assert.match(panelSource, /bg-\[var\(--color-background-surface\)\]/);
    assert.doesNotMatch(panelSource, /backdrop-blur|bg-\[var\(--color-bg-primary\)\]\/90/);
  }
  assert.match(
    stylesSource,
    /\.settings-page-compact \.mobile-panel-header \{[\s\S]*?backdrop-filter: none/,
  );
  assert.match(
    stylesSource,
    /\.settings-page-compact\s+:is\([\s\S]*?background: var\(--color-background-card\)/,
  );
  assert.match(
    stylesSource,
    /\.mcp-server-card,\s+\.hub-skill-card \{[\s\S]*?background: var\(--color-background-card\);[\s\S]*?backdrop-filter: none/,
  );
  assert.doesNotMatch(stylesSource, /\[data-native-mobile="true"\]\s+\.settings-page-compact\s+:is/);
  assert.match(chatPageSource, /data-mobile-chat-workspace=\{mobileExperience/);
});
