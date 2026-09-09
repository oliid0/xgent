import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Stack";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { memo, type ReactNode } from "react";

import { Menu } from "../../../components/icons";
import { isMacOsTauri } from "../../../components/MacOsTitleBarSpacer";
import { useLocale } from "../../../i18n";

export const ChatHeader = memo(function ChatHeader(props: {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  mobileExperience?: boolean;
  trailingActions?: ReactNode;
}) {
  const { sidebarOpen, onOpenSidebar, mobileExperience = false, trailingActions } = props;
  const { t } = useLocale();
  const macOsTauri = isMacOsTauri();

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
          ? "env(safe-area-inset-top, 0px)"
          : "var(--spacing-2-5)",
        paddingBlockEnd: mobileExperience ? 0 : "var(--spacing-2-5)",
        paddingInlineEnd: mobileExperience ? "env(safe-area-inset-right, 0px)" : "var(--spacing-4)",
        paddingInlineStart:
          !sidebarOpen && macOsTauri
            ? "var(--xgent-macos-titlebar-inset)"
            : mobileExperience
              ? "env(safe-area-inset-left, 0px)"
              : "var(--spacing-4)",
      }}
    >
      {mobileExperience ? (
        <Toolbar
          label={t("settings.executionMode")}
          size="lg"
          gap={1}
          className="xgent-mobile-chat-toolbar w-full"
          startContent={
            <HStack gap={1} vAlign="center" hAlign="start">
              {!sidebarOpen && !macOsTauri ? (
                <IconButton
                  label={t("tooltip.openSidebar")}
                  tooltip={t("tooltip.openSidebar")}
                  icon={<Menu size={20} />}
                  variant="secondary"
                  size="lg"
                  onClick={onOpenSidebar}
                />
              ) : null}
            </HStack>
          }
          endContent={
            <HStack gap={1} vAlign="center" hAlign="end">
              {trailingActions}
            </HStack>
          }
        />
      ) : (
        <Grid
          columns={2}
          width="100%"
          align="center"
          style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
        >
          <HStack gap={1} vAlign="center" hAlign="start" />

          <HStack gap={1} vAlign="center" hAlign="end" style={{ minWidth: "max-content" }}>
            {trailingActions}
          </HStack>
        </Grid>
      )}
    </HStack>
  );
});
