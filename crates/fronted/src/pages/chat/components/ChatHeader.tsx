import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack } from "@astryxdesign/core/Stack";
import { memo, type ReactNode } from "react";

import { MonitorSmartphone, Moon, PanelLeft, Sun } from "../../../components/icons";
import { isMacOsTauri } from "../../../components/MacOsTitleBarSpacer";
import { useLocale } from "../../../i18n";
import {
  type AppSettings,
  type ExecutionMode,
  getNextTheme,
  type Theme,
} from "../../../lib/settings";

function ThemeToggleIcon(props: { theme: Theme }) {
  if (props.theme === "light") return <Sun size={16} />;
  if (props.theme === "dark") return <Moon size={16} />;
  return <MonitorSmartphone size={16} />;
}

export const ChatHeader = memo(function ChatHeader(props: {
  settings: AppSettings;
  sidebarOpen: boolean;
  onSelectExecutionMode: (mode: ExecutionMode) => void;
  onToggleTheme: () => void;
  onOpenSidebar: () => void;
  mobileExperience?: boolean;
  preThemeActions?: ReactNode;
  trailingActions?: ReactNode;
}) {
  const {
    settings,
    sidebarOpen,
    onSelectExecutionMode,
    onToggleTheme,
    onOpenSidebar,
    mobileExperience = false,
    preThemeActions,
    trailingActions,
  } = props;
  const { t } = useLocale();
  const nextTheme = getNextTheme(settings.theme);
  const themeToggleTitle =
    nextTheme === "light"
      ? t("tooltip.switchToLight")
      : nextTheme === "dark"
        ? t("tooltip.switchToDark")
        : t("tooltip.switchToAuto");
  const macOsTauri = isMacOsTauri();
  const visibleExecutionMode = settings.system.executionMode === "text" ? "text" : "tools";

  return (
    <HStack
      as="header"
      data-tauri-drag-region
      data-mobile-chat-header={mobileExperience ? "true" : undefined}
      className="chat-header"
      width="100%"
      vAlign="center"
      gap={0}
      style={{
        paddingBlockStart: mobileExperience
          ? "calc(var(--spacing-2) + env(safe-area-inset-top, 0px))"
          : "var(--spacing-2-5)",
        paddingBlockEnd: mobileExperience ? "var(--spacing-2)" : "var(--spacing-2-5)",
        paddingInlineEnd: mobileExperience
          ? "max(var(--spacing-3), env(safe-area-inset-right, 0px))"
          : "var(--spacing-4)",
        paddingInlineStart:
          !sidebarOpen && macOsTauri
            ? "var(--xagent-macos-titlebar-inset)"
            : mobileExperience
              ? "max(var(--spacing-3), env(safe-area-inset-left, 0px))"
              : "var(--spacing-4)",
      }}
    >
      <Grid
        columns={3}
        width="100%"
        align="center"
        style={{ gridTemplateColumns: "minmax(0, 1fr) auto minmax(max-content, 1fr)" }}
      >
        <HStack gap={1} vAlign="center" hAlign="start">
          {mobileExperience && !sidebarOpen && !macOsTauri ? (
            <IconButton
              label={t("tooltip.openSidebar")}
              tooltip={t("tooltip.openSidebar")}
              icon={<PanelLeft size={20} />}
              variant="ghost"
              size="lg"
              onClick={onOpenSidebar}
            />
          ) : null}
        </HStack>

        <HStack hAlign="center" vAlign="center">
          <SegmentedControl
            value={visibleExecutionMode}
            onChange={(value) => onSelectExecutionMode(value as "text" | "tools")}
            label={t("settings.executionMode")}
            layout="fill"
            size={mobileExperience ? "sm" : "md"}
          >
            <SegmentedControlItem value="text" label={t("chat.mode.chat")} />
            <SegmentedControlItem value="tools" label={t("chat.mode.agent")} />
          </SegmentedControl>
        </HStack>

        <HStack gap={1} vAlign="center" hAlign="end" style={{ minWidth: "max-content" }}>
          {!mobileExperience ? preThemeActions : null}
          {!mobileExperience ? (
            <IconButton
              label={themeToggleTitle}
              tooltip={themeToggleTitle}
              icon={<ThemeToggleIcon theme={nextTheme} />}
              variant="ghost"
              size="md"
              onClick={onToggleTheme}
            />
          ) : null}
          {trailingActions}
        </HStack>
      </Grid>
    </HStack>
  );
});
