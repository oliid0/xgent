import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Brain,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Cpu,
  Info,
  Keyboard,
  Mic,
  MonitorSmartphone,
  MoreHorizontal,
  Palette,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Terminal,
  X,
} from "../components/icons";

import { useLocale } from "../i18n";
import { useCompactViewport } from "../lib/responsive/compactViewport";
import { THEME_OPTIONS, updateCustomSettings } from "../lib/settings";
import { UI_THEME_PRESETS } from "../lib/settings/appearance";
import { useMobileBackNavigation } from "../lib/useMobileBackNavigation";
import { AboutSection } from "./settings/AboutSection";
import { AccessSection } from "./settings/AccessSection";
import { BackupSyncSection } from "./settings/BackupSyncSection";
import { ComputerUseSection } from "./settings/ComputerUseSection";
import { GlobalShortcutsSection } from "./settings/GlobalShortcutsSection";
import { MobileAssistantSection } from "./settings/MobileAssistantSection";
import { MobileExecutionSection } from "./settings/MobileExecutionSection";
import { MobileVoiceSettingsSection } from "./settings/MobileVoiceSettingsSection";
import { MemoryPanel } from "./settings/memory/MemoryPanel";
import { mobileSettingsStatus } from "./settings/mobileSettingsStatus";
import { OtherSettingsSection } from "./settings/OtherSettingsSection";
import { ProjectRootsSection } from "./settings/ProjectRootsSection";
import { ProviderSettingsSection } from "./settings/ProviderSettingsSection";
import { SettingsDetailHeader } from "./settings/SettingsDetailHeader";
import { SettingsDetailLayerProvider } from "./settings/SettingsModalShell";
import { SoulSection } from "./settings/SoulSection";
import { SttSettingsSection } from "./settings/SttSettingsSection";
import { SystemSettingsForm } from "./settings/SystemSettingsForm";
import {
  SettingsNavigationRow,
  SettingsRow,
  SettingsRowGroup,
  SettingsValueSelector,
} from "./settings/shared";
import { ToolPermissionsSection } from "./settings/ToolPermissionsSection";
import type { SectionId, SettingsPageProps } from "./settings/types";

function getSaveIndicator(state: SettingsPageProps["saveState"], t: (key: string) => string) {
  switch (state.status) {
    case "saving":
      return {
        variant: "warning" as StatusDotVariant,
        isPulsing: true,
        text: t("settings.saving"),
        title: t("settings.savingDesc"),
      };
    case "error":
      return {
        variant: "error" as StatusDotVariant,
        isPulsing: false,
        text: t("settings.saveError"),
        title: state.message,
      };
    case "saved":
    case "idle":
    default:
      return {
        variant: "success" as StatusDotVariant,
        isPulsing: false,
        text: t("settings.saved"),
        title: t("settings.savedDesc"),
      };
  }
}

type NavItemProps = {
  icon: IconType;
  label: string;
  active: boolean;
  onClick: () => void;
};

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <ListItem
      label={label}
      startContent={<Icon icon={icon} size="sm" color={active ? "accent" : "secondary"} />}
      isSelected={active}
      onClick={onClick}
    />
  );
}

type SaveStatusProps = {
  indicator: ReturnType<typeof getSaveIndicator>;
};

