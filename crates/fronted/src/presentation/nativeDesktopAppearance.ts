import { CLOSE_WINDOW_BEHAVIOR_OPTIONS, updateCustomSettings } from "../lib/settings";
import { normalizeAppearance, UI_THEME_PRESETS } from "../lib/settings/appearance";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";

/** Reachable desktop controls, using AppearanceSettingsSection's persisted model. */
export function createNativeDesktopAppearance(
  { settings, setSettings }: SettingsSectionProps,
  t: (key: string) => string,
) {
  const c = presentationControls();
  const appearance = settings.customSettings.appearance;
  const sizeLabels = new Map([
    [0.9, "settings.fontSizeSmall"],
    [1, "settings.fontSizeStandard"],
    [1.1, "settings.fontSizeLarge"],
    [1.2, "settings.fontSizeXLarge"],
  ]);
  const update = (patch: Partial<typeof appearance>) =>
    setSettings((previous) =>
      updateCustomSettings(previous, {
        appearance: { ...previous.customSettings.appearance, ...patch },
      }),
    );
  const nodes = [
    c.group("desktop-appearance", t("settings.ui.title"), [
      {
        ...c.toggle(
          "thinking",
          t("settings.ui.showThinking"),
          appearance.showThinking,
          (showThinking) => update({ showThinking }),
        ),
        text: t("settings.ui.showThinkingDesc"),
      },
      c.select(
        "appearance-preset",
        t("settings.ui.preset"),
        appearance.preset,
        UI_THEME_PRESETS.map((value) => ({
          value,
          label:
            value === "current" ? t("settings.ui.current") : value === "stone" ? "Stone" : "Matcha",
        })),
        (preset) => update({ preset: preset as typeof appearance.preset, customized: false }),
      ),
      {
        ...c.toggle(
          "appearance-customized",
          t("settings.ui.customize"),
          appearance.customized,
          (customized) => update({ customized }),
        ),
        text: t("settings.ui.customizeDesc"),
      },
      ...(appearance.customized
        ? [
            ...(["accentLight", "accentDark", "sidebarLight", "sidebarDark"] as const).map(
              (key) => ({
                ...c.color(
                  `appearance-color:${key}`,
                  t(`settings.ui.${key}`),
                  appearance[key],
                  (value) => update({ [key]: value }),
                ),
                text: key.startsWith("accent") ? t("settings.ui.accentDescription") : undefined,
                accessibilityHint: t("settings.ui.colorFormat"),
              }),
            ),
            c.select(
              "appearance-radius",
              t("settings.ui.radius"),
              String(appearance.radius),
              [...new Set([0, 8, 12, 16, 24, 32, appearance.radius])]
                .sort((a, b) => a - b)
                .map((value) => ({ value: String(value), label: `${value}px` })),
              (value) => update({ radius: Number(value) }),
            ),
            c.action("appearance-reset", t("settings.ui.reset"), () =>
              update({ ...normalizeAppearance({}), preset: appearance.preset }),
            ),
          ]
        : []),
    ]),
    c.group(
      "desktop-font-size",
      t("settings.fontSize"),
      (["sidebar", "chat", "workspaceTools"] as const).map((zone) => {
        const current = settings.customSettings.fontScale[zone];
        return c.select(
          `font-scale:${zone}`,
          t(
            zone === "sidebar"
              ? "settings.fontSizeSidebar"
              : zone === "chat"
                ? "settings.fontSizeChat"
                : "settings.fontSizeWorkspaceTools",
          ),
          String(current),
          [...new Set([0.9, 1, 1.1, 1.2, current])]
            .sort((a, b) => a - b)
            .map((value) => {
              const label = sizeLabels.get(value);
              return {
                value: String(value),
                label: label ? t(label) : `${Math.round(value * 100)}%`,
              };
            }),
          (value) =>
            setSettings((previous) =>
              updateCustomSettings(previous, {
                fontScale: { ...previous.customSettings.fontScale, [zone]: Number(value) },
              }),
            ),
        );
      }),
    ),
    c.group("desktop-window", t("settings.closeWindowBehavior"), [
      c.select(
        "close-window-behavior",
        t("settings.closeWindowBehavior"),
        settings.closeWindowBehavior,
        CLOSE_WINDOW_BEHAVIOR_OPTIONS.map((value) => ({
          value,
          label: t(
            value === "minimize" ? "settings.closeWindowMinimize" : "settings.closeWindowExit",
          ),
        })),
        (value) =>
          setSettings((previous) => ({
            ...previous,
            closeWindowBehavior: value as typeof previous.closeWindowBehavior,
          })),
      ),
    ]),
  ];
  return { nodes, handlers: c.handlers };
}
