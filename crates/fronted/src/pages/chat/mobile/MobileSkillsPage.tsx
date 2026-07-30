import { useEffect, useMemo, useState } from "react";
import { Markdown } from "../../../components/Markdown";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  SkillIcon,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { type AppSettings, updateSkills } from "../../../lib/settings";
import {
  discoverSkills,
  isAlwaysEnabledSkillName,
  isUserSelectableSkill,
  readSkillText,
  type SkillSummary,
} from "../../../lib/skills";
import { MobileHubHeader, MobileHubSearch, MobileToggle } from "./MobileHubChrome";

type MobileSkillsPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  initialSkills?: SkillSummary[];
  onOpenSidebar: () => void;
};

type SkillPreview = {
  content: string;
  loading: boolean;
  error: string;
};

export function MobileSkillsPage(props: MobileSkillsPageProps) {
  const { t } = useLocale();
  const [skills, setSkills] = useState<SkillSummary[]>(props.initialSkills ?? []);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  const [preview, setPreview] = useState<SkillPreview>({
    content: "",
    loading: false,
    error: "",
  });

  useEffect(() => {
    setSkills(props.initialSkills ?? []);
  }, [props.initialSkills]);

  const visibleSkills = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, skills]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      const result = await discoverSkills({ force: true });
      setSkills(result.skills);
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!selected) {
      setPreview({ content: "", loading: false, error: "" });
      return;
    }
    let cancelled = false;
    setPreview({
      content: selected.inlineContent ?? "",
      loading: true,
      error: "",
    });
    void readSkillText({ path: selected.skillFile, offset: 0, length: 10_000 })
      .then((result) => {
        if (!cancelled) {
          setPreview({ content: result.content, loading: false, error: "" });
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setPreview({
            content: selected.inlineContent ?? "",
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const isSelected = (skill: SkillSummary) =>
    isAlwaysEnabledSkillName(skill.name) || props.settings.skills.selected.includes(skill.name);

  const toggle = (skill: SkillSummary, enabled: boolean) => {
    if (!isUserSelectableSkill(skill)) return;
    props.setSettings((prev) => {
      const next = new Set(prev.skills.selected);
      if (enabled) next.add(skill.name);
      else next.delete(skill.name);
      return updateSkills(prev, {
        enabled: enabled ? true : prev.skills.enabled,
        selected: Array.from(next),
      });
    });
  };

  if (selected) {
    return (
      <section className="flex h-full min-h-0 flex-1 flex-col bg-background">
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/40 px-3 pt-[env(safe-area-inset-top,0px)]">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-muted"
            aria-label={t("settings.close")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[18px] font-semibold">{selected.name}</h1>
            <p className="truncate text-[11px] text-muted-foreground">{selected.skillFile}</p>
          </div>
          <MobileToggle
            checked={isSelected(selected)}
            disabled={!isUserSelectableSkill(selected)}
            label={isSelected(selected) ? t("settings.disable") : t("settings.enable")}
            onChange={(checked) => toggle(selected, checked)}
          />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-5">
          {selected.description ? (
            <p className="mb-5 text-[14px] leading-6 text-muted-foreground">
              {selected.description}
            </p>
          ) : null}
          {preview.loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("settings.skillsScanning")}
            </div>
          ) : null}
          {preview.error ? (
            <div className="mb-4 rounded-2xl bg-destructive/8 px-4 py-3 text-[12px] text-destructive">
              {preview.error}
            </div>
          ) : null}
          {preview.content ? <Markdown>{preview.content}</Markdown> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <MobileHubHeader
        title="Skills"
        onOpenSidebar={props.onOpenSidebar}
        trailing={
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex h-10 w-10 items-center justify-center rounded-full active:bg-muted"
            aria-label={t("settings.skillsRescan")}
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        }
      />
      <MobileHubSearch value={query} onChange={setQuery} placeholder="Search Skills" />

      <div className="mx-5 mt-4 flex min-h-14 items-center gap-3 rounded-2xl border border-border/50 px-4">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">{t("settings.skillsEnable")}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {props.settings.skills.enabled
              ? t("settings.skillsHubEnabled")
              : t("settings.skillsHubDisabled")}
          </div>
        </div>
        <MobileToggle
          checked={props.settings.skills.enabled}
          label={t("settings.skillsEnable")}
          onChange={(enabled) =>
            props.setSettings((prev) => updateSkills(prev, { enabled }))
          }
        />
      </div>
      {refreshError ? (
        <div className="mx-5 mt-3 rounded-2xl bg-destructive/8 px-4 py-3 text-[12px] text-destructive">
          {refreshError}
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between px-5">
        <h2 className="text-[18px] font-semibold">{t("settings.skillsHubInstalledTab")}</h2>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {visibleSkills.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] pt-4">
        {visibleSkills.map((skill) => (
          <article
            key={`${skill.baseDir}:${skill.name}`}
            className="flex min-h-[76px] items-center gap-3 rounded-[1.35rem] px-2 py-2 active:bg-muted/65"
          >
            <button
              type="button"
              onClick={() => setSelected(skill)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/45 bg-background shadow-sm">
                <SkillIcon className="h-7 w-7" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{skill.name}</span>
                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                  {skill.description}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            </button>
            <MobileToggle
              checked={isSelected(skill)}
              disabled={!isUserSelectableSkill(skill)}
              label={isSelected(skill) ? t("settings.disable") : t("settings.enable")}
              onChange={(checked) => toggle(skill, checked)}
            />
          </article>
        ))}
        {!refreshing && visibleSkills.length === 0 ? (
          <div className="flex flex-col items-center px-8 py-20 text-center text-muted-foreground">
            <MoreHorizontal className="mb-3 h-7 w-7" />
            <p className="text-sm">{t("settings.skillsNotFound")}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
