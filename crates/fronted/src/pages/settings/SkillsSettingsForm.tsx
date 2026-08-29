import { Button as AstryxButton, Button } from "@astryxdesign/core/Button";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading as AstryxHeadingCore, Text as AstryxText } from "@astryxdesign/core/Text";
import { TextInput as AstryxInput } from "@astryxdesign/core/TextInput";
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
    <AstryxStack direction="vertical" className="settings-skills-section space-y-5">
      <AstryxStack
        direction="horizontal"
        className="settings-skills-header flex items-start justify-between gap-4"
      >
        <AstryxStack
          direction="horizontal"
          className="settings-skills-title flex items-center gap-2"
        >
          <AstryxStack
            direction="horizontal"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"
          >
            <Sparkles className="h-4 w-4 text-primary" />
          </AstryxStack>
          <AstryxStack direction="vertical">
            <AstryxHeadingCore level={3} className="text-sm font-semibold">
              Skills
            </AstryxHeadingCore>
            <AstryxText
              as="p"
              type="inherit"
              display="block"
              className="text-xs text-muted-foreground"
            >
              {t("settings.skillsDesc")}
            </AstryxText>
          </AstryxStack>
        </AstryxStack>

        <AstryxStack
          direction="horizontal"
          className="settings-skills-actions flex items-center gap-2"
        >
          {selectableSkills.length > 0 ? (
            <AstryxStack
              direction="horizontal"
              className="flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1"
            >
              <AstryxStack
                direction="vertical"
                className={`h-1.5 w-1.5 rounded-full ${
                  selectedCount > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"
                }`}
              />
              <AstryxText as="span" type="inherit" className="text-xs text-muted-foreground">
                <AstryxText as="span" type="inherit" className="font-medium text-foreground">
                  {selectedCount}
                </AstryxText>
                <AstryxText as="span" type="inherit" className="mx-0.5 text-muted-foreground/50">
                  /
                </AstryxText>
                <AstryxText as="span" type="inherit">
                  {selectableSkills.length}
                </AstryxText>
                <AstryxText as="span" type="inherit" className="ml-1">
                  {t("settings.skillsSelected")}
                </AstryxText>
              </AstryxText>
            </AstryxStack>
          ) : null}

          <Switch
            label={t("settings.skillsEnable")}
            isLabelHidden
            value={settings.skills.enabled}
            isDisabled={skillsLockedByChatMode}
            onChange={(enabled) => setSettings((prev) => updateSkills(prev, { enabled }))}
            size="sm"
          />

          <Button
            label={loading ? t("settings.skillsScanning") : t("settings.skillsScan")}
            variant="secondary"
            size="sm"
            className={`settings-section-action gap-1.5 transition-[color,background-color,border-color] ${loading ? "border-primary/40 bg-primary/5 text-primary" : ""}`}
            onClick={() => void refresh()}
            isDisabled={loading || skillsLockedByChatMode}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 transition-transform ${loading ? "animate-spin" : ""}`}
            />
            {loading ? t("settings.skillsScanning") : t("settings.skillsScan")}
            {loading && (
              <AstryxStack
                as="span"
                direction="horizontal"
                className="ml-0.5 inline-flex gap-[2px]"
              >
                <AstryxStack
                  as="span"
                  direction="vertical"
                  className="skills-scan-dot h-1 w-1 rounded-full bg-primary"
                />
                <AstryxStack
                  as="span"
                  direction="vertical"
                  className="skills-scan-dot h-1 w-1 rounded-full bg-primary"
                />
                <AstryxStack
                  as="span"
                  direction="vertical"
                  className="skills-scan-dot h-1 w-1 rounded-full bg-primary"
                />
              </AstryxStack>
            )}
          </Button>
        </AstryxStack>
      </AstryxStack>

      {skillsLockedByChatMode ? (
        <AstryxStack
          direction="horizontal"
          className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5"
        >
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <AstryxText as="span" type="inherit" className="text-xs text-muted-foreground">
            {t("settings.skillsDisabledInChatMode")}
          </AstryxText>
        </AstryxStack>
      ) : (
        <>
          {loadError ? (
            <AstryxStack
              direction="horizontal"
              className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <AstryxText as="span" type="inherit" className="text-xs text-destructive">
                {loadError}
              </AstryxText>
            </AstryxStack>
          ) : null}

          {!settings.skills.enabled ? (
            <AstryxStack
              direction="horizontal"
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5"
            >
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <AstryxText as="span" type="inherit" className="text-xs text-muted-foreground">
                {t("settings.skillsDisabledHint")}
              </AstryxText>
            </AstryxStack>
          ) : null}

          {!loading && skills.length === 0 && !loadError ? (
            <AstryxStack
              direction="vertical"
              className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 py-12 text-center"
            >
              <AstryxStack
                direction="horizontal"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-muted"
              >
                <BookOpen className="h-5 w-5 text-muted-foreground" />
              </AstryxStack>
              <AstryxStack direction="vertical" className="space-y-1">
                <AstryxText
                  as="p"
                  type="inherit"
                  display="block"
                  className="text-sm font-medium text-muted-foreground"
                >
                  {t("settings.skillsNotFound")}
                </AstryxText>
                <AstryxText
                  as="p"
                  type="inherit"
                  display="block"
                  className="text-xs text-muted-foreground/70"
                >
                  {t("settings.skillsNotFoundHint")}
                </AstryxText>
              </AstryxStack>
              <Button
                label={t("settings.skillsRescan")}
                variant="secondary"
                size="sm"
                className="mt-1 gap-1.5"
                onClick={() => void refresh()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("settings.skillsRescan")}
              </Button>
            </AstryxStack>
          ) : null}

          {loading && skills.length === 0 ? (
            <AstryxStack direction="vertical" className="space-y-3">
              {[1, 2, 3, 4].map((item) => (
                <AstryxStack
                  direction="vertical"
                  key={item}
                  className="skill-card-enter rounded-xl border border-border/40 p-4"
                >
                  <AstryxStack direction="horizontal" className="flex items-center gap-3">
                    <AstryxStack
                      direction="vertical"
                      className="skills-skeleton-shimmer h-9 w-9 shrink-0 rounded-lg"
                    />
                    <AstryxStack direction="vertical" className="flex-1 space-y-2">
                      <AstryxStack
                        direction="vertical"
                        className="skills-skeleton-shimmer h-3.5 w-28 rounded"
                      />
                      <AstryxStack
                        direction="vertical"
                        className="skills-skeleton-shimmer h-3 w-48 rounded"
                      />
                    </AstryxStack>
                    <AstryxStack
                      direction="vertical"
                      className="skills-skeleton-shimmer h-5 w-5 shrink-0 rounded-md"
                    />
                  </AstryxStack>
                </AstryxStack>
              ))}
            </AstryxStack>
          ) : null}

          {skills.length > 4 ? (
            <AstryxStack direction="vertical" className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <AstryxInput
                label={t("settings.skillsSearch")}
                isLabelHidden
                type="text"
                value={filter}
                onChange={(nextValue) => setFilter(nextValue)}
                placeholder={t("settings.skillsSearch")}
                className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-hidden transition-colors placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              />
            </AstryxStack>
          ) : null}

          {filtered.length > 0 ? (
            <AstryxStack direction="vertical" className="space-y-2">
              {filtered.map((skill) => {
                const alwaysEnabled = isAlwaysEnabledSkillName(skill.name);
                const checked = alwaysEnabled || selected.has(skill.name);
                const content = (
                  <>
                    <AstryxStack
                      direction="vertical"
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        checked
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground group-hover:bg-accent"
                      }`}
                    >
                      <Sparkles className="h-4 w-4" />
                    </AstryxStack>

                    <AstryxStack direction="vertical" className="min-w-0 flex-1">
                      <AstryxStack direction="horizontal" className="flex items-center gap-2">
                        <AstryxText
                          as="span"
                          type="inherit"
                          className="text-sm font-medium leading-none"
                        >
                          {skill.name}
                        </AstryxText>
                      </AstryxStack>
                      {skill.description ? (
                        <AstryxText
                          as="p"
                          type="inherit"
                          display="block"
                          className="mt-1 truncate text-xs text-muted-foreground"
                        >
                          {skill.description}
                        </AstryxText>
                      ) : null}
                      <AstryxStack
                        direction="horizontal"
                        className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/60"
                      >
                        <FileText className="h-3 w-3" />
                        <AstryxText as="span" type="inherit" className="truncate">
                          {skill.skillFile}
                        </AstryxText>
                      </AstryxStack>
                    </AstryxStack>

                    {alwaysEnabled ? (
                      <AstryxStack
                        direction="horizontal"
                        className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                        aria-label={t("settings.skillsAlwaysOn")}
                      >
                        <Lock className="h-3 w-3" />
                        <AstryxText as="span" type="inherit">
                          {t("settings.skillsAlwaysOn")}
                        </AstryxText>
                      </AstryxStack>
                    ) : (
                      <AstryxStack
                        direction="vertical"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-[color,background-color,border-color] duration-150 ${
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background group-hover:border-muted-foreground/40"
                        }`}
                      >
                        {checked ? <Check className="skill-check-enter h-3 w-3" /> : null}
                      </AstryxStack>
                    )}
                  </>
                );

                if (alwaysEnabled) {
                  return (
                    <AstryxStack
                      direction="horizontal"
                      key={`${skill.name}-${scanGeneration}`}
                      className="skill-card-enter flex w-full items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-left shadow-xs"
                    >
                      {content}
                    </AstryxStack>
                  );
                }

                return (
                  <AstryxButton
                    variant="ghost"
                    label={skill.name}
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
            </AstryxStack>
          ) : null}

          {filter.trim() && filtered.length === 0 && skills.length > 0 ? (
            <AstryxStack direction="vertical" className="py-8 text-center">
              <AstryxText
                as="p"
                type="inherit"
                display="block"
                className="text-sm text-muted-foreground"
              >
                {t("settings.skillsNoMatch").replace("{filter}", filter)}
              </AstryxText>
            </AstryxStack>
          ) : null}
        </>
      )}
    </AstryxStack>
  );
}
