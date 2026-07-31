import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../i18n";
import { type AppSettings, updateSkills } from "../../lib/settings";
import {
  discoverSkills,
  isAlwaysEnabledSkillName,
  mergeAlwaysEnabledSkillNames,
  readSkillText,
  type SkillSummary,
} from "../../lib/skills";
import { cn } from "../../lib/shared/utils";
import { Markdown } from "../Markdown";
import { ArrowLeft, Check, Loader2, RefreshCw, Search, SkillIcon } from "../icons";

type SkillsSidePanelProps = {
  settings: AppSettings;
  setSettings: (updater: (current: AppSettings) => AppSettings) => void;
};

export function SkillsSidePanel(props: SkillsSidePanelProps) {
  const { t } = useLocale();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ skill: SkillSummary; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const discovery = await discoverSkills({ force: true });
      setSkills(discovery.skills);
    } catch (reason) {
      setSkills([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => new Set(mergeAlwaysEnabledSkillNames(props.settings.skills.selected)),
    [props.settings.skills.selected],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, skills]);

  const toggle = (skill: SkillSummary) => {
    if (isAlwaysEnabledSkillName(skill.name)) return;
    const next = new Set(props.settings.skills.selected);
    if (next.has(skill.name)) next.delete(skill.name);
    else next.add(skill.name);
    props.setSettings((current) => updateSkills(current, { selected: Array.from(next) }));
  };

  const openPreview = async (skill: SkillSummary) => {
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await readSkillText({ path: skill.skillFile, offset: 0, length: 1200 });
      setPreview({ skill, content: result.content });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <section className="flex h-full w-[min(38vw,420px)] min-w-[340px] shrink-0 flex-col overflow-hidden border-r border-border/55 bg-[hsl(var(--sidebar-bg))]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/55 px-4">
        {preview ? (
          <button
            type="button"
            onClick={() => setPreview(null)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
            title={t("chat.cancel")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <SkillIcon className="h-4 w-4 text-amber-500" />
        )}
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {preview?.skill.name || "Skills"}
        </h2>
        {!preview ? (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            title={t("projectTools.fileTree.refresh")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        ) : null}
      </header>

      {preview ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-sm leading-6 text-muted-foreground">{preview.skill.description}</p>
          <Markdown
            content={preview.content}
            className="text-sm leading-6 text-foreground/90"
            renderMode="static"
          />
        </div>
      ) : (
        <>
          <div className="space-y-3 border-b border-border/45 px-4 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t("settings.searchPlaceholder")}
                className="h-9 w-full rounded-lg border border-border/60 bg-background/70 pl-9 pr-3 text-sm outline-hidden focus:border-foreground/30 focus:ring-2 focus:ring-foreground/10"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                props.setSettings((current) =>
                  updateSkills(current, { enabled: !current.skills.enabled }),
                )
              }
              className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-sm"
            >
              <span>{t("settings.skillsHubEnabled")}</span>
              <span
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  props.settings.skills.enabled ? "bg-foreground" : "bg-muted-foreground/25",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                    props.settings.skills.enabled ? "translate-x-[18px]" : "translate-x-0.5",
                  )}
                />
              </span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {loading ? (
              <div className="flex h-28 items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {t("settings.skillsImportEmpty")}
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map((skill) => {
                  const enabled = selected.has(skill.name);
                  return (
                    <div
                      key={`${skill.baseDir}:${skill.skillFile}`}
                      className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-foreground/[0.05]"
                    >
                      <button
                        type="button"
                        onClick={() => void openPreview(skill)}
                        disabled={previewLoading}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-background/70 text-amber-500">
                          <SkillIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{skill.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {skill.description}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(skill)}
                        disabled={isAlwaysEnabledSkillName(skill.name)}
                        title={enabled ? t("settings.disable") : t("settings.enable")}
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                          enabled
                            ? "border-foreground/30 bg-foreground text-background"
                            : "border-border text-transparent hover:text-muted-foreground",
                        )}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
