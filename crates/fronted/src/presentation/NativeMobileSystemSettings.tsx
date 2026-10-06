import { useState } from "react";
import { SUPPORTED_LOCALES, useLocale } from "../i18n";
import { updateSystem } from "../lib/settings";
import type { SettingsSaveState } from "../lib/settings/storage";
import type { SettingsSectionProps } from "../pages/settings/types";
import { NativeSurface } from "./NativeSurface";
import { createNativeDesktopAppearance } from "./nativeDesktopAppearance";
import { useNativeFontSettings } from "./nativeFontSettings";
import { withNativeSettingsIcons } from "./nativeSettingsIcons";
import { createNativePresentationTheme } from "./nativeTheme";
import type { PresentationHandler, PresentationNode } from "./types";

/** Uses the same persisted settings updater as the Android and desktop forms. */
export function NativeMobileSystemSettings({
  settings,
  setSettings,
  onBack,
  saveState,
}: SettingsSectionProps & { onBack: () => void; saveState?: SettingsSaveState }) {
  const { t } = useLocale();
  const appearance = createNativeDesktopAppearance({ settings, setSettings }, t, false);
  const fonts = useNativeFontSettings({ settings, setSettings }, true, t);
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
  for (const [id, handler] of appearance.handlers) handlers.set(id, handler);
  for (const [id, handler] of fonts.handlers) handlers.set(id, handler);
  return (
    <NativeSurface
      document={{
        mode: "sheet",
        title: t("settings.navSystem"),
        appearance: settings.theme,
        formFactor: "mobile",
        theme: createNativePresentationTheme(settings, true),
        dismissAction: "close",
        nodes: (
          [
            {
              id: "back",
              kind: "IconButton",
              label: t("settings.mobile.backToSettings"),
              icon: "chevron.left",
              action: "close",
            },
            ...(saveState?.status === "error"
              ? [
                  {
                    id: "save-status",
                    kind: "Text" as const,
                    text: `${t("settings.saveError")}: ${saveState.message}`,
                  },
                ]
              : []),
            {
              id: "system-settings",
              kind: "SettingsGroup",
              children: [
                {
                  id: "execution-mode",
                  kind: "Selector",
                  label: t("settings.executionMode"),
                  text: t(
                    settings.system.executionMode === "text"
                      ? "settings.chatModeDesc"
                      : "settings.agentModeDesc",
                  ),
                  value: settings.system.executionMode === "text" ? "text" : "tools",
                  action: "execution-mode",
                  options: [
                    { value: "text", label: t("settings.chatMode") },
                    { value: "tools", label: t("settings.agentMode") },
                  ],
                },
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
            },
            ...appearance.nodes,
            ...fonts.nodes,
          ] satisfies PresentationNode[]
        ).map(withNativeSettingsIcons),
      }}
      handlers={handlers}
      onError={setFailure}
    />
  );
}
