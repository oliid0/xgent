import { DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutPanel,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BookOpen,
  Brain,
  Cable,
  ChevronRight,
  Clock3,
  Cloud,
  Cpu,
  FolderTree,
  Info,
  Key,
  Keyboard,
  Mic,
  Settings2,
  Shield,
  Sparkles,
  Terminal,
  Waypoints,
  Zap,
} from "../components/icons";

import { useLocale } from "../i18n";
import { useCompactViewport } from "../lib/responsive/compactViewport";
import { AboutSection } from "./settings/AboutSection";
import { AccessSection } from "./settings/AccessSection";
import { BackupSyncSection } from "./settings/BackupSyncSection";
import { CronSection } from "./settings/CronSection";
import { GlobalShortcutsSection } from "./settings/GlobalShortcutsSection";
import { HooksSection } from "./settings/HooksSection";
import { McpSettingsSection } from "./settings/McpSettingsSection";
import { MobileAssistantSection } from "./settings/MobileAssistantSection";
import { MobileExecutionSection } from "./settings/MobileExecutionSection";
import { ModelFailoverSection } from "./settings/ModelFailoverSection";
import { MemoryPanel } from "./settings/memory/MemoryPanel";
import { ProjectRootsSection } from "./settings/ProjectRootsSection";
import { ProvidersSection } from "./settings/ProvidersSection";
import { ProviderUsageSection } from "./settings/ProviderUsageSection";
import { SkillsSettingsForm } from "./settings/SkillsSettingsForm";
import { SoulSection } from "./settings/SoulSection";
import { SshSettingsSection } from "./settings/SshSettingsSection";
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

