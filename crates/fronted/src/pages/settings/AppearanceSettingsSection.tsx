import { Button } from "@astryxdesign/core/Button";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack } from "@astryxdesign/core/Stack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEffect, useState } from "react";
import { useLocale } from "../../i18n";
import { updateCustomSettings } from "../../lib/settings";
import {
  type AppearanceSettings,
  normalizeAppearance,
  UI_THEME_PRESETS,
} from "../../lib/settings/appearance";
import { AgentActivationSwitch, SettingsRow, SettingsRowGroup } from "./shared";
import type { SettingsSectionProps } from "./types";

function AppearanceColorInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const valid = /^#[\da-f]{6}$/i.test(draft);
  return (
    <HStack gap={2} vAlign="center" style={{ minWidth: 0, maxWidth: "100%" }}>
      <input
        type="color"
        aria-label={props.label}
        value={props.value}
        onChange={(event) => {
          setDraft(event.target.value);
          props.onChange(event.target.value);
        }}
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          cursor: "pointer",
          borderRadius: "var(--radius-element)",
        }}
      />
      <TextInput
        label={`${props.label} · HEX`}
        isLabelHidden
        width={120}
        value={draft}
        onChange={(value) => {
          setDraft(value);
          if (/^#[\da-f]{6}$/i.test(value)) props.onChange(value.toLowerCase());
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(props.value);
          }
        }}
        status={valid ? undefined : { type: "error", message: t("settings.ui.colorFormat") }}
        statusVariant="tooltip"
      />
    </HStack>
  );
}

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
              <AppearanceColorInput
                label={t(`settings.ui.${key}`)}
                value={appearance[key]}
                onChange={(value) => update({ [key]: value })}
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
