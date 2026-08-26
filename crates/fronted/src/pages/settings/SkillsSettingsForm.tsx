import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  FileText,
  Lock,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
} from "../../components/icons";

import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import { updateSkills } from "../../lib/settings";
import {
  discoverSkills,
  isAlwaysEnabledSkillName,
  isUserSelectableSkill,
  mergeAlwaysEnabledSkillNames,
  notifySkillsDiscoveryUpdated,
  type SkillSummary,
} from "../../lib/skills";
import type { SettingsSectionProps } from "./types";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Input as AstryxInput } from "@xagent/ui/components/ui/input";
import { Paragraph as AstryxParagraph } from "@xagent/ui/components/ui/view";
import { Heading as AstryxHeading } from "@xagent/ui/components/ui/view";

export function SkillsSettingsForm(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();
  const skillsLockedByChatMode = false;
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  /** Bumps on every successful scan to re-trigger entrance animations */
  const [scanGeneration, setScanGeneration] = useState(0);
  const hadSkillsBefore = useRef(false);

  async function refresh() {
    if (skillsLockedByChatMode) {
      setSkills([]);
      setLoadError(null);
      setLoading(false);
      return;
    }

    hadSkillsBefore.current = skills.length > 0;
    setLoading(true);
    setLoadError(null);
    try {
      const discovery = await discoverSkills({ force: true });
      setSkills(discovery.skills);
      setScanGeneration((g) => g + 1);
      notifySkillsDiscoveryUpdated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSkills([]);
      setLoadError(msg || "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [skillsLockedByChatMode]);

  const selected = new Set(mergeAlwaysEnabledSkillNames(settings.skills.selected));
  const selectableSkills = skills.filter(isUserSelectableSkill);
  const selectedCount = selectableSkills.filter((skill) => selected.has(skill.name)).length;

  const filtered = filter.trim()
    ? skills.filter(
        (skill) =>
          skill.name.toLowerCase().includes(filter.toLowerCase()) ||
          skill.description.toLowerCase().includes(filter.toLowerCase()),
      )
    : skills;

  function toggleSkill(name: string, on: boolean) {
    if (isAlwaysEnabledSkillName(name)) return;
    const next = new Set(settings.skills.selected);
    if (on) next.add(name);
    else next.delete(name);
    setSettings((prev) => updateSkills(prev, { selected: Array.from(next) }));
  }

  return (
    <AstryxView layout="block" direction="horizontal" className="settings-skills-section space-y-5">
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="settings-skills-header flex items-start justify-between gap-4"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-skills-actions flex items-center gap-2"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"
          >
            <Sparkles className="h-4 w-4 text-primary" />
          </AstryxView>
          <AstryxView layout="block" direction="horizontal">
            <AstryxHeading level={3} className="text-sm font-semibold">
              Skills
            </AstryxHeading>
            <AstryxParagraph className="text-xs text-muted-foreground">
              {t("settings.skillsDesc")}
            </AstryxParagraph>
          </AstryxView>
        </AstryxView>

        <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
          {selectableSkills.length > 0 ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1"
            >
              <AstryxView
                layout="block"
                direction="horizontal"
                className={`h-1.5 w-1.5 rounded-full ${
                  selectedCount > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"
                }`}
              />
              <AstryxInline className="text-xs text-muted-foreground">
                <AstryxInline className="font-medium text-foreground">{selectedCount}</AstryxInline>
                <AstryxInline className="mx-0.5 text-muted-foreground/50">/</AstryxInline>
                <AstryxInline>{selectableSkills.length}</AstryxInline>
                <AstryxInline className="ml-1">{t("settings.skillsSelected")}</AstryxInline>
              </AstryxInline>
            </AstryxView>
          ) : null}

          <AstryxButton
            type="button"
            role="switch"
            aria-checked={settings.skills.enabled ? "true" : "false"}
            aria-label={t("settings.skillsEnable")}
            disabled={skillsLockedByChatMode}
            onClick={() =>
              setSettings((prev) => updateSkills(prev, { enabled: !prev.skills.enabled }))
            }
            className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              settings.skills.enabled ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <AstryxInline
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
                settings.skills.enabled ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </AstryxButton>

          <Button
            variant="outline"
            size="sm"
            className={`settings-section-action gap-1.5 transition-[color,background-color,border-color] ${loading ? "border-primary/40 bg-primary/5 text-primary" : ""}`}
            onClick={() => void refresh()}
            disabled={loading || skillsLockedByChatMode}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 transition-transform ${loading ? "animate-spin" : ""}`}
            />
            {loading ? t("settings.skillsScanning") : t("settings.skillsScan")}
            {loading && (
              <AstryxView
                as="span"
                layout="inline-flex"
                direction="horizontal"
                className="ml-0.5 inline-flex gap-[2px]"
              >
                <AstryxInline className="skills-scan-dot h-1 w-1 rounded-full bg-primary" />
                <AstryxInline className="skills-scan-dot h-1 w-1 rounded-full bg-primary" />
                <AstryxInline className="skills-scan-dot h-1 w-1 rounded-full bg-primary" />
              </AstryxView>
            )}
          </Button>
        </AstryxView>
      </AstryxView>

      {skillsLockedByChatMode ? (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5"
        >
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <AstryxInline className="text-xs text-muted-foreground">
            {t("settings.skillsDisabledInChatMode")}
          </AstryxInline>
        </AstryxView>
      ) : (
        <>
          {loadError ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <AstryxInline className="text-xs text-destructive">{loadError}</AstryxInline>
            </AstryxView>
          ) : null}

          {!settings.skills.enabled ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5"
            >
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <AstryxInline className="text-xs text-muted-foreground">
                {t("settings.skillsDisabledHint")}
              </AstryxInline>
            </AstryxView>
          ) : null}

          {!loading && skills.length === 0 && !loadError ? (
            <AstryxView
              layout="flex"
              direction="vertical"
              className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-12 text-center"
            >
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-muted"
              >
                <BookOpen className="h-5 w-5 text-muted-foreground" />
              </AstryxView>
              <AstryxView layout="block" direction="horizontal" className="space-y-1">
                <AstryxParagraph className="text-sm font-medium text-muted-foreground">
                  {t("settings.skillsNotFound")}
                </AstryxParagraph>
                <AstryxParagraph className="text-xs text-muted-foreground/70">
                  {t("settings.skillsNotFoundHint")}
                </AstryxParagraph>
              </AstryxView>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 gap-1.5"
                onClick={() => void refresh()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("settings.skillsRescan")}
              </Button>
            </AstryxView>
          ) : null}

          {loading && skills.length === 0 ? (
            <AstryxView layout="block" direction="horizontal" className="space-y-3">
              {[1, 2, 3, 4].map((item) => (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  key={item}
                  className="skill-card-enter rounded-xl border border-border/40 p-4"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex items-center gap-3"
                  >
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="skills-skeleton-shimmer h-9 w-9 shrink-0 rounded-lg"
                    />
                    <AstryxView layout="block" direction="horizontal" className="flex-1 space-y-2">
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="skills-skeleton-shimmer h-3.5 w-28 rounded"
                      />
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="skills-skeleton-shimmer h-3 w-48 rounded"
                      />
                    </AstryxView>
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="skills-skeleton-shimmer h-5 w-5 shrink-0 rounded-md"
                    />
                  </AstryxView>
                </AstryxView>
              ))}
            </AstryxView>
          ) : null}

          {skills.length > 4 ? (
            <AstryxView layout="block" direction="horizontal" className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <AstryxInput
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
                placeholder={t("settings.skillsSearch")}
                className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-hidden transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              />
            </AstryxView>
          ) : null}

          {filtered.length > 0 ? (
            <AstryxView layout="block" direction="horizontal" className="space-y-2">
              {filtered.map((skill) => {
                const alwaysEnabled = isAlwaysEnabledSkillName(skill.name);
                const checked = alwaysEnabled || selected.has(skill.name);
                const content = (
                  <>
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        checked
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground group-hover:bg-accent"
                      }`}
                    >
                      <Sparkles className="h-4 w-4" />
                    </AstryxView>

                    <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex items-center gap-2"
                      >
                        <AstryxInline className="text-sm font-medium leading-none">
                          {skill.name}
                        </AstryxInline>
                      </AstryxView>
                      {skill.description ? (
                        <AstryxParagraph className="mt-1 truncate text-xs text-muted-foreground">
                          {skill.description}
                        </AstryxParagraph>
                      ) : null}
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/60"
                      >
                        <FileText className="h-3 w-3" />
                        <AstryxInline className="truncate">{skill.skillFile}</AstryxInline>
                      </AstryxView>
                    </AstryxView>

                    {alwaysEnabled ? (
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                        title={t("settings.skillsAlwaysOn")}
                      >
                        <Lock className="h-3 w-3" />
                        <AstryxInline>{t("settings.skillsAlwaysOn")}</AstryxInline>
                      </AstryxView>
                    ) : (
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-[color,background-color,border-color] duration-150 ${
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background group-hover:border-muted-foreground/40"
                        }`}
                      >
                        {checked ? <Check className="skill-check-enter h-3 w-3" /> : null}
                      </AstryxView>
                    )}
                  </>
                );

                if (alwaysEnabled) {
                  return (
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      key={`${skill.name}-${scanGeneration}`}
                      className="skill-card-enter flex w-full items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-left shadow-xs"
                    >
                      {content}
                    </AstryxView>
                  );
                }

                return (
                  <AstryxButton
                    key={`${skill.name}-${scanGeneration}`}
                    type="button"
                    onClick={() => toggleSkill(skill.name, !checked)}
                    className={`skill-card-enter group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-[color,background-color,border-color,box-shadow,transform] duration-150 ${
                      checked
                        ? "border-primary/40 bg-primary/5 shadow-xs"
                        : "border-border/60 bg-background hover:border-border hover:bg-accent/30"
                    }`}
                  >
                    {content}
                  </AstryxButton>
                );
              })}
            </AstryxView>
          ) : null}

          {filter.trim() && filtered.length === 0 && skills.length > 0 ? (
            <AstryxView layout="block" direction="horizontal" className="py-8 text-center">
              <AstryxParagraph className="text-sm text-muted-foreground">
                {t("settings.skillsNoMatch").replace("{filter}", filter)}
              </AstryxParagraph>
            </AstryxView>
          ) : null}
        </>
      )}
    </AstryxView>
  );
}
