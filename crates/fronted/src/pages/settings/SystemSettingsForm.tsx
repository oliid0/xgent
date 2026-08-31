import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { isBrowserRuntime } from "@xgent/runtime";
import { useEffect, useMemo, useState } from "react";
import { SUPPORTED_LOCALES, useLocale } from "../../i18n";
import { inferRuntimePlatform } from "../../lib/runtimePlatform";
import {
  CLOSE_WINDOW_BEHAVIOR_OPTIONS,
  type FontScaleSettings,
  isValidSystemProxyHost,
  type SystemProxyConfig,
  type SystemProxyType,
  type TerminalShellPreference,
  THEME_OPTIONS,
  type Theme,
  updateCustomSettings,
  updateSystem,
} from "../../lib/settings";
import {
  buildFontFamilySelectOptions,
  FONT_FAMILY_CUSTOM_SELECT_VALUE,
  FONT_FAMILY_DEFAULT_SELECT_VALUE,
  type FontFamilySettings,
  fromFontFamilySelectValue,
  listLocalFontFamilies,
  normalizeFontFamily,
  toFontFamilySelectValue,
} from "../../lib/system/fontFamily";
import { tauriTerminalClient } from "../../lib/terminal/tauriTerminalClient";
import type { TerminalShellOption } from "../../lib/terminal/types";
import { useTrayPrefs, writeTrayPrefs } from "../../lib/tray/trayPrefs";
import { SecretTextInput } from "./SecretTextInput";
import { AgentActivationSwitch, SettingsRow, SettingsRowGroup } from "./shared";
import type { SettingsSectionProps } from "./types";

const FONT_SCALE_OPTIONS = [0.9, 1, 1.1, 1.2] as const;
const CONTROL_WIDTH = "min(100%, var(--xgent-settings-control-width))";

type SystemSettingsFormProps = SettingsSectionProps & {
  compact?: boolean;
};