function SaveStatus({ indicator }: SaveStatusProps) {
  if (indicator.variant !== "error") return null;
  return (
    <HStack
      gap={1}
      vAlign="center"
      role="status"
      aria-live={indicator.variant === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <StatusDot
        variant={indicator.variant}
        label={indicator.text}
        isPulsing={indicator.isPulsing}
        tooltip={indicator.title}
      />
      <Text type="supporting" color="secondary" wordBreak="break-word">
        {indicator.title || indicator.text}
      </Text>
    </HStack>
  );
}

type NavDefinition = {
  id: SectionId;
  icon: IconType;
  descriptionKey: string;
  mobileOnly?: boolean;
  desktopOnly?: boolean;
};

const NAV_ITEMS: NavDefinition[] = [
  {
    id: "system",
    icon: Settings,
    descriptionKey: "settings.mobile.systemDescription",
  },
  {
    id: "providers",
    icon: Cpu,
    descriptionKey: "settings.mobile.providersDescription",
  },
  {
    id: "shortcuts",
    icon: Keyboard,
    descriptionKey: "settings.globalShortcutsDesc",
    desktopOnly: true,
  },
  {
    id: "backup",
    icon: Archive,
    descriptionKey: "settings.backupSyncDesc",
  },
  {
    id: "computerUse",
    icon: MonitorSmartphone,
    descriptionKey: "settings.cua.description",
    desktopOnly: true,
  },
  {
    id: "toolPermissions",
    icon: Shield,
    descriptionKey: "settings.toolPermissionsDesc",
  },
  {
    id: "voice",
    icon: Mic,
    descriptionKey: "settings.stt.desc",
  },
  {
    id: "soul",
    icon: Sparkles,
    descriptionKey: "settings.mobile.soulDescription",
  },
  {
    id: "memory",
    icon: Brain,
    descriptionKey: "settings.mobile.memoryDescription",
  },
  {
    id: "other",
    icon: MoreHorizontal,
    descriptionKey: "settings.mobile.otherDescription",
  },
  {
    id: "access",
    icon: Cloud,
    descriptionKey: "settings.mobile.accessDescription",
  },
  {
    id: "mobileAssistant",
    icon: Shield,
    descriptionKey: "settings.mobile.assistantDescription",
    mobileOnly: true,
  },
  {
    id: "mobileExecution",
    icon: Terminal,
    descriptionKey: "settings.mobile.executionDescription",
    mobileOnly: true,
  },
  {
    id: "about",
    icon: Info,
    descriptionKey: "settings.mobile.aboutDescription",
  },
];

function normalizeSettingsSection(value: SectionId): SectionId {
  if (value === "failover" || value === "usage") return "providers";
  if (value === "hooks" || value === "cron" || value === "ssh") return "other";
  return value;
}

export function SettingsPage(props: SettingsPageProps) {
  const {
    settings,
    setSettings,
    reloadSettings,
    saveState,
    onBack,
    initialSection = "system",
    soulCreateRequestId = 0,
    hiddenSections = [],
    nativeMobile = false,
    appUpdate,
  } = props;
  const { t } = useLocale();
  const compactViewport = useCompactViewport();
  const currentVersion =
    appUpdate.result?.currentVersion ??
    (typeof __XGENT_APP_VERSION__ === "string" ? __XGENT_APP_VERSION__ : undefined);
  const compactSettings = nativeMobile || compactViewport;
  const [section, setSection] = useState<SectionId>(() => normalizeSettingsSection(initialSection));
  const [mobileDetailOpen, setMobileDetailOpen] = useState(
    () => compactSettings && initialSection !== "system",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [detailParent, setDetailParent] = useState<SectionId | null>(null);
  const returnFromMobileDetail = () => {
    if (detailParent) {
      setSection(detailParent);
      setDetailParent(null);
    } else setMobileDetailOpen(false);
  };
  const [detailLayerDepth, setDetailLayerDepth] = useState(0);
  const handleDetailLayerChange = useCallback((delta: 1 | -1) => {
    setDetailLayerDepth((current) => Math.max(0, current + delta));
  }, []);

  const sectionLabels: Record<SectionId, string> = {
    system: t("settings.navSystem"),
    providers: t("settings.navProviders"),
    failover: t("settings.navFailover"),
    projectRoots: t("settings.navProjectRoots"),
    soul: t("settings.navSoul"),
    memory: t("settings.navMemory"),
    skills: t("settings.navSkills"),
    mcp: "MCP",
    other: t("settings.navOther"),
    hooks: t("settings.navHooks"),
    cron: t("settings.navCron"),
    ssh: t("settings.navSsh"),
    access: t("settings.navAccess"),
    shortcuts: t("settings.navShortcuts"),
    backup: t("settings.navBackup"),
    computerUse: t("settings.cua.title"),
    toolPermissions: t("settings.navToolPermissions"),
    voice: t("settings.navVoice"),
    usage: t("settings.navUsage"),
    mobileAssistant: t("settings.navMobileAssistant"),
    mobileExecution: t("settings.navMobileExecution"),
    about: t("settings.navAbout"),
  };

  const hiddenSectionSet = useMemo(() => new Set(hiddenSections), [hiddenSections]);
  const navItems = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) =>
          !hiddenSectionSet.has(item.id) &&
          (!item.mobileOnly || nativeMobile) &&
          (!item.desktopOnly || !nativeMobile),
      ).map((item) => ({
        ...item,
        label: sectionLabels[item.id],
        description: t(
          nativeMobile && item.id === "voice"
            ? "settings.mobileAssistant.microphoneDescription"
            : item.descriptionKey,
        ),
      })),
    [hiddenSectionSet, nativeMobile, sectionLabels, t],
  );
  const visibleDesktopNavItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return navItems;
    return navItems.filter((item) =>
      `${item.label} ${item.description}`.toLocaleLowerCase().includes(query),
    );
  }, [navItems, searchQuery]);
  const mobileNavGroups = useMemo(
    () =>
      [
        {
          label: t("settings.mobile.appearanceGroup"),
          ids: ["system", "providers"] as SectionId[],
        },
        {
          label: t("settings.mobile.personalGroup"),
          ids: ["soul", "memory", "mobileAssistant"] as SectionId[],
        },
        {
          label: t("settings.mobile.capabilitiesGroup"),
          ids: [
            "mobileExecution",
            "computerUse",
            "toolPermissions",
            "shortcuts",
            "voice",
            "other",
            "access",
            "backup",
            "about",
          ] as SectionId[],
        },
      ]
        .map((group) => ({
          ...group,
          items: group.ids
            .map((id) => navItems.find((item) => item.id === id))
            .filter((item) => !!item),
        }))
        .filter((group) => group.items.length > 0),
    [navItems, t],
  );

  useEffect(() => {
    setSection(normalizeSettingsSection(initialSection));
    setDetailParent(null);
    setMobileDetailOpen(compactSettings && normalizeSettingsSection(initialSection) !== "system");
  }, [compactSettings, initialSection]);

  useEffect(() => {
    if (navItems.some((item) => item.id === section)) {
      return;
    }
    setSection(navItems[0]?.id ?? "system");
  }, [navItems, section]);

  const saveIndicator = getSaveIndicator(saveState, t);
  const sectionManagesScroll = section === "providers" || section === "memory";
  // Shell installation has a long, changing form. Let the tall BottomSheet
  // own its scrollport so Android WebView can reach the package controls.
  const sheetScrollsAccess = nativeMobile && mobileDetailOpen && section === "access";
  const sectionContent = (() => {
    // Resolve hidden destinations before mounting their effects, including deep links.
    if (!navItems.some((item) => item.id === section)) return null;
    switch (section) {
      case "providers":
        return (
          <ProviderSettingsSection
            settings={settings}
            setSettings={setSettings}
            thirdPartyImportEnabled={!nativeMobile}
          />
        );
      case "failover":
        return null;
      case "soul":
        return <SoulSection createRequestId={soulCreateRequestId} />;
      case "system":
        return (
          <SystemSettingsForm
            settings={settings}
            setSettings={setSettings}
            compact={compactSettings}
            onBack={() => setMobileDetailOpen(false)}
            saveState={saveState}
          />
        );
      case "access":
        return (
          <AccessSection
            settings={settings}
            setSettings={setSettings}
            nativeMobile={nativeMobile}
            compact={compactSettings}
          />
        );
      case "mobileExecution":
        return (
          <MobileExecutionSection
            settings={settings}
            setSettings={setSettings}
            compact={compactSettings}
          />
        );
      case "mobileAssistant":
        return <MobileAssistantSection settings={settings} setSettings={setSettings} />;
      case "memory":
        return (
          <MemoryPanel
            workdir={settings.system.workdir}
            settings={settings}
            setSettings={setSettings}
            compact={compactSettings}
          />
        );
      case "skills":
      case "mcp":
        return null;
      case "hooks":
      case "cron":
      case "ssh":
        return null;
      case "other":
        return <OtherSettingsSection settings={settings} setSettings={setSettings} />;
      case "shortcuts":
        return <GlobalShortcutsSection />;
      case "backup":
        return (
          <BackupSyncSection
            settings={settings}
            setSettings={setSettings}
            reloadSettings={reloadSettings}
            compact={compactSettings}
          />
        );
      case "computerUse":
        return (
          <ComputerUseSection
            settings={settings}
            setSettings={setSettings}
            compact={compactSettings}
          />
        );
      case "toolPermissions":
        return (
          <ToolPermissionsSection
            settings={settings}
            setSettings={setSettings}
            compact={compactSettings}
          />
        );
      case "projectRoots":
        return <ProjectRootsSection settings={settings} setSettings={setSettings} />;
      case "voice":
        return nativeMobile ? (
          <MobileVoiceSettingsSection
            settings={settings}
            setSettings={setSettings}
            onOpenPermissions={() => {
              setDetailParent("voice");
              setSection("mobileAssistant");
              setMobileDetailOpen(true);
            }}
          />
        ) : (
          <SttSettingsSection settings={settings} setSettings={setSettings} />
        );
      case "usage":
        return null;
      case "about":
        return (
          <AboutSection
            currentVersion={appUpdate.result?.currentVersion || __XGENT_APP_VERSION__}
          />
        );
      default: {
        const unreachable: never = section;
        return unreachable;
      }
    }
  })();

  const mobileBackRef = useRef<HTMLElement>(null);
  useMobileBackNavigation(
    compactSettings,
    () => {
      if (mobileDetailOpen) returnFromMobileDetail();
      else onBack();
    },
    10,
    () => mobileBackRef.current,
  );

  if (compactSettings) {
    return (
      <SettingsDetailLayerProvider onLayerChange={handleDetailLayerChange}>
        <Section
          ref={mobileBackRef}
          width="100%"
          height={sheetScrollsAccess ? undefined : "100%"}
          padding={0}
        >
          <Layout
            height={sheetScrollsAccess ? "auto" : "fill"}
            padding={0}
            className={`settings-page settings-page-compact${!mobileDetailOpen ? " settings-page-index" : ""}${sheetScrollsAccess ? " settings-page-sheet-scroll" : ""}`}
            data-edge-swipe-ignore
            header={
              detailLayerDepth > 0 ? undefined : mobileDetailOpen ? (
                <VStack className="mobile-panel-header" width="100%" gap={0}>
                  <SettingsDetailHeader
                    title={sectionLabels[section]}
                    hasDivider={false}
                    startContent={
                      <IconButton
                        className="settings-navigation-control"
                        label={
                          detailParent
                            ? sectionLabels[detailParent]
                            : t("settings.mobile.backToSettings")
                        }
                        tooltip={
                          detailParent
                            ? sectionLabels[detailParent]
                            : t("settings.mobile.backToSettings")
                        }
                        icon={<Icon icon={ChevronLeft} size="md" color="inherit" />}
                        variant="ghost"
                        size="lg"
                        onClick={returnFromMobileDetail}
                      />
                    }
                  />
                </VStack>
              ) : (
                <HStack className="settings-index-header" width="100%" hAlign="end">
                  <IconButton
                    className="settings-navigation-control settings-index-close"
                    label={t("settings.close")}
                    tooltip={t("settings.close")}
                    icon={<Icon icon={X} size="md" color="inherit" />}
                    variant="ghost"
                    size="lg"
                    onClick={onBack}
                  />
                </HStack>
              )
            }
            content={
              mobileDetailOpen ? (
                <LayoutContent
                  key={section}
                  data-settings-section={section}
                  padding={4}
                  isScrollable={!sheetScrollsAccess && !sectionManagesScroll}
                  className="settings-section-enter settings-detail-content"
                >
                  <VStack
                    width="100%"
                    maxWidth="var(--xgent-settings-content-max-width)"
                    height={sectionManagesScroll ? "100%" : undefined}
                    minHeight={sectionManagesScroll ? 0 : undefined}
                    className="settings-section-shell"
                    style={{ marginInline: "auto" }}
                  >
                    <SaveStatus indicator={saveIndicator} />
                    {sectionContent}
                  </VStack>
                </LayoutContent>
              ) : (
                <LayoutContent padding={4} label={t("settings.title")}>
                  <VStack
                    width="100%"
                    maxWidth="var(--xgent-content-width-md)"
                    gap={5}
                    style={{ marginInline: "auto" }}
                  >
                    <SaveStatus indicator={saveIndicator} />
                    <SettingsRowGroup title={t("settings.native.theme")} hideTitle>
                      <SettingsRow
                        label={t("settings.native.appearance")}
                        icon={<Icon icon={Sun} size="md" color="inherit" />}
                        controlLayout="value"
                      >
                        <SettingsValueSelector
                          label={t("settings.native.appearance")}
                          isLabelHidden
                          value={settings.theme}
                          options={THEME_OPTIONS.map((value) => ({
                            value,
                            label: t(`settings.native.${value}`),
                          }))}
                          onChange={(theme) =>
                            setSettings((previous) => ({
                              ...previous,
                              theme: theme as typeof previous.theme,
                            }))
                          }
                        />
                      </SettingsRow>
                      <SettingsRow
                        label={t("settings.ui.preset")}
                        icon={<Icon icon={Palette} size="md" color="inherit" />}
                        controlLayout="value"
                      >
                        <SettingsValueSelector
                          label={t("settings.ui.preset")}
                          isLabelHidden
                          value={settings.customSettings.appearance.preset}
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
                            setSettings((previous) =>
                              updateCustomSettings(previous, {
                                appearance: {
                                  ...previous.customSettings.appearance,
                                  preset:
                                    preset as typeof previous.customSettings.appearance.preset,
                                  customized: false,
                                },
                              }),
                            )
                          }
                        />
                      </SettingsRow>
                    </SettingsRowGroup>
                    {mobileNavGroups.map((group) => (
                      <SettingsRowGroup key={group.label} title={group.label}>
                        {group.items.map((item) => (
                          <SettingsNavigationRow
                            key={item.id}
                            label={item.label}
                            icon={<Icon icon={item.icon} size="md" color="inherit" />}
                            status={
                              item.id === "about" && currentVersion
                                ? `v${currentVersion}`
                                : mobileSettingsStatus(item.id, settings, t)
                            }
                            chevron={<Icon icon={ChevronRight} size="sm" color="tertiary" />}
                            onClick={() => {
                              setDetailParent(null);
                              setSection(item.id);
                              setMobileDetailOpen(true);
                            }}
                          />
                        ))}
                      </SettingsRowGroup>
                    ))}
                  </VStack>
                </LayoutContent>
              )
            }
          />
        </Section>
      </SettingsDetailLayerProvider>
    );
  }

  return (
    <SettingsDetailLayerProvider onLayerChange={handleDetailLayerChange}>
      <Layout
        height="fill"
        padding={0}
        className="settings-page settings-page-desktop"
        style={{ height: "var(--xgent-settings-dialog-height)" }}
        data-edge-swipe-ignore
        start={
          <LayoutPanel
            width="var(--xgent-settings-sidebar-width)"
            padding={3}
            hasDivider
            isScrollable={false}
            role="navigation"
            label={t("settings.title")}
          >
            <VStack height="100%" gap={2}>
              <HStack width="100%" hAlign="start">
                <IconButton
                  label={t("settings.close")}
                  tooltip={t("settings.close")}
                  icon={<Icon icon={X} size="sm" color="inherit" />}
                  variant="ghost"
                  onClick={onBack}
                />
              </HStack>
              <TextInput
                type="text"
                value={searchQuery}
                onChange={setSearchQuery}
                label={t("settings.searchPlaceholder")}
                isLabelHidden
                placeholder={t("settings.searchPlaceholder")}
                startIcon="search"
                hasClear
                width="100%"
              />
              <StackItem size="fill" isScrollable>
                <VStack gap={2}>
                  <List density="balanced">
                    {visibleDesktopNavItems.map((item) => (
                      <NavItem
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        active={section === item.id}
                        onClick={() => setSection(item.id)}
                      />
                    ))}
                  </List>
                  {visibleDesktopNavItems.length === 0 ? (
                    <EmptyState title={t("settings.searchEmpty")} isCompact />
                  ) : null}
                </VStack>
              </StackItem>
              <SaveStatus indicator={saveIndicator} />
            </VStack>
          </LayoutPanel>
        }
        content={
          <VStack height="100%" minHeight={0} gap={0}>
            {detailLayerDepth === 0 ? (
              <LayoutHeader hasDivider height="var(--xgent-settings-header-height)" padding={0}>
                <HStack
                  width="100%"
                  height="100%"
                  paddingInline={4}
                  paddingBlockStart={2}
                  vAlign="center"
                >
                  <HStack
                    width="100%"
                    maxWidth="var(--xgent-settings-content-max-width)"
                    style={{ marginInline: "auto" }}
                  >
                    <Heading level={2}>{sectionLabels[section]}</Heading>
                  </HStack>
                </HStack>
              </LayoutHeader>
            ) : null}
            <StackItem size="fill" isScrollable={!sectionManagesScroll}>
              <VStack
                key={section}
                data-settings-section={section}
                width="100%"
                maxWidth="var(--xgent-settings-content-max-width)"
                height="100%"
                minHeight={sectionManagesScroll ? 0 : "100%"}
                padding={3}
                className="settings-section-shell settings-section-enter"
                style={{ marginInline: "auto" }}
              >
                {sectionContent}
              </VStack>
            </StackItem>
          </VStack>
        }
      />
    </SettingsDetailLayerProvider>
  );
}
