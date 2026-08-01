import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Cable,
  ChevronRight,
  Clock3,
  Cloud,
  Cpu,
  Info,
  Key,
  Mic,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "../components/icons";

import { useLocale } from "../i18n";
import { useCompactViewport } from "../lib/responsive/compactViewport";
import { AboutSection } from "./settings/AboutSection";
import { AccessSection } from "./settings/AccessSection";
import { CronSection } from "./settings/CronSection";
import { HooksSection } from "./settings/HooksSection";
import { McpSettingsSection } from "./settings/McpSettingsSection";
import { MobileAssistantSection } from "./settings/MobileAssistantSection";
import { MobileExecutionSection } from "./settings/MobileExecutionSection";
import { MemoryPanel } from "./settings/memory/MemoryPanel";
import { ProvidersSection } from "./settings/ProvidersSection";
import { SkillsSettingsForm } from "./settings/SkillsSettingsForm";
import { SoulSection } from "./settings/SoulSection";
import { SshSettingsSection } from "./settings/SshSettingsSection";
import { SystemSettingsForm } from "./settings/SystemSettingsForm";
import type { SectionId, SettingsPageProps } from "./settings/types";

function getSaveIndicator(state: SettingsPageProps["saveState"], t: (key: string) => string) {
  switch (state.status) {
    case "saving":
      return {
        dotClass: "bg-amber-500 animate-pulse",
        text: t("settings.saving"),
        title: t("settings.savingDesc"),
      };
    case "error":
      return {
        dotClass: "bg-destructive",
        text: t("settings.saveError"),
        title: state.message,
      };
    case "saved":
    case "idle":
    default:
      return {
        dotClass: "bg-emerald-500",
        text: t("settings.saved"),
        title: t("settings.savedDesc"),
      };
  }
}

