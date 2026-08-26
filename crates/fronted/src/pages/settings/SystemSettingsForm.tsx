import { Button as CoreButton } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { isBrowserRuntime } from "@xagent/runtime";
import {
  Inline as AstryxInline,
  Paragraph as AstryxParagraph,
  View as AstryxView,
} from "@xagent/ui/components/ui/view";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Cpu,
  Globe,
  LogOut,
  MessageSquare,
  Minimize2,
  MonitorSmartphone,
  Moon,
  ScanText,
  Sun,
  Terminal,
  Wrench,
} from "../../components/icons";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { SUPPORTED_LOCALES, useLocale } from "../../i18n";
import { inferRuntimePlatform } from "../../lib/runtimePlatform";
import {
  CLOSE_WINDOW_BEHAVIOR_OPTIONS,
  type ExecutionMode,
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
import { AgentActivationSwitch, SettingsRow, SettingsRowGroup } from "./shared";
import type { SettingsSectionProps } from "./types";

const FONT_SCALE_OPTIONS = [0.9, 1, 1.1, 1.2] as const;

type SystemSettingsFormProps = SettingsSectionProps & {
  compact?: boolean;
};

function SettingsChoiceCard(props: {
  label: string;
  description?: string;
  icon: ReactNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <SelectableCard
      label={props.label}
      isSelected={props.isSelected}
      onChange={(isSelected) => {
        if (isSelected) props.onSelect();
      }}
      padding={3}
      variant="muted"
      width="100%"
      height="100%"
      className="settings-native-choice-card"
    >
      <HStack width="100%" gap={3} vAlign="start">
        <Center
          width="var(--size-element-md)"
          height="var(--size-element-md)"
          style={{
            flexShrink: 0,
            borderRadius: "var(--radius-element)",
            color: props.isSelected ? "var(--color-text-accent)" : "var(--color-icon-secondary)",
            backgroundColor: props.isSelected
              ? "var(--color-accent-muted)"
              : "var(--color-background-muted)",
          }}
        >
          {props.icon}
        </Center>
        <StackItem size="fill">
          <VStack gap={0.5}>
            <Text type="label" weight="semibold" wordBreak="break-word">
              {props.label}
            </Text>
            {props.description ? (
              <Text type="supporting" color="secondary" wordBreak="break-word">
                {props.description}
              </Text>
            ) : null}
          </VStack>
        </StackItem>
        {props.isSelected ? <Icon icon="check" size="sm" color="accent" /> : null}
      </HStack>
    </SelectableCard>
  );
}

export function SystemSettingsForm(props: SystemSettingsFormProps) {
  const { settings, setSettings, compact = false } = props;
  const { t } = useLocale();
  const browser = isBrowserRuntime();
  const trayPrefs = useTrayPrefs();
  const isMacPlatform = useMemo(() => inferRuntimePlatform() === "macos", []);
  const [terminalShellOptions, setTerminalShellOptions] = useState<TerminalShellOption[]>([]);
  const terminalShellSelectValue =
    settings.system.terminalShell === "auto" ||
    terminalShellOptions.some((option) => option.id === settings.system.terminalShell)
      ? settings.system.terminalShell
      : "auto";

  const executionMode = settings.system.executionMode;
  const appearanceIcon =
    settings.theme === "system" ? (
      <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
    ) : settings.theme === "dark" ? (
      <Moon className="h-4 w-4 text-muted-foreground" />
    ) : (
      <Sun className="h-4 w-4 text-muted-foreground" />
    );

  function getThemeLabel(theme: Theme) {
    if (theme === "light") return t("settings.light");
    if (theme === "dark") return t("settings.dark");
    return t("settings.auto");
  }

  function renderThemeIcon(theme: Theme) {
    if (theme === "light") return <Sun className="h-4.5 w-4.5" />;
    if (theme === "dark") return <Moon className="h-4.5 w-4.5" />;
    return <MonitorSmartphone className="h-4.5 w-4.5" />;
  }

  const fontScale = settings.customSettings.fontScale;
  const [localFontFamilies, setLocalFontFamilies] = useState<string[]>([]);
  const [customFontModes, setCustomFontModes] = useState<
    Partial<Record<keyof FontFamilySettings, boolean>>
  >({});
  const [customFontDrafts, setCustomFontDrafts] = useState<
    Partial<Record<keyof FontFamilySettings, string>>
  >({});
  const fontFamilyOptions = useMemo(
    () => buildFontFamilySelectOptions(localFontFamilies),
    [localFontFamilies],
  );
  const fontFamilyFields: Array<{ key: keyof FontFamilySettings; label: string }> = [
    { key: "interfaceFontFamily", label: t("settings.interfaceFontFamily") },
    { key: "chatFontFamily", label: t("settings.chatFontFamily") },
    { key: "codeFontFamily", label: t("settings.codeFontFamily") },
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
  const fontScaleZones: Array<{ key: keyof FontScaleSettings; label: string }> = [
    { key: "sidebar", label: t("settings.fontSizeSidebar") },
    { key: "chat", label: t("settings.fontSizeChat") },
    { key: "workspaceTools", label: t("settings.fontSizeWorkspaceTools") },
  ];

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

  const systemProxy = settings.system.systemProxy;
  // host/port/username/password 走"本地草稿 + blur 提交"：失焦才写入 settings，
  // 避免逐字符触发同步；且 WebUI 设置 state 持久前会脱敏密码，草稿避免输入即被清空。
  const [proxyHostDraft, setProxyHostDraft] = useState<string | null>(null);
  const [proxyPortDraft, setProxyPortDraft] = useState<string | null>(null);
  const [proxyUsernameDraft, setProxyUsernameDraft] = useState<string | null>(null);
  const [proxyPasswordDraft, setProxyPasswordDraft] = useState<string | null>(null);
  const [proxyDetailsOpen, setProxyDetailsOpen] = useState(
    () => settings.system.systemProxy.enabled,
  );
  // 护栏 A：host + port 有效才算配置可用（端口在启用时必填有效）。
  // 用"草稿优先"的生效值计算：blur 提交前开关若仍禁用，点击开关触发的 blur
  // 会先把按钮变回可用，但落在禁用按钮上的这次 click 已被浏览器吞掉，需点两次。
  const effectiveProxyHost = (proxyHostDraft ?? systemProxy.host).trim();
  const effectiveProxyPort =
    proxyPortDraft !== null ? Number.parseInt(proxyPortDraft, 10) : systemProxy.port;
  const proxyConfigValid =
    isValidSystemProxyHost(effectiveProxyHost) &&
    Number.isInteger(effectiveProxyPort) &&
    effectiveProxyPort >= 1 &&
    effectiveProxyPort <= 65535;
  const systemProxyInvalid = systemProxy.enabled && !proxyConfigValid;
  // 配置无效且当前未启用时禁止开启开关（护栏 A）；已启用时始终允许关闭。
  const proxyToggleDisabled = !systemProxy.enabled && !proxyConfigValid;

  function patchSystemProxy(patch: Partial<SystemProxyConfig>) {
    setSettings((prev) =>
      updateSystem(prev, {
        systemProxy: { ...prev.system.systemProxy, ...patch },
      }),
    );
  }

  function commitProxyHostDraft() {
    if (proxyHostDraft !== null) {
      patchSystemProxy({ host: proxyHostDraft.trim() });
      setProxyHostDraft(null);
    }
  }

  function commitProxyPortDraft() {
    if (proxyPortDraft !== null) {
      const parsed = Number.parseInt(proxyPortDraft, 10);
      patchSystemProxy({ port: Number.isNaN(parsed) ? 0 : parsed });
      setProxyPortDraft(null);
    }
  }

  function commitProxyUsernameDraft() {
    if (proxyUsernameDraft !== null) {
      patchSystemProxy({ username: proxyUsernameDraft.trim() });
      setProxyUsernameDraft(null);
    }
  }

  function commitProxyPasswordDraft() {
    if (proxyPasswordDraft !== null) {
      patchSystemProxy({ password: proxyPasswordDraft });
      setProxyPasswordDraft(null);
    }
  }

  if (!compact) {
    return (
      <AstryxView layout="block" direction="horizontal" className="settings-system-rows">
        <SettingsRowGroup title={t("settings.executionMode")}>
          <SettingsRow
            label={t("settings.executionMode")}
            description={
              executionMode === "text"
                ? t("settings.chatModeDesc")
                : executionMode === "tools"
                  ? t("settings.agentModeDesc")
                  : t("settings.agentDevModeDesc")
            }
          >
            <Select
              value={executionMode}
              onValueChange={(value) =>
                setSettings((prev) => updateSystem(prev, { executionMode: value as ExecutionMode }))
              }
            >
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{t("settings.chatMode")}</SelectItem>
                <SelectItem value="tools">{t("settings.agentMode")}</SelectItem>
                <SelectItem value="agent-dev">{t("settings.agentDevMode")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsRowGroup>

        {terminalShellOptions.length > 0 ? (
          <SettingsRowGroup title={t("settings.terminalShell")}>
            <SettingsRow
              label={t("settings.terminalShell")}
              description={t("settings.terminalShellDesc")}
            >
              <Select
                value={terminalShellSelectValue}
                onValueChange={(value) =>
                  setSettings((prev) =>
                    updateSystem(prev, { terminalShell: value as TerminalShellPreference }),
                  )
                }
              >
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("settings.terminalShellAuto")}</SelectItem>
                  {terminalShellOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsRowGroup>
        ) : null}

        <SettingsRowGroup title={t("settings.appearance")}>
          <SettingsRow label={t("settings.appearance")}>
            <Select
              value={settings.theme}
              onValueChange={(value) => setSettings((prev) => ({ ...prev, theme: value as Theme }))}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {getThemeLabel(theme)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow label={t("settings.language")}>
            <Select
              value={settings.locale}
              onValueChange={(locale) =>
                setSettings((prev) => ({
                  ...prev,
                  locale: locale as typeof prev.locale,
                }))
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LOCALES.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {locale === "zh-CN"
                      ? t("settings.chinese")
                      : locale === "en-US"
                        ? t("settings.english")
                        : locale}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
          {fontFamilyFields.map(({ key, label }) => {
            const currentValue = settings.customSettings[key];
            const selectValue = toFontFamilySelectValue(
              currentValue,
              fontFamilyOptions,
              customFontModes[key] === true,
            );
            const custom = selectValue === FONT_FAMILY_CUSTOM_SELECT_VALUE;
            return (
              <SettingsRow key={key} label={label}>
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex min-w-0 items-center gap-2"
                >
                  <Select
                    value={selectValue}
                    onValueChange={(value) => handleFontFamilySelect(key, value)}
                  >
                    <SelectTrigger className={custom ? "w-40" : "w-60"}>
                      <SelectValue>
                        {(value) => {
                          if (value === FONT_FAMILY_DEFAULT_SELECT_VALUE)
                            return t("settings.fontFamilyDefault");
                          if (value === FONT_FAMILY_CUSTOM_SELECT_VALUE)
                            return t("settings.fontFamilyCustom");
                          return (
                            fontFamilyOptions.find((option) => option.value === value)?.label ??
                            String(value ?? "")
                          );
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={FONT_FAMILY_DEFAULT_SELECT_VALUE}>
                        {t("settings.fontFamilyDefault")}
                      </SelectItem>
                      <SelectItem value={FONT_FAMILY_CUSTOM_SELECT_VALUE}>
                        {t("settings.fontFamilyCustom")}
                      </SelectItem>
                      {fontFamilyOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          style={{ fontFamily: option.value }}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {custom ? (
                    <Input
                      className="w-60"
                      value={customFontDrafts[key] ?? currentValue}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={t("settings.fontFamilyPlaceholder")}
                      onChange={(event) =>
                        setCustomFontDrafts((current) => ({
                          ...current,
                          [key]: event.currentTarget.value,
                        }))
                      }
                      onBlur={() => commitCustomFontFamily(key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  ) : null}
                </AstryxView>
              </SettingsRow>
            );
          })}
          {fontScaleZones.map((zone) => (
            <SettingsRow key={zone.key} label={zone.label}>
              <Select
                value={String(fontScale[zone.key])}
                onValueChange={(value) => setZoneFontScale(zone.key, Number(value))}
              >
                <SelectTrigger className="w-44">
                  <SelectValue>{getFontScaleLabel(fontScale[zone.key])}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FONT_SCALE_OPTIONS.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {getFontScaleLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          ))}
        </SettingsRowGroup>

        <SettingsRowGroup title={t("settings.systemProxy")}>
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
            <>
              <SettingsRow label={t("settings.systemProxyType")}>
                <Select
                  value={systemProxy.type}
                  onValueChange={(value) => patchSystemProxy({ type: value as SystemProxyType })}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="socks5">SOCKS5</SelectItem>
                  </SelectContent>
                </Select>
              </SettingsRow>
              <SettingsRow label={t("settings.systemProxyHost")}>
                <Input
                  value={proxyHostDraft ?? systemProxy.host}
                  placeholder="127.0.0.1"
                  className="w-64"
                  onChange={(event) => setProxyHostDraft(event.currentTarget.value)}
                  onBlur={commitProxyHostDraft}
                />
              </SettingsRow>
              <SettingsRow label={t("settings.systemProxyPort")}>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={proxyPortDraft ?? (systemProxy.port > 0 ? String(systemProxy.port) : "")}
                  placeholder={systemProxy.type === "socks5" ? "1080" : "7890"}
                  className="w-44"
                  onChange={(event) => setProxyPortDraft(event.currentTarget.value)}
                  onBlur={commitProxyPortDraft}
                />
              </SettingsRow>
              <SettingsRow label={t("settings.systemProxyUsername")}>
                <Input
                  value={proxyUsernameDraft ?? systemProxy.username}
                  className="w-64"
                  onChange={(event) => setProxyUsernameDraft(event.currentTarget.value)}
                  onBlur={commitProxyUsernameDraft}
                />
              </SettingsRow>
              <SettingsRow
                label={t("settings.systemProxyPassword")}
                description={
                  systemProxy.passwordConfigured &&
                  !(proxyPasswordDraft ?? systemProxy.password).trim()
                    ? t("settings.systemProxyPasswordConfigured")
                    : undefined
                }
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-center gap-2"
                >
                  <Input
                    type="password"
                    disabled={browser}
                    value={proxyPasswordDraft ?? systemProxy.password}
                    className="w-64"
                    onChange={(event) => setProxyPasswordDraft(event.currentTarget.value)}
                    onBlur={commitProxyPasswordDraft}
                  />
                  {systemProxy.passwordConfigured &&
                  !(proxyPasswordDraft ?? systemProxy.password).trim() ? (
                    <CoreButton
                      label={t("settings.systemProxyPasswordClear")}
                      variant="ghost"
                      size="sm"
                      isDisabled={browser}
                      onClick={() => {
                        setProxyPasswordDraft(null);
                        patchSystemProxy({ password: "", passwordConfigured: false });
                      }}
                    />
                  ) : null}
                </AstryxView>
              </SettingsRow>
            </>
          ) : null}
        </SettingsRowGroup>

        <SettingsRowGroup title={t("settings.closeWindowBehavior")}>
          <SettingsRow label={t("settings.closeWindowBehavior")}>
            <Select
              value={settings.closeWindowBehavior}
              onValueChange={(closeWindowBehavior) =>
                setSettings((prev) => ({
                  ...prev,
                  closeWindowBehavior:
                    closeWindowBehavior as (typeof CLOSE_WINDOW_BEHAVIOR_OPTIONS)[number],
                }))
              }
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLOSE_WINDOW_BEHAVIOR_OPTIONS.map((behavior) => (
                  <SelectItem key={behavior} value={behavior}>
                    {behavior === "minimize"
                      ? t("settings.closeWindowMinimize")
                      : t("settings.closeWindowExit")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsRowGroup>

        {!browser ? (
          <SettingsRowGroup title={t("settings.trayTitle")}>
            <SettingsRow
              label={t("settings.trayShowTitles")}
              description={t("settings.trayShowTitlesDesc")}
            >
              <AgentActivationSwitch
                checked={trayPrefs.showConversationTitles}
                title={t("settings.trayShowTitles")}
                onToggle={() =>
                  writeTrayPrefs({
                    showConversationTitles: !trayPrefs.showConversationTitles,
                  })
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
      </AstryxView>
    );
  }

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="settings-system-form space-y-6"
      data-compact={compact ? "true" : "false"}
    >
      <AstryxView
        layout="block"
        direction="horizontal"
        className="settings-execution-section space-y-3"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-group-heading flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <Terminal className="h-4 w-4 text-muted-foreground" />
          {t("settings.executionMode")}
        </AstryxView>

        <AstryxView
          layout="grid"
          direction="horizontal"
          className="settings-execution-grid grid grid-cols-1 gap-3 md:grid-cols-3"
        >
          {(
            [
              {
                value: "text",
                label: t("settings.chatMode"),
                description: t("settings.chatModeDesc"),
                icon: <MessageSquare />,
              },
              {
                value: "tools",
                label: t("settings.agentMode"),
                description: t("settings.agentModeDesc"),
                icon: <Wrench />,
              },
              {
                value: "agent-dev",
                label: t("settings.agentDevMode"),
                description: t("settings.agentDevModeDesc"),
                icon: <Cpu />,
              },
            ] satisfies Array<{
              value: ExecutionMode;
              label: string;
              description: string;
              icon: ReactNode;
            }>
          ).map((option) => (
            <SettingsChoiceCard
              key={option.value}
              label={option.label}
              description={option.description}
              icon={option.icon}
              isSelected={executionMode === option.value}
              onSelect={() =>
                setSettings((prev) => updateSystem(prev, { executionMode: option.value }))
              }
            />
          ))}
        </AstryxView>
      </AstryxView>

      <AstryxView
        layout="block"
        direction="horizontal"
        className="settings-system-divider border-t"
      />

      {terminalShellOptions.length > 0 ? (
        <AstryxView
          as="section"
          className="settings-terminal-card settings-system-card rounded-2xl border border-border/60 bg-card p-4"
        >
          <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-3">
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
            >
              <Terminal className="h-4 w-4" />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
              <AstryxView
                layout="block"
                direction="horizontal"
                className="text-sm font-medium text-foreground"
              >
                {t("settings.terminalShell")}
              </AstryxView>
              <AstryxParagraph className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("settings.terminalShellDesc")}
              </AstryxParagraph>
            </AstryxView>
            <Select
              value={terminalShellSelectValue}
              onValueChange={(value) =>
                setSettings((prev) =>
                  updateSystem(prev, { terminalShell: value as TerminalShellPreference }),
                )
              }
            >
              <SelectTrigger className="w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("settings.terminalShellAuto")}</SelectItem>
                {terminalShellOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AstryxView>
        </AstryxView>
      ) : null}

      <AstryxView
        layout="grid"
        direction="horizontal"
        className="settings-appearance-grid grid gap-4 md:grid-cols-2"
      >
        <AstryxView
          as="section"
          className="settings-system-card space-y-3 rounded-2xl border border-border/60 bg-card p-4"
        >
          <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-3">
            <AstryxView layout="block" direction="horizontal" className="space-y-1">
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex items-center gap-2 text-sm font-medium text-foreground"
              >
                {appearanceIcon}
                {t("settings.appearance")}
              </AstryxView>
            </AstryxView>
          </AstryxView>

          <AstryxView
            layout="grid"
            direction="horizontal"
            className="settings-theme-grid grid gap-2 sm:grid-cols-3"
          >
            {THEME_OPTIONS.map((theme) => {
              const selected = settings.theme === theme;
              return (
                <SettingsChoiceCard
                  key={theme}
                  label={getThemeLabel(theme)}
                  icon={renderThemeIcon(theme)}
                  isSelected={selected}
                  onSelect={() => setSettings((prev) => ({ ...prev, theme }))}
                />
              );
            })}
          </AstryxView>
        </AstryxView>

        <AstryxView
          as="section"
          className="settings-system-card space-y-3 rounded-2xl border border-border/60 bg-card p-4"
        >
          <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-3">
            <AstryxView layout="block" direction="horizontal" className="space-y-1">
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex items-center gap-2 text-sm font-medium text-foreground"
              >
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                {t("settings.language")}
              </AstryxView>
            </AstryxView>
          </AstryxView>

          <AstryxView
            layout="grid"
            direction="horizontal"
            className="settings-locale-grid grid grid-cols-2 gap-2"
          >
            {SUPPORTED_LOCALES.map((locale) => {
              const selected = settings.locale === locale;
              const localeLabel =
                locale === "zh-CN"
                  ? t("settings.chinese")
                  : locale === "en-US"
                    ? t("settings.english")
                    : locale;
              return (
                <SettingsChoiceCard
                  key={locale}
                  label={localeLabel}
                  description={locale}
                  icon={locale === "zh-CN" ? "🇨🇳" : "🇺🇸"}
                  isSelected={selected}
                  onSelect={() => setSettings((prev) => ({ ...prev, locale }))}
                />
              );
            })}
          </AstryxView>
        </AstryxView>
      </AstryxView>

      <AstryxView
        as="section"
        className="settings-proxy-card settings-system-card space-y-3 rounded-2xl border border-border/60 bg-card p-4"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center justify-between gap-2"
        >
          <StackItem size="fill">
            {compact ? (
              <VStack gap={0.5}>
                <CoreButton
                  label={t("settings.systemProxy")}
                  icon={<Icon icon={Globe} size="sm" color="secondary" />}
                  endContent={<Icon icon={ChevronDown} size="sm" color="secondary" />}
                  variant="ghost"
                  width="100%"
                  aria-expanded={proxyDetailsOpen}
                  onClick={() => setProxyDetailsOpen((open) => !open)}
                />
                {systemProxy.host ? (
                  <Text type="code" color="secondary" maxLines={1}>
                    {systemProxy.type}://{systemProxy.host}
                    {systemProxy.port > 0 ? `:${systemProxy.port}` : ""}
                  </Text>
                ) : null}
              </VStack>
            ) : (
              <HStack gap={2} vAlign="center">
                <Icon icon={Globe} size="sm" color="secondary" />
                <Text type="label" weight="medium">
                  {t("settings.systemProxy")}
                </Text>
              </HStack>
            )}
          </StackItem>
          <AgentActivationSwitch
            checked={systemProxy.enabled}
            title={t("settings.systemProxyEnable")}
            disabled={proxyToggleDisabled}
            onToggle={() => {
              const enabled = !systemProxy.enabled;
              patchSystemProxy({ enabled });
              if (compact && enabled) setProxyDetailsOpen(true);
            }}
          />
        </AstryxView>
        {!compact || proxyDetailsOpen ? (
          <AstryxView
            layout="block"
            direction="horizontal"
            className="settings-proxy-details space-y-3"
          >
            <AstryxParagraph className="text-xs text-muted-foreground">
              {t("settings.systemProxyDesc")}
            </AstryxParagraph>
            {systemProxyInvalid ? (
              <AstryxParagraph className="text-xs text-destructive">
                {t("settings.systemProxyInvalid")}
              </AstryxParagraph>
            ) : proxyToggleDisabled ? (
              <AstryxParagraph className="text-xs text-muted-foreground">
                {t("settings.systemProxyEnableHint")}
              </AstryxParagraph>
            ) : null}
            <AstryxView
              layout="grid"
              direction="horizontal"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:items-start"
            >
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-1.5 sm:col-span-2 lg:col-span-2"
              >
                <Label className="text-xs font-medium text-muted-foreground">
                  {t("settings.systemProxyType")}
                </Label>
                <Select
                  value={systemProxy.type}
                  onValueChange={(value) => patchSystemProxy({ type: value as SystemProxyType })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{systemProxy.type === "socks5" ? "SOCKS5" : "HTTP"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="socks5">SOCKS5</SelectItem>
                  </SelectContent>
                </Select>
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-1.5 lg:col-span-4"
              >
                <Label
                  htmlFor="system-proxy-host"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("settings.systemProxyHost")}
                </Label>
                <Input
                  id="system-proxy-host"
                  value={proxyHostDraft ?? systemProxy.host}
                  placeholder="127.0.0.1"
                  onChange={(event) => setProxyHostDraft(event.currentTarget.value)}
                  onBlur={commitProxyHostDraft}
                />
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-1.5 lg:col-span-2"
              >
                <Label
                  htmlFor="system-proxy-port"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("settings.systemProxyPort")}
                </Label>
                <Input
                  id="system-proxy-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={proxyPortDraft ?? (systemProxy.port > 0 ? String(systemProxy.port) : "")}
                  placeholder={systemProxy.type === "socks5" ? "1080" : "7890"}
                  onChange={(event) => setProxyPortDraft(event.currentTarget.value)}
                  onBlur={commitProxyPortDraft}
                />
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-1.5 lg:col-span-2"
              >
                <Label
                  htmlFor="system-proxy-username"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("settings.systemProxyUsername")}
                </Label>
                <Input
                  id="system-proxy-username"
                  value={proxyUsernameDraft ?? systemProxy.username}
                  onChange={(event) => setProxyUsernameDraft(event.currentTarget.value)}
                  onBlur={commitProxyUsernameDraft}
                />
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-1.5 lg:col-span-2"
              >
                <Label
                  htmlFor="system-proxy-password"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t("settings.systemProxyPassword")}
                </Label>
                <Input
                  id="system-proxy-password"
                  type="password"
                  disabled={browser}
                  value={proxyPasswordDraft ?? systemProxy.password}
                  onChange={(event) => setProxyPasswordDraft(event.currentTarget.value)}
                  onBlur={commitProxyPasswordDraft}
                />
                {systemProxy.passwordConfigured &&
                !(proxyPasswordDraft ?? systemProxy.password).trim() ? (
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex items-center gap-2 text-[11px] text-muted-foreground"
                  >
                    <AstryxInline>{t("settings.systemProxyPasswordConfigured")}</AstryxInline>
                    <CoreButton
                      label={t("settings.systemProxyPasswordClear")}
                      variant="ghost"
                      size="sm"
                      isDisabled={browser}
                      onClick={() => {
                        setProxyPasswordDraft(null);
                        patchSystemProxy({ password: "", passwordConfigured: false });
                      }}
                    />
                  </AstryxView>
                ) : null}
              </AstryxView>
            </AstryxView>
          </AstryxView>
        ) : null}
      </AstryxView>

      {!compact ? (
        <AstryxView
          as="section"
          className="settings-close-card settings-system-card space-y-3 rounded-2xl border border-border/60 bg-card p-4"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <Minimize2 className="h-4 w-4 text-muted-foreground" />
            {t("settings.closeWindowBehavior")}
          </AstryxView>

          <AstryxView layout="grid" direction="horizontal" className="grid gap-2 sm:grid-cols-2">
            {CLOSE_WINDOW_BEHAVIOR_OPTIONS.map((behavior) => {
              const selected = settings.closeWindowBehavior === behavior;
              const isMinimize = behavior === "minimize";
              return (
                <SettingsChoiceCard
                  key={behavior}
                  label={
                    isMinimize ? t("settings.closeWindowMinimize") : t("settings.closeWindowExit")
                  }
                  description={
                    isMinimize
                      ? t("settings.closeWindowMinimizeDesc")
                      : t("settings.closeWindowExitDesc")
                  }
                  icon={isMinimize ? <Minimize2 /> : <LogOut />}
                  isSelected={selected}
                  onSelect={() =>
                    setSettings((prev) => ({
                      ...prev,
                      closeWindowBehavior: behavior,
                    }))
                  }
                />
              );
            })}
          </AstryxView>
        </AstryxView>
      ) : null}

      <AstryxView
        as="section"
        className="settings-font-card settings-system-card space-y-3 rounded-2xl border border-border/60 bg-card p-4"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <ScanText className="h-4 w-4 text-muted-foreground" />
          {t("settings.fontFamily")}
        </AstryxView>
        <AstryxView layout="block" direction="horizontal" className="space-y-2">
          {fontFamilyFields.map(({ key, label }) => {
            const currentValue = settings.customSettings[key];
            const selectValue = toFontFamilySelectValue(
              currentValue,
              fontFamilyOptions,
              customFontModes[key] === true,
            );
            const custom = selectValue === FONT_FAMILY_CUSTOM_SELECT_VALUE;
            return (
              <AstryxView
                layout="block"
                direction="horizontal"
                key={key}
                className="rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5"
              >
                <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="mt-1.5 flex min-w-0 items-center gap-2 max-sm:flex-col max-sm:items-stretch"
                >
                  <Select
                    value={selectValue}
                    onValueChange={(value) => handleFontFamilySelect(key, value)}
                  >
                    <SelectTrigger className={custom ? "w-48 max-sm:w-full" : "w-full"}>
                      <SelectValue>
                        {(value) => {
                          if (value === FONT_FAMILY_DEFAULT_SELECT_VALUE)
                            return t("settings.fontFamilyDefault");
                          if (value === FONT_FAMILY_CUSTOM_SELECT_VALUE)
                            return t("settings.fontFamilyCustom");
                          return (
                            fontFamilyOptions.find((option) => option.value === value)?.label ??
                            String(value ?? "")
                          );
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={FONT_FAMILY_DEFAULT_SELECT_VALUE}>
                        {t("settings.fontFamilyDefault")}
                      </SelectItem>
                      <SelectItem value={FONT_FAMILY_CUSTOM_SELECT_VALUE}>
                        {t("settings.fontFamilyCustom")}
                      </SelectItem>
                      {fontFamilyOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          style={{ fontFamily: option.value }}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {custom ? (
                    <Input
                      className="min-w-0 flex-1"
                      value={customFontDrafts[key] ?? currentValue}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder={t("settings.fontFamilyPlaceholder")}
                      onChange={(event) =>
                        setCustomFontDrafts((current) => ({
                          ...current,
                          [key]: event.currentTarget.value,
                        }))
                      }
                      onBlur={() => commitCustomFontFamily(key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  ) : null}
                </AstryxView>
              </AstryxView>
            );
          })}
        </AstryxView>
      </AstryxView>

      <AstryxView
        as="section"
        className="settings-font-card settings-system-card space-y-3 rounded-2xl border border-border/60 bg-card p-4"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <ScanText className="h-4 w-4 text-muted-foreground" />
          {t("settings.fontSize")}
        </AstryxView>

        <AstryxView layout="block" direction="horizontal" className="space-y-2">
          {fontScaleZones.map((zone) => (
            <AstryxView
              layout="flex"
              direction="horizontal"
              key={zone.key}
              className="settings-font-zone flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/80 px-3.5 py-2.5"
            >
              <AstryxView
                layout="block"
                direction="horizontal"
                className="text-sm font-medium text-foreground"
              >
                {zone.label}
              </AstryxView>
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5"
              >
                {FONT_SCALE_OPTIONS.map((value) => {
                  const selected = fontScale[zone.key] === value;
                  return (
                    <ToggleButton
                      key={value}
                      label={getFontScaleLabel(value)}
                      isPressed={selected}
                      size="sm"
                      onPressedChange={(isPressed) => {
                        if (isPressed) setZoneFontScale(zone.key, value);
                      }}
                    >
                      {getFontScaleLabel(value)}
                    </ToggleButton>
                  );
                })}
              </AstryxView>
            </AstryxView>
          ))}
        </AstryxView>
      </AstryxView>
    </AstryxView>
  );
}
