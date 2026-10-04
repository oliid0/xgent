import { VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState } from "react";
import { useLocale } from "../../i18n";
import { updateCustomSettings } from "../../lib/settings";
import {
  buildFontFamilySelectOptions,
  FONT_FAMILY_CUSTOM_SELECT_VALUE,
  FONT_FAMILY_DEFAULT_SELECT_VALUE,
  type FontFamilySettings,
  fromFontFamilySelectValue,
  normalizeFontFamily,
  toFontFamilySelectValue,
} from "../../lib/system/fontFamily";
import { AppearanceSettingsSection } from "./AppearanceSettingsSection";
import { SettingsRow, SettingsRowGroup } from "./shared";
import type { SettingsSectionProps } from "./types";

/** Android and the native Apple forms persist the same mobile appearance fields. */
export function MobileAppearanceSettings({ settings, setSettings }: SettingsSectionProps) {
  const { t } = useLocale();
  const [custom, setCustom] = useState<Partial<Record<keyof FontFamilySettings, boolean>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<keyof FontFamilySettings, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof FontFamilySettings, boolean>>>({});
  const families = buildFontFamilySelectOptions();
  const fields = [
    ["interfaceFontFamily", "settings.interfaceFontFamily"],
    ["chatFontFamily", "settings.chatFontFamily"],
    ["codeFontFamily", "settings.codeFontFamily"],
  ] as const;

  function commit(key: keyof FontFamilySettings) {
    const draft = drafts[key] ?? settings.customSettings[key];
    const normalized = normalizeFontFamily(draft);
    if (draft.trim() && !normalized) {
      setErrors((previous) => ({ ...previous, [key]: true }));
      return;
    }
    setErrors((previous) => ({ ...previous, [key]: false }));
    setDrafts((previous) => ({ ...previous, [key]: normalized }));
    setSettings((previous) => updateCustomSettings(previous, { [key]: normalized }));
  }

  return (
    <VStack width="100%" gap={4}>
      <AppearanceSettingsSection settings={settings} setSettings={setSettings} />
      <SettingsRowGroup title={t("settings.fontFamily")}>
        {fields.map(([key, label]) => {
          const selected = toFontFamilySelectValue(
            settings.customSettings[key],
            families,
            custom[key],
          );
          return (
            <VStack key={key} width="100%" gap={2}>
              <SettingsRow label={t(label)}>
                <Selector
                  label={t(label)}
                  isLabelHidden
                  value={selected}
                  width="min(100%, var(--xgent-settings-control-width))"
                  hasSearch
                  options={[
                    {
                      value: FONT_FAMILY_DEFAULT_SELECT_VALUE,
                      label: t("settings.fontFamilyDefault"),
                    },
                    {
                      value: FONT_FAMILY_CUSTOM_SELECT_VALUE,
                      label: t("settings.fontFamilyCustom"),
                    },
                    ...families,
                  ]}
                  onChange={(value) => {
                    setCustom((previous) => ({
                      ...previous,
                      [key]: value === FONT_FAMILY_CUSTOM_SELECT_VALUE,
                    }));
                    setErrors((previous) => ({ ...previous, [key]: false }));
                    if (value === FONT_FAMILY_CUSTOM_SELECT_VALUE) {
                      setDrafts((previous) => ({
                        ...previous,
                        [key]: settings.customSettings[key],
                      }));
                    } else {
                      setSettings((previous) =>
                        updateCustomSettings(previous, { [key]: fromFontFamilySelectValue(value) }),
                      );
                    }
                  }}
                />
              </SettingsRow>
              {selected === FONT_FAMILY_CUSTOM_SELECT_VALUE ? (
                <TextInput
                  label={t("settings.fontFamilyCustom")}
                  placeholder={t("settings.fontFamilyPlaceholder")}
                  value={drafts[key] ?? settings.customSettings[key]}
                  width="100%"
                  onChange={(value) => setDrafts((previous) => ({ ...previous, [key]: value }))}
                  onBlur={() => commit(key)}
                  onEnter={() => commit(key)}
                  status={
                    errors[key]
                      ? { type: "error", message: t("settings.fontFamilyInvalid") }
                      : undefined
                  }
                />
              ) : null}
            </VStack>
          );
        })}
      </SettingsRowGroup>
      <SettingsRowGroup title={t("settings.fontSize")}>
        {(
          [
            ["sidebar", "settings.fontSizeSidebar"],
            ["chat", "settings.fontSizeChat"],
            ["workspaceTools", "settings.fontSizeWorkspaceTools"],
          ] as const
        ).map(([zone, label]) => (
          <SettingsRow key={zone} label={t(label)}>
            <Selector
              label={t(label)}
              isLabelHidden
              value={String(settings.customSettings.fontScale[zone])}
              width="min(100%, var(--xgent-settings-control-width))"
              options={[...new Set([0.9, 1, 1.1, 1.2, settings.customSettings.fontScale[zone]])]
                .sort((a, b) => a - b)
                .map((value) => ({ value: String(value), label: `${Math.round(value * 100)}%` }))}
              onChange={(value) =>
                setSettings((previous) =>
                  updateCustomSettings(previous, {
                    fontScale: { ...previous.customSettings.fontScale, [zone]: Number(value) },
                  }),
                )
              }
            />
          </SettingsRow>
        ))}
      </SettingsRowGroup>
    </VStack>
  );
}