type NavItemProps = {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
};

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`settings-nav-item group relative flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors duration-150 ${
        active
          ? "settings-nav-item-active bg-muted font-medium text-foreground"
          : "text-foreground/75 hover:bg-muted/65 hover:text-foreground"
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center transition-colors ${
          active ? "text-foreground" : "text-foreground/75 group-hover:text-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="truncate leading-none">{label}</span>
    </button>
  );
}

type NavGroup = {
  labelKey: string;
  items: Array<{
    id: SectionId;
    icon: ReactNode;
    accentClass: string;
    descriptionKey: string;
    mobileOnly?: boolean;
  }>;
};

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "settings.groupGeneral",
    items: [
      {
        id: "system",
        icon: <Settings2 className="h-3.5 w-3.5" />,
        accentClass: "bg-slate-500",
        descriptionKey: "settings.mobile.systemDescription",
      },
      {
        id: "providers",
        icon: <Cpu className="h-3.5 w-3.5" />,
        accentClass: "bg-blue-500",
        descriptionKey: "settings.mobile.providersDescription",
      },
    ],
  },
  {
    labelKey: "settings.groupIntelligence",
    items: [
      {
        id: "soul",
        icon: <Sparkles className="h-3.5 w-3.5" />,
        accentClass: "bg-violet-500",
        descriptionKey: "settings.mobile.soulDescription",
      },
      {
        id: "memory",
        icon: <Brain className="h-3.5 w-3.5" />,
        accentClass: "bg-violet-500",
        descriptionKey: "settings.mobile.memoryDescription",
      },
      {
        id: "skills",
        icon: <BookOpen className="h-3.5 w-3.5" />,
        accentClass: "bg-amber-500",
        descriptionKey: "settings.mobile.skillsDescription",
      },
      {
        id: "mcp",
        icon: <Cable className="h-3.5 w-3.5" />,
        accentClass: "bg-cyan-500",
        descriptionKey: "settings.mobile.mcpDescription",
      },
    ],
  },
  {
    labelKey: "settings.groupAutomation",
    items: [
      {
        id: "hooks",
        icon: <Zap className="h-3.5 w-3.5" />,
        accentClass: "bg-orange-500",
        descriptionKey: "settings.mobile.hooksDescription",
      },
      {
        id: "cron",
        icon: <Clock3 className="h-3.5 w-3.5" />,
        accentClass: "bg-emerald-500",
        descriptionKey: "settings.mobile.cronDescription",
      },
    ],
  },
  {
    labelKey: "settings.groupConnectivity",
    items: [
      {
        id: "ssh",
        icon: <Key className="h-3.5 w-3.5" />,
        accentClass: "bg-emerald-600",
        descriptionKey: "settings.mobile.sshDescription",
      },
      {
        id: "access",
        icon: <Cloud className="h-3.5 w-3.5" />,
        accentClass: "bg-sky-500",
        descriptionKey: "settings.mobile.accessDescription",
      },
      {
        id: "mobileAssistant",
        icon: <Mic className="h-3.5 w-3.5" />,
        accentClass: "bg-rose-500",
        descriptionKey: "settings.mobile.assistantDescription",
        mobileOnly: true,
      },
      {
        id: "mobileExecution",
        icon: <Terminal className="h-3.5 w-3.5" />,
        accentClass: "bg-zinc-600",
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
        icon: <Info className="h-3.5 w-3.5" />,
        accentClass: "bg-indigo-500",
        descriptionKey: "settings.mobile.aboutDescription",
      },
    ],
  },
];

export function SettingsPage(props: SettingsPageProps) {
  const {
    settings,
    setSettings,
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
    soul: t("settings.navSoul"),
    memory: t("settings.navMemory"),
    skills: t("settings.navSkills"),
    mcp: "MCP",
    hooks: t("settings.navHooks"),
    cron: t("settings.navCron"),
    ssh: t("settings.navSsh"),
    access: t("settings.navAccess"),
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
          .filter((item) => !hiddenSectionSet.has(item.id) && (!item.mobileOnly || nativeMobile))
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
      <div
        data-edge-swipe-ignore
        className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
      >
        {mobileDetailOpen ? (
          <main className="settings-mobile-detail flex min-h-0 flex-1 flex-col bg-background">
            <header className="relative z-10 flex min-h-14 shrink-0 items-center border-b border-border bg-background px-2.5">
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-full px-2.5 text-sm text-primary transition-colors active:bg-primary/10"
                aria-label={t("settings.mobile.backToSettings")}
              >
                <ArrowLeft className="h-4 w-4" />
                <span>{t("settings.title")}</span>
              </button>
              <div className="pointer-events-none absolute inset-x-24 text-center text-[15px] font-semibold tracking-tight">
                {sectionLabels[section]}
              </div>
              <div
                className="ml-auto flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground"
                title={saveIndicator.title}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${saveIndicator.dotClass}`} />
                <span className="sr-only">{saveIndicator.text}</span>
              </div>
            </header>

            <div
              key={section}
              data-settings-section={section}
              className={`settings-section-enter min-h-0 flex-1 px-3.5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3.5 ${
                section === "providers" || section === "memory" || section === "mcp"
                  ? "flex flex-col overflow-hidden"
                  : "overflow-y-auto overscroll-contain"
              }`}
            >
              <div
                className={`settings-section-shell ${
                  section === "providers" || section === "memory" || section === "mcp"
                    ? "flex min-h-0 flex-1 flex-col"
                    : "min-h-full"
                }`}
              >
                {sectionContent}
              </div>
            </div>
          </main>
        ) : (
          <main className="settings-mobile-home min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
            <header className="sticky top-0 z-10 flex min-h-14 items-center border-b border-border bg-background px-2.5">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-10 min-w-10 items-center justify-center rounded-full text-primary transition-colors active:bg-primary/10"
                aria-label={t("settings.backToChat")}
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="pointer-events-none absolute inset-x-16 text-center text-[17px] font-semibold tracking-tight">
                {t("settings.title")}
              </div>
              <div
                className="ml-auto flex h-10 items-center gap-1.5 px-2 text-[11px] text-muted-foreground"
                title={saveIndicator.title}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${saveIndicator.dotClass}`} />
                <span>{saveIndicator.text}</span>
              </div>
            </header>

            <div className="mx-auto w-full max-w-2xl px-4 pt-2">
              {navGroups.map((group) => (
                <section key={group.label} className="pt-4">
                  <h2 className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/75">
                    {group.label}
                  </h2>
                  <div className="overflow-hidden rounded-xl border border-border bg-background">
                    {group.items.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSection(item.id);
                          setMobileDetailOpen(true);
                        }}
                        className="group relative flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors active:bg-muted"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center text-foreground/75">
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-5 text-foreground">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
                            {item.description}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/45 transition-transform group-active:translate-x-0.5" />
                        {index < group.items.length - 1 ? (
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 ml-[50px] h-px bg-border/45" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </main>
        )}
      </div>
    );
  }

  return (
    <div
      data-edge-swipe-ignore
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 px-5">
        <h1 className="text-lg font-medium tracking-tight">{t("settings.title")}</h1>
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={t("settings.backToChat")}
          aria-label={t("settings.backToChat")}
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 p-5">
        <aside className="settings-sidebar flex w-[230px] shrink-0 flex-col">
          <label className="relative block">
            <span className="sr-only">{t("settings.searchPlaceholder")}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={t("settings.searchPlaceholder")}
              className="h-10 w-full rounded-lg border-0 bg-muted/55 pl-10 pr-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
            />
          </label>

          <nav className="settings-nav mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-4">
              {desktopNavGroups.map((group) => (
                <section key={group.label}>
                  <h2 className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                    {group.label}
                  </h2>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <NavItem
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        active={section === item.id}
                        onClick={() => setSection(item.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {visibleDesktopNavItems.length === 0 ? (
                <div className="rounded-xl px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("settings.searchEmpty")}
                </div>
              ) : null}
            </div>
          </nav>

          <div
            className="mt-3 flex items-center gap-2 px-3 text-xs text-muted-foreground"
            title={saveIndicator.title}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${saveIndicator.dotClass}`} />
            <span>{saveIndicator.text}</span>
          </div>
        </aside>

        <main
          key={section}
          className={`settings-section-enter min-w-0 flex-1 pr-2 ${
            section === "providers" || section === "memory" || section === "mcp"
              ? "flex min-h-0 flex-col overflow-hidden"
              : "overflow-y-auto overscroll-contain"
          }`}
        >
          <div
            className={`settings-section-shell ${
              section === "providers" || section === "memory" || section === "mcp"
                ? "flex min-h-0 flex-1 flex-col"
                : "min-h-full"
            }`}
          >
            {sectionContent}
          </div>
        </main>
      </div>
    </div>
  );
}
