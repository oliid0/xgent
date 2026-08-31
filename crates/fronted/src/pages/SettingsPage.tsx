import { DialogHeader } from "@astryxdesign/core/Dialog";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Brain,
  ChevronRight,
  Cloud,
  Cpu,
  Info,
  Keyboard,
  Mic,
  Settings2,
  Shield,
  Sparkles,
  Terminal,
  X,
} from "../components/icons";

import { useLocale } from "../i18n";
import { useCompactViewport } from "../lib/responsive/compactViewport";
import { AboutSection } from "./settings/AboutSection";
import { AccessSection } from "./settings/AccessSection";
import { BackupSyncSection } from "./settings/BackupSyncSection";
import { GlobalShortcutsSection } from "./settings/GlobalShortcutsSection";
import { McpSettingsSection } from "./settings/McpSettingsSection";
import { MobileAssistantSection } from "./settings/MobileAssistantSection";
import { MobileExecutionSection } from "./settings/MobileExecutionSection";
import { MemoryPanel } from "./settings/memory/MemoryPanel";
import { OtherSettingsSection } from "./settings/OtherSettingsSection";
import { ProjectRootsSection } from "./settings/ProjectRootsSection";
import { ProviderSettingsSection } from "./settings/ProviderSettingsSection";
import { SettingsDetailLayerProvider } from "./settings/SettingsModalShell";
import { SkillsSettingsForm } from "./settings/SkillsSettingsForm";
import { SoulSection } from "./settings/SoulSection";
import { SttSettingsSection } from "./settings/SttSettingsSection";
import { SystemSettingsForm } from "./settings/SystemSettingsForm";
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
      <Text type="supporting" color="secondary" maxLines={1}>
        {indicator.text}
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
    icon: Settings2,
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
    id: "toolPermissions",
    icon: Shield,
    descriptionKey: "settings.toolPermissionsDesc",
  },
  {
    id: "voice",
    icon: Mic,
    descriptionKey: "settings.stt.desc",
    desktopOnly: true,
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
    icon: Terminal,
    descriptionKey: "settings.mobile.otherDescription",
  },
  {
    id: "access",
    icon: Cloud,
    descriptionKey: "settings.mobile.accessDescription",
  },
  {
    id: "mobileAssistant",
    icon: Mic,
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
  const compactSettings = nativeMobile || compactViewport;
  const [section, setSection] = useState<SectionId>(() => normalizeSettingsSection(initialSection));
  const [mobileDetailOpen, setMobileDetailOpen] = useState(
    () => compactSettings && initialSection !== "system",
  );
  const [searchQuery, setSearchQuery] = useState("");
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
        description: t(item.descriptionKey),
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

  useEffect(() => {
    setSection(normalizeSettingsSection(initialSection));
    setMobileDetailOpen(compactSettings && normalizeSettingsSection(initialSection) !== "system");
  }, [compactSettings, initialSection]);

  useEffect(() => {
    if (navItems.some((item) => item.id === section)) {
      return;
    }
    setSection(navItems[0]?.id ?? "system");
  }, [navItems, section]);

  const saveIndicator = getSaveIndicator(saveState, t);
  const sectionManagesScroll = section === "providers" || section === "memory" || section === "mcp";
  const sectionContent = (() => {
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
          />
        );
      case "access":
        return (
          <AccessSection
            settings={settings}
            setSettings={setSettings}
            nativeMobile={nativeMobile}
          />
        );
      case "mobileExecution":
        return <MobileExecutionSection settings={settings} setSettings={setSettings} />;
      case "mobileAssistant":
        return <MobileAssistantSection />;
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
        return <SkillsSettingsForm settings={settings} setSettings={setSettings} />;
      case "mcp":
        return (
          <McpSettingsSection
            settings={settings}
            setSettings={setSettings}
            allowStdio={!nativeMobile}
          />
        );
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
          />
        );
      case "toolPermissions":
        return <ToolPermissionsSection settings={settings} setSettings={setSettings} />;
      case "projectRoots":
        return <ProjectRootsSection settings={settings} setSettings={setSettings} />;
      case "voice":
        return <SttSettingsSection settings={settings} setSettings={setSettings} />;
      case "usage":
        return null;
      case "about":
        return <AboutSection settings={settings} setSettings={setSettings} appUpdate={appUpdate} />;
      default: {
        const unreachable: never = section;
        return unreachable;
      }
    }
  })();

  if (compactSettings) {
    return (
      <SettingsDetailLayerProvider onLayerChange={handleDetailLayerChange}>
        <Section variant="muted" width="100%" height="100%" padding={0}>
          <Layout
            height="fill"
            padding={0}
            className="settings-page settings-page-compact"
            data-edge-swipe-ignore
            header={
              detailLayerDepth > 0 ? undefined : (
                <DialogHeader
                  title={mobileDetailOpen ? sectionLabels[section] : t("settings.title")}
                  hasDivider
                  startContent={
                    <IconButton
                      label={
                        mobileDetailOpen
                          ? t("settings.mobile.backToSettings")
                          : t("settings.backToChat")
                      }
                      tooltip={
                        mobileDetailOpen
                          ? t("settings.mobile.backToSettings")
                          : t("settings.backToChat")
                      }
                      icon={<Icon icon={ArrowLeft} size="sm" color="inherit" />}
                      variant="ghost"
                      onClick={mobileDetailOpen ? () => setMobileDetailOpen(false) : onBack}
                    />
                  }
                  endContent={<SaveStatus indicator={saveIndicator} />}
                />
              )
            }
            content={
              mobileDetailOpen ? (
                <LayoutContent
                  key={section}
                  data-settings-section={section}
                  padding={4}
                  isScrollable={!sectionManagesScroll}
                  className="settings-section-enter"
                >
                  <VStack
                    width="100%"
                    maxWidth="var(--xagent-settings-content-max-width)"
                    height="100%"
                    minHeight={sectionManagesScroll ? 0 : "100%"}
                    className="settings-section-shell"
                    style={{ marginInline: "auto" }}
                  >
                    {sectionContent}
                  </VStack>
                </LayoutContent>
              ) : (
                <LayoutContent padding={4} label={t("settings.title")}>
                  <VStack
                    width="100%"
                    maxWidth="var(--xagent-content-width-md)"
                    gap={4}
                    style={{ marginInline: "auto" }}
                  >
                    <List density="spacious" hasDividers>
                      {navItems.map((item) => (
                        <ListItem
                          key={item.id}
                          label={item.label}
                          description={item.description}
                          startContent={<Icon icon={item.icon} size="md" color="secondary" />}
                          endContent={<Icon icon={ChevronRight} size="sm" color="tertiary" />}
                          onClick={() => {
                            setSection(item.id);
                            setMobileDetailOpen(true);
                          }}
                        />
                      ))}
                    </List>
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
        style={{ height: "var(--xagent-settings-dialog-height)" }}
        data-edge-swipe-ignore
        start={
          <LayoutPanel
            width="var(--xagent-settings-sidebar-width)"
            padding={3}
            hasDivider
            isScrollable={false}
            role="navigation"
            label={t("settings.title")}
          >
            <VStack height="100%" gap={2}>
              <HStack width="100%" hAlign="start">
                <IconButton
                  label={t("settings.backToChat")}
                  tooltip={t("settings.backToChat")}
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
              <LayoutHeader hasDivider height="var(--xagent-settings-header-height)" padding={0}>
                <HStack
                  width="100%"
                  height="100%"
                  paddingInline={4}
                  paddingBlockStart={2}
                  vAlign="center"
                >
                  <HStack
                    width="100%"
                    maxWidth="var(--xagent-settings-content-max-width)"
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
                maxWidth="var(--xagent-settings-content-max-width)"
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
