import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { useLocale } from "../../i18n";
import { updateCustomSettings } from "../../lib/settings";
import {
  type AppearanceSettings,
  normalizeAppearance,
  UI_THEME_PRESETS,
} from "../../lib/settings/appearance";
import { AgentActivationSwitch, SettingsRow, SettingsRowGroup } from "./shared";
import type { SettingsSectionProps } from "./types";

export function AppearanceSettingsSection({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const appearance = settings.customSettings.appearance;
  const update = (patch: Partial<AppearanceSettings>) =>
    setSettings((previous) =>
      updateCustomSettings(previous, {
        appearance: { ...previous.customSettings.appearance, ...patch },
      }),
    );
  const colors = ["accentLight", "accentDark", "sidebarLight", "sidebarDark"] as const;
  return (
    <SettingsRowGroup title={t("settings.ui.title")}>
      <SettingsRow
        label={t("settings.ui.showThinking")}
        description={t("settings.ui.showThinkingDesc")}
      >
        <AgentActivationSwitch
          title={t("settings.ui.showThinking")}
          checked={appearance.showThinking}
          onToggle={() => update({ showThinking: !appearance.showThinking })}
        />
      </SettingsRow>
      <SettingsRow label={t("settings.ui.preset")}>
        <Selector
          label={t("settings.ui.preset")}
          isLabelHidden
          value={appearance.preset}
          options={UI_THEME_PRESETS.map((value) => ({
            value,
            label:
              value === "current"
                ? t("settings.ui.current")
                : value === "stone"
                  ? "Stone"
                  : "Matcha",
          }))}
          onChange={(preset) =>
            update({ preset: preset as AppearanceSettings["preset"], customized: false })
          }
        />
      </SettingsRow>
      <SettingsRow label={t("settings.ui.customize")} description={t("settings.ui.customizeDesc")}>
        <AgentActivationSwitch
          title={t("settings.ui.customize")}
          checked={appearance.customized}
          onToggle={() => update({ customized: !appearance.customized })}
        />
      </SettingsRow>
      {appearance.customized ? (
        <>
          {colors.map((key) => (
            <SettingsRow
              key={key}
              label={t(`settings.ui.${key}`)}
              description={
                key.startsWith("accent") ? t("settings.ui.accentDescription") : undefined
              }
            >
              <input
                type="color"
                aria-label={t(`settings.ui.${key}`)}
                value={appearance[key]}
                onChange={(event) => update({ [key]: event.target.value })}
              />
            </SettingsRow>
          ))}
          <SettingsRow label={t("settings.ui.radius")}>
            <Selector
              label={t("settings.ui.radius")}
              isLabelHidden
              value={String(appearance.radius)}
              options={[...new Set([0, 8, 12, 16, 24, 32, appearance.radius])]
                .sort((a, b) => a - b)
                .map((value) => ({ value: String(value), label: `${value}px` }))}
              onChange={(value) => update({ radius: Number(value) })}
            />
          </SettingsRow>
          <Button
            label={t("settings.ui.reset")}
            variant="secondary"
            onClick={() => update({ ...normalizeAppearance({}), preset: appearance.preset })}
          />
        </>
      ) : null}
    </SettingsRowGroup>
  );
}