export function SystemSettingsForm({ settings, setSettings }: SystemSettingsFormProps) {
  const { t } = useLocale();
  const browser = isBrowserRuntime();
  const trayPrefs = useTrayPrefs();
  const isMacPlatform = useMemo(() => inferRuntimePlatform() === "macos", []);
  const [terminalShellOptions, setTerminalShellOptions] = useState<TerminalShellOption[]>([]);
  const [localFontFamilies, setLocalFontFamilies] = useState<string[]>([]);
  const [customFontModes, setCustomFontModes] = useState<
    Partial<Record<keyof FontFamilySettings, boolean>>
  >({});
  const [customFontDrafts, setCustomFontDrafts] = useState<
    Partial<Record<keyof FontFamilySettings, string>>
  >({});
  const [proxyHostDraft, setProxyHostDraft] = useState<string | null>(null);
  const [proxyPortDraft, setProxyPortDraft] = useState<string | null>(null);
  const [proxyUsernameDraft, setProxyUsernameDraft] = useState<string | null>(null);
  const [proxyPasswordDraft, setProxyPasswordDraft] = useState<string | null>(null);

  const terminalShellSelectValue =
    settings.system.terminalShell === "auto" ||
    terminalShellOptions.some((option) => option.id === settings.system.terminalShell)
      ? settings.system.terminalShell
      : "auto";
  const systemProxy = settings.system.systemProxy;
  const effectiveProxyHost = (proxyHostDraft ?? systemProxy.host).trim();
  const effectiveProxyPort =
    proxyPortDraft !== null ? Number.parseInt(proxyPortDraft, 10) : systemProxy.port;
  const proxyConfigValid =
    isValidSystemProxyHost(effectiveProxyHost) &&
    Number.isInteger(effectiveProxyPort) &&
    effectiveProxyPort >= 1 &&
    effectiveProxyPort <= 65535;
  const systemProxyInvalid = systemProxy.enabled && !proxyConfigValid;
  const proxyToggleDisabled = !systemProxy.enabled && !proxyConfigValid;
  const fontScale = settings.customSettings.fontScale;
  const fontFamilyOptions = useMemo(
    () => buildFontFamilySelectOptions(localFontFamilies),
    [localFontFamilies],
  );
  const fontFamilyFields: Array<{ key: keyof FontFamilySettings; label: string }> = [
    { key: "interfaceFontFamily", label: t("settings.interfaceFontFamily") },
    { key: "chatFontFamily", label: t("settings.chatFontFamily") },
    { key: "codeFontFamily", label: t("settings.codeFontFamily") },
  ];
  const fontScaleZones: Array<{ key: keyof FontScaleSettings; label: string }> = [
    { key: "sidebar", label: t("settings.fontSizeSidebar") },
    { key: "chat", label: t("settings.fontSizeChat") },
    { key: "workspaceTools", label: t("settings.fontSizeWorkspaceTools") },
  ];

  useEffect(() => {
    let cancelled = false;
    void listLocalFontFamilies().then((families) => {
      if (!cancelled) setLocalFontFamilies(families);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void tauriTerminalClient
      .shellOptions()
      .then((response) => {
        if (!cancelled) setTerminalShellOptions(response.options);
      })
      .catch(() => {
        if (!cancelled) setTerminalShellOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function getThemeLabel(theme: Theme) {
    if (theme === "light") return t("settings.light");
    if (theme === "dark") return t("settings.dark");
    return t("settings.auto");
  }

  function getFontScaleLabel(value: number) {
    if (value === 0.9) return t("settings.fontSizeSmall");
    if (value === 1.1) return t("settings.fontSizeLarge");
    if (value === 1.2) return t("settings.fontSizeXLarge");
    return t("settings.fontSizeStandard");
  }

  function setZoneFontScale(zone: keyof FontScaleSettings, value: number) {
    setSettings((prev) =>
      updateCustomSettings(prev, {
        fontScale: { ...prev.customSettings.fontScale, [zone]: value },
      }),
    );
  }

  function setFontFamily(key: keyof FontFamilySettings, value: string) {
    setSettings((prev) => updateCustomSettings(prev, { [key]: normalizeFontFamily(value) }));
  }

  function handleFontFamilySelect(key: keyof FontFamilySettings, value: string) {
    if (value === FONT_FAMILY_CUSTOM_SELECT_VALUE) {
      setCustomFontModes((current) => ({ ...current, [key]: true }));
      setCustomFontDrafts((current) => ({
        ...current,
        [key]: current[key] ?? settings.customSettings[key],
      }));
      return;
    }
    setCustomFontModes((current) => ({ ...current, [key]: false }));
    setFontFamily(key, fromFontFamilySelectValue(value));
  }

  function commitCustomFontFamily(key: keyof FontFamilySettings) {
    const value = normalizeFontFamily(customFontDrafts[key] ?? settings.customSettings[key]);
    setCustomFontDrafts((current) => ({ ...current, [key]: value }));
    setFontFamily(key, value);
  }

  function patchSystemProxy(patch: Partial<SystemProxyConfig>) {
    setSettings((prev) =>
      updateSystem(prev, {
        systemProxy: { ...prev.system.systemProxy, ...patch },
      }),
    );
  }

  function commitProxyHostDraft() {
    if (proxyHostDraft === null) return;
    patchSystemProxy({ host: proxyHostDraft.trim() });
    setProxyHostDraft(null);
  }

  function commitProxyPortDraft() {
    if (proxyPortDraft === null) return;
    const parsed = Number.parseInt(proxyPortDraft, 10);
    patchSystemProxy({ port: Number.isNaN(parsed) ? 0 : parsed });
    setProxyPortDraft(null);
  }

  function commitProxyUsernameDraft() {
    if (proxyUsernameDraft === null) return;
    patchSystemProxy({ username: proxyUsernameDraft.trim() });
    setProxyUsernameDraft(null);
  }

  function commitProxyPasswordDraft() {
    if (proxyPasswordDraft === null) return;
    patchSystemProxy({ password: proxyPasswordDraft });
    setProxyPasswordDraft(null);
  }

  const fontSelectorOptions = [
    { value: FONT_FAMILY_DEFAULT_SELECT_VALUE, label: t("settings.fontFamilyDefault") },
    { value: FONT_FAMILY_CUSTOM_SELECT_VALUE, label: t("settings.fontFamilyCustom") },
    { type: "divider" as const },
    ...fontFamilyOptions.map((option) => ({ value: option.value, label: option.label })),
  ];

  return (
    <VStack width="100%" gap={2}>
      <SettingsRowGroup title={t("settings.executionMode")} hideTitle>
        <SettingsRow
          label={t("settings.executionMode")}
          description={
            settings.system.executionMode === "text"
              ? t("settings.chatModeDesc")
              : t("settings.agentModeDesc")
          }
        >
          <Selector
            label={t("settings.executionMode")}
            isLabelHidden
            value={settings.system.executionMode === "text" ? "text" : "tools"}
            width={CONTROL_WIDTH}
            options={[
              { value: "text", label: t("settings.chatMode") },
              { value: "tools", label: t("settings.agentMode") },
            ]}
            onChange={(executionMode) =>
              setSettings((prev) =>
                updateSystem(prev, {
                  executionMode: executionMode === "text" ? "text" : "tools",
                }),
              )
            }
          />
        </SettingsRow>
      </SettingsRowGroup>

      {terminalShellOptions.length > 0 ? (
        <SettingsRowGroup title={t("settings.terminalShell")} hideTitle>
          <SettingsRow
            label={t("settings.terminalShell")}
            description={t("settings.terminalShellDesc")}
          >
            <Selector
              label={t("settings.terminalShell")}
              isLabelHidden
              value={terminalShellSelectValue}
              width={CONTROL_WIDTH}
              options={[
                { value: "auto", label: t("settings.terminalShellAuto") },
                ...terminalShellOptions.map((option) => ({
                  value: option.id,
                  label: option.label,
                })),
              ]}
              onChange={(value) =>
                setSettings((prev) =>
                  updateSystem(prev, { terminalShell: value as TerminalShellPreference }),
                )
              }
            />
          </SettingsRow>
        </SettingsRowGroup>
      ) : null}

      <SettingsRowGroup title={t("settings.appearance")} hideTitle>
        <SettingsRow label={t("settings.appearance")}>
          <Selector
            label={t("settings.appearance")}
            isLabelHidden
            value={settings.theme}
            width={CONTROL_WIDTH}
            options={THEME_OPTIONS.map((theme) => ({
              value: theme,
              label: getThemeLabel(theme),
            }))}
            onChange={(theme) => setSettings((prev) => ({ ...prev, theme: theme as Theme }))}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.language")}>
          <Selector
            label={t("settings.language")}
            isLabelHidden
            value={settings.locale}
            width={CONTROL_WIDTH}
            options={SUPPORTED_LOCALES.map((locale) => ({
              value: locale,
              label:
                locale === "system"
                  ? t("settings.auto")
                  : locale === "zh-CN"
                    ? t("settings.chinese")
                    : locale === "en-US"
                      ? t("settings.english")
                      : locale,
            }))}
            onChange={(locale) =>
              setSettings((prev) => ({ ...prev, locale: locale as typeof prev.locale }))
            }
          />
        </SettingsRow>
      </SettingsRowGroup>

      <SettingsRowGroup title={t("settings.fontFamily")} hideTitle>
        <FormLayout direction="vertical">
          {fontFamilyFields.map(({ key, label }) => {
            const currentValue = settings.customSettings[key];
            const selectValue = toFontFamilySelectValue(
              currentValue,
              fontFamilyOptions,
              customFontModes[key] === true,
            );
            const isCustom = selectValue === FONT_FAMILY_CUSTOM_SELECT_VALUE;
            return (
              <VStack key={key} width="100%" gap={2}>
                <Selector
                  label={label}
                  value={selectValue}
                  hasSearch={fontFamilyOptions.length > 12}
                  width="100%"
                  options={fontSelectorOptions}
                  onChange={(value) => handleFontFamilySelect(key, value)}
                />
                {isCustom ? (
                  <TextInput
                    label={t("settings.fontFamilyCustom")}
                    value={customFontDrafts[key] ?? currentValue}
                    placeholder={t("settings.fontFamilyPlaceholder")}
                    width="100%"
                    onChange={(value) =>
                      setCustomFontDrafts((current) => ({ ...current, [key]: value }))
                    }
                    onBlur={() => commitCustomFontFamily(key)}
                    onEnter={() => commitCustomFontFamily(key)}
                  />
                ) : null}
              </VStack>
            );
          })}
        </FormLayout>
      </SettingsRowGroup>

      <SettingsRowGroup title={t("settings.fontSize")} hideTitle>
        {fontScaleZones.map((zone) => (
          <SettingsRow key={zone.key} label={zone.label}>
            <Selector
              label={zone.label}
              isLabelHidden
              value={String(fontScale[zone.key])}
              width={CONTROL_WIDTH}
              options={FONT_SCALE_OPTIONS.map((value) => ({
                value: String(value),
                label: getFontScaleLabel(value),
              }))}
              onChange={(value) => setZoneFontScale(zone.key, Number(value))}
            />
          </SettingsRow>
        ))}
      </SettingsRowGroup>

      <SettingsRowGroup title={t("settings.systemProxy")} hideTitle>
        <SettingsRow
          label={t("settings.systemProxy")}
          description={
            systemProxyInvalid ? t("settings.systemProxyInvalid") : t("settings.systemProxyDesc")
          }
        >
          <AgentActivationSwitch
            checked={systemProxy.enabled}
            title={t("settings.systemProxyEnable")}
            disabled={proxyToggleDisabled}
            onToggle={() => patchSystemProxy({ enabled: !systemProxy.enabled })}
          />
        </SettingsRow>
        {systemProxy.enabled ? (
          <Section variant="muted" padding={4} width="100%">
            <FormLayout direction="vertical">
              <Selector
                label={t("settings.systemProxyType")}
                value={systemProxy.type}
                options={[
                  { value: "http", label: "HTTP" },
                  { value: "socks5", label: "SOCKS5" },
                ]}
                onChange={(value) => patchSystemProxy({ type: value as SystemProxyType })}
              />
              <TextInput
                label={t("settings.systemProxyHost")}
                value={proxyHostDraft ?? systemProxy.host}
                placeholder="127.0.0.1"
                status={
                  effectiveProxyHost && !isValidSystemProxyHost(effectiveProxyHost)
                    ? { type: "error", message: t("settings.systemProxyInvalid") }
                    : undefined
                }
                statusVariant="detached"
                onChange={setProxyHostDraft}
                onBlur={commitProxyHostDraft}
                onEnter={commitProxyHostDraft}
              />
              <TextInput
                label={t("settings.systemProxyPort")}
                value={proxyPortDraft ?? (systemProxy.port > 0 ? String(systemProxy.port) : "")}
                placeholder={systemProxy.type === "socks5" ? "1080" : "7890"}
                status={
                  effectiveProxyPort < 1 || effectiveProxyPort > 65535
                    ? { type: "error", message: t("settings.systemProxyInvalid") }
                    : undefined
                }
                statusVariant="detached"
                onChange={setProxyPortDraft}
                onBlur={commitProxyPortDraft}
                onEnter={commitProxyPortDraft}
              />
              <TextInput
                label={t("settings.systemProxyUsername")}
                value={proxyUsernameDraft ?? systemProxy.username}
                onChange={setProxyUsernameDraft}
                onBlur={commitProxyUsernameDraft}
                onEnter={commitProxyUsernameDraft}
              />
              <SecretTextInput
                label={t("settings.systemProxyPassword")}
                value={proxyPasswordDraft ?? systemProxy.password}
                isDisabled={browser}
                disabledMessage={browser ? t("settings.desktopOnly") : undefined}
                description={
                  systemProxy.passwordConfigured &&
                  !(proxyPasswordDraft ?? systemProxy.password).trim()
                    ? t("settings.systemProxyPasswordConfigured")
                    : undefined
                }
                onChange={setProxyPasswordDraft}
                onBlur={commitProxyPasswordDraft}
                onEnter={commitProxyPasswordDraft}
              />
              {systemProxy.passwordConfigured &&
              !(proxyPasswordDraft ?? systemProxy.password).trim() ? (
                <Button
                  label={t("settings.systemProxyPasswordClear")}
                  variant="secondary"
                  size="sm"
                  isDisabled={browser}
                  onClick={() => {
                    setProxyPasswordDraft(null);
                    patchSystemProxy({ password: "", passwordConfigured: false });
                  }}
                />
              ) : null}
            </FormLayout>
          </Section>
        ) : null}
      </SettingsRowGroup>

      <SettingsRowGroup title={t("settings.closeWindowBehavior")} hideTitle>
        <SettingsRow
          label={t("settings.closeWindowBehavior")}
          description={
            settings.closeWindowBehavior === "minimize"
              ? t("settings.closeWindowMinimizeDesc")
              : t("settings.closeWindowExitDesc")
          }
        >
          <Selector
            label={t("settings.closeWindowBehavior")}
            isLabelHidden
            value={settings.closeWindowBehavior}
            width={CONTROL_WIDTH}
            options={CLOSE_WINDOW_BEHAVIOR_OPTIONS.map((behavior) => ({
              value: behavior,
              label:
                behavior === "minimize"
                  ? t("settings.closeWindowMinimize")
                  : t("settings.closeWindowExit"),
            }))}
            onChange={(closeWindowBehavior) =>
              setSettings((prev) => ({
                ...prev,
                closeWindowBehavior: closeWindowBehavior as typeof prev.closeWindowBehavior,
              }))
            }
          />
        </SettingsRow>
      </SettingsRowGroup>

      {!browser ? (
        <SettingsRowGroup title={t("settings.trayTitle")} hideTitle>
          <SettingsRow
            label={t("settings.trayShowTitles")}
            description={t("settings.trayShowTitlesDesc")}
          >
            <AgentActivationSwitch
              checked={trayPrefs.showConversationTitles}
              title={t("settings.trayShowTitles")}
              onToggle={() =>
                writeTrayPrefs({ showConversationTitles: !trayPrefs.showConversationTitles })
              }
            />
          </SettingsRow>
          {isMacPlatform ? (
            <SettingsRow
              label={t("settings.trayRunningBadge")}
              description={t("settings.trayRunningBadgeDesc")}
            >
              <AgentActivationSwitch
                checked={trayPrefs.showRunningBadge}
                title={t("settings.trayRunningBadge")}
                onToggle={() => writeTrayPrefs({ showRunningBadge: !trayPrefs.showRunningBadge })}
              />
            </SettingsRow>
          ) : null}
        </SettingsRowGroup>
      ) : null}
    </VStack>
  );
}
