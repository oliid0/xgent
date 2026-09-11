import { useState } from "react";
import { SUPPORTED_LOCALES, useLocale } from "../i18n";
import { updateSystem } from "../lib/settings";
import type { SettingsSaveState } from "../lib/settings/storage";
import type { SettingsSectionProps } from "../pages/settings/types";
import { NativeSurface } from "./NativeSurface";
import type { PresentationHandler } from "./types";

/** Uses the same persisted settings updater as the Android and desktop forms. */
export function NativeMobileSystemSettings({
  settings,
  setSettings,
  onBack,
  saveState,
}: SettingsSectionProps & { onBack: () => void; saveState?: SettingsSaveState }) {
  const { t } = useLocale();
  const [failure, setFailure] = useState<unknown>(null);
  if (failure) throw failure;
  const handlers = new Map<string, PresentationHandler>([
    ["close", { enabled: true, accepts: (value) => value === null, run: onBack }],
    [
      "execution-mode",
      {
        enabled: true,
        accepts: (value) => value === "text" || value === "tools",
        run: (value) =>
          setSettings((previous) =>
            updateSystem(previous, { executionMode: value === "text" ? "text" : "tools" }),
          ),
      },
    ],
    [
      "locale",
      {
        enabled: true,
        accepts: (value) => SUPPORTED_LOCALES.some((locale) => locale === value),
        run: (value) =>
          setSettings((previous) => ({ ...previous, locale: value as typeof previous.locale })),
      },
    ],
  ]);
  return (
    <NativeSurface
      document={{
        mode: "sheet",
        title: t("settings.navSystem"),
        appearance: "system",
        dismissAction: "close",
        nodes: [
          ...(saveState
            ? [
                {
                  id: "save-status",
                  kind: "Text" as const,
                  secondary: saveState.status !== "error",
                  text:
                    saveState.status === "error"
                      ? `${t("settings.saveError")}: ${saveState.message}`
                      : t(saveState.status === "saving" ? "settings.saving" : "settings.saved"),
                },
              ]
            : []),
          {
            id: "execution-mode",
            kind: "Selector",
            label: t("settings.executionMode"),
            value: settings.system.executionMode === "text" ? "text" : "tools",
            action: "execution-mode",
            options: [
              { value: "text", label: t("settings.chatMode") },
              { value: "tools", label: t("settings.agentMode") },
            ],
          },
          {
            id: "execution-description",
            kind: "Text",
            secondary: true,
            text: t(
              settings.system.executionMode === "text"
                ? "settings.chatModeDesc"
                : "settings.agentModeDesc",
            ),
          },
          { id: "separator", kind: "Divider" },
          {
            id: "locale",
            kind: "Selector",
            label: t("settings.language"),
            value: settings.locale,
            action: "locale",
            options: SUPPORTED_LOCALES.map((locale) => ({
              value: locale,
              label: t(
                locale === "system"
                  ? "settings.auto"
                  : locale === "zh-CN"
                    ? "settings.chinese"
                    : "settings.english",
              ),
            })),
          },
        ],
      }}
      handlers={handlers}
      onError={setFailure}
    />
  );
}