type NavGroup = {
  labelKey: string;
  items: Array<{
    id: SectionId;
    icon: IconType;
    descriptionKey: string;
    mobileOnly?: boolean;
    desktopOnly?: boolean;
  }>;
};

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "settings.groupGeneral",
    items: [
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
        id: "failover",
        icon: Waypoints,
        descriptionKey: "settings.failover.desc",
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
        id: "projectRoots",
        icon: FolderTree,
        descriptionKey: "settings.projectRoots.desc",
        desktopOnly: true,
      },
      {
        id: "voice",
        icon: Mic,
        descriptionKey: "settings.stt.desc",
        desktopOnly: true,
      },
      {
        id: "usage",
        icon: Cloud,
        descriptionKey: "settings.usage.desc",
      },
    ],
  },
  {
    labelKey: "settings.groupIntelligence",
    items: [
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
        id: "skills",
        icon: BookOpen,
        descriptionKey: "settings.mobile.skillsDescription",
      },
      {
        id: "mcp",
        icon: Cable,
        descriptionKey: "settings.mobile.mcpDescription",
      },
    ],
  },
  {
    labelKey: "settings.groupAutomation",
    items: [
      {
        id: "hooks",
        icon: Zap,
        descriptionKey: "settings.mobile.hooksDescription",
      },
      {
        id: "cron",
        icon: Clock3,
        descriptionKey: "settings.mobile.cronDescription",
      },
    ],
  },
  {
    labelKey: "settings.groupConnectivity",
    items: [
      {
        id: "ssh",
        icon: Key,
        descriptionKey: "settings.mobile.sshDescription",
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
    ],
  },
  {
    labelKey: "settings.groupOther",
    items: [
      {
        id: "about",
        icon: Info,
        descriptionKey: "settings.mobile.aboutDescription",
      },
    ],
  },
];

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
  const [section, setSection] = useState<SectionId>(initialSection);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(
    () => compactSettings && initialSection !== "system",
  );
  const [searchQuery, setSearchQuery] = useState("");

  const sectionLabels: Record<SectionId, string> = {
    system: t("settings.navSystem"),
    providers: t("settings.navProviders"),
    failover: t("settings.navFailover"),
    projectRoots: t("settings.navProjectRoots"),
    soul: t("settings.navSoul"),
    memory: t("settings.navMemory"),
    skills: t("settings.navSkills"),
    mcp: "MCP",
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
  const navGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        label: t(group.labelKey),
        items: group.items
          .filter(
            (item) =>
              !hiddenSectionSet.has(item.id) &&
              (!item.mobileOnly || nativeMobile) &&
              (!item.desktopOnly || !nativeMobile),
          )
          .map((item) => ({
            ...item,
            label: sectionLabels[item.id],
            description: t(item.descriptionKey),
          })),
      })).filter((group) => group.items.length > 0),
    [hiddenSectionSet, nativeMobile, sectionLabels, t],
  );
  const allNavItems = useMemo(() => navGroups.flatMap((g) => g.items), [navGroups]);
  const visibleDesktopNavItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return allNavItems;
    return allNavItems.filter((item) =>
      `${item.label} ${item.description}`.toLocaleLowerCase().includes(query),
    );
  }, [allNavItems, searchQuery]);
  const desktopNavGroups = useMemo(() => {
    const visibleIds = new Set(visibleDesktopNavItems.map((item) => item.id));
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => visibleIds.has(item.id)),
      }))
      .filter((group) => group.items.length > 0);
  }, [navGroups, visibleDesktopNavItems]);

  useEffect(() => {
    setSection(initialSection);
    setMobileDetailOpen(compactSettings && initialSection !== "system");
  }, [compactSettings, initialSection]);

  useEffect(() => {
    if (allNavItems.some((item) => item.id === section)) {
      return;
    }
    setSection(allNavItems[0]?.id ?? "system");
  }, [allNavItems, section]);

  const saveIndicator = getSaveIndicator(saveState, t);
  const sectionManagesScroll = section === "providers" || section === "memory" || section === "mcp";
  const sectionContent = (() => {
    switch (section) {
      case "providers":
        return (
          <ProvidersSection
            settings={settings}
            setSettings={setSettings}
            thirdPartyImportEnabled={!nativeMobile}
          />
        );
      case "failover":
        return <ModelFailoverSection settings={settings} setSettings={setSettings} />;
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
        return <HooksSection settings={settings} setSettings={setSettings} />;
      case "cron":
        return <CronSection settings={settings} setSettings={setSettings} />;
      case "ssh":
        return <SshSettingsSection settings={settings} setSettings={setSettings} />;
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
        return <ProviderUsageSection settings={settings} setSettings={setSettings} />;
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
      <Layout
        height="fill"
        padding={0}
        className="settings-page settings-page-compact bg-surface"
        data-edge-swipe-ignore
        header={
          <DialogHeader
            title={mobileDetailOpen ? sectionLabels[section] : t("settings.title")}
            hasDivider
            startContent={
              <IconButton
                label={
                  mobileDetailOpen ? t("settings.mobile.backToSettings") : t("settings.backToChat")
                }
                tooltip={
                  mobileDetailOpen ? t("settings.mobile.backToSettings") : t("settings.backToChat")
                }
                icon={<Icon icon={ArrowLeft} size="sm" color="inherit" />}
                variant="ghost"
                onClick={mobileDetailOpen ? () => setMobileDetailOpen(false) : onBack}
              />
            }
            endContent={<SaveStatus indicator={saveIndicator} />}
          />
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
                height="100%"
                minHeight={sectionManagesScroll ? 0 : "100%"}
                className="settings-section-shell"
              >
                {sectionContent}
              </VStack>
            </LayoutContent>
          ) : (
            <LayoutContent padding={4} label={t("settings.title")}>
              <VStack width="100%" maxWidth={640} gap={4} className="mx-auto">
                {navGroups.map((group) => (
                  <List
                    key={group.label}
                    density="spacious"
                    hasDividers
                    header={
                      <Text type="label" color="secondary" weight="semibold">
                        {group.label}
                      </Text>
                    }
                    className="settings-mobile-group"
                  >
                    {group.items.map((item) => (
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
                ))}
              </VStack>
            </LayoutContent>
          )
        }
      />
    );
  }

  return (
    <Layout
      height="fill"
      padding={0}
      className="settings-page settings-page-desktop bg-surface"
      data-edge-swipe-ignore
      header={<DialogHeader title={t("settings.title")} onOpenChange={() => onBack()} hasDivider />}
      start={
        <LayoutPanel
          width={230}
          padding={4}
          hasDivider
          isScrollable={false}
          role="navigation"
          label={t("settings.title")}
        >
          <VStack height="100%" gap={3}>
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
              <VStack gap={4}>
                {desktopNavGroups.map((group) => (
                  <List
                    key={group.label}
                    density="compact"
                    header={
                      <Text type="label" color="secondary" weight="semibold">
                        {group.label}
                      </Text>
                    }
                  >
                    {group.items.map((item) => (
                      <NavItem
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        active={section === item.id}
                        onClick={() => setSection(item.id)}
                      />
                    ))}
                  </List>
                ))}
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
        <LayoutContent
          key={section}
          data-settings-section={section}
          padding={5}
          isScrollable={!sectionManagesScroll}
          className="settings-section-enter"
        >
          <VStack
            height="100%"
            minHeight={sectionManagesScroll ? 0 : "100%"}
            className="settings-section-shell"
          >
            {sectionContent}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
