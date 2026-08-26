import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, RefreshCw, Save, Sparkles, Trash2, X } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { useLocale } from "../../i18n";
import { DEFAULT_SOUL_METADATA, type SoulDraft, useSoul, validateSoulDraft } from "../../lib/soul";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Paragraph as AstryxParagraph } from "@xagent/ui/components/ui/view";
import { Heading as AstryxHeading } from "@xagent/ui/components/ui/view";
import { Label as AstryxLabel } from "@xagent/ui/components/ui/label";

type SoulSectionProps = {
  createRequestId?: number;
};

function createEmptySoulDraft(): SoulDraft {
  return {
    metadata: {
      ...DEFAULT_SOUL_METADATA,
      name: "",
    },
    body: "",
  };
}

export function SoulSection({ createRequestId = 0 }: SoulSectionProps) {
  const { t } = useLocale();
  const soul = useSoul();
  const [draft, setDraft] = useState<SoulDraft>({
    metadata: DEFAULT_SOUL_METADATA,
    body: "",
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);

  const beginCreate = useCallback(() => {
    setCreating(true);
    setDraft(createEmptySoulDraft());
    setLocalError(null);
    setSaved(false);
  }, []);

  useEffect(() => {
    if (creating || !soul.document) return;
    setDraft({
      metadata: { ...soul.document.metadata },
      body: soul.document.body,
    });
    setLocalError(null);
  }, [creating, soul.document]);

  useEffect(() => {
    if (createRequestId > 0) beginCreate();
  }, [beginCreate, createRequestId]);

  const validation = useMemo(() => validateSoulDraft(draft), [draft]);
  const changed = creating
    ? true
    : soul.document
      ? draft.metadata.name !== soul.document.metadata.name ||
        draft.metadata.style !== soul.document.metadata.style ||
        draft.metadata.lang !== soul.document.metadata.lang ||
        draft.body !== soul.document.body
      : false;

  const updateMetadata = (patch: Partial<SoulDraft["metadata"]>) => {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      metadata: { ...current.metadata, ...patch },
    }));
  };

  const handleSave = async () => {
    if (!validation.valid) {
      setLocalError(validation.message);
      return;
    }
    try {
      if (creating) {
        await soul.create(draft);
        setCreating(false);
      } else {
        await soul.save(draft);
      }
      setLocalError(null);
      setSaved(true);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const cancelCreate = () => {
    setCreating(false);
    setLocalError(null);
    setSaved(false);
    if (soul.document) {
      setDraft({
        metadata: { ...soul.document.metadata },
        body: soul.document.body,
      });
    }
  };

  const handleSelect = async (presetId: string) => {
    if (presetId === soul.activeId && !creating) return;
    try {
      setCreating(false);
      await soul.select(presetId);
      setLocalError(null);
      setSaved(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDelete = async (presetId: string) => {
    try {
      await soul.remove(presetId);
      setLocalError(null);
      setSaved(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="mx-auto w-full max-w-3xl space-y-6 pb-4"
    >
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex items-start justify-between gap-4"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex min-w-0 items-center gap-3"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-500"
          >
            <Sparkles className="h-5 w-5" />
          </AstryxView>
          <AstryxView layout="block" direction="horizontal" className="min-w-0">
            <AstryxHeading level={2} className="text-base font-semibold">
              {t("settings.soulTitle")}
            </AstryxHeading>
            <AstryxParagraph className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {t("settings.soulDescription")}
            </AstryxParagraph>
          </AstryxView>
        </AstryxView>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!changed || soul.saving || !validation.valid}
          className="shrink-0 gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {soul.saving ? t("settings.saving") : t("settings.soulSave")}
        </Button>
      </AstryxView>

      <AstryxView as="section">
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="mb-2 flex items-center justify-between gap-3 px-1"
        >
          <AstryxHeading
            level={3}
            className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {t("settings.soulPresetsGroup")}
          </AstryxHeading>
          <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-1.5">
            {creating ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelCreate}
                disabled={soul.saving}
                className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
              >
                <X className="h-3.5 w-3.5" />
                {t("settings.cancel")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={beginCreate}
              disabled={soul.saving || creating}
              className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("settings.soulAddPreset")}
            </Button>
          </AstryxView>
        </AstryxView>
        <AstryxView
          layout="block"
          direction="horizontal"
          className="divide-y divide-border/55 overflow-hidden rounded-2xl border border-border/60 bg-card"
        >
          {soul.presets.map((preset) => {
            const active = preset.id === soul.activeId;
            return (
              <AstryxView
                layout="flex"
                direction="horizontal"
                key={preset.id}
                className="flex min-h-14 items-center gap-3 px-3 py-2"
              >
                <AstryxButton
                  type="button"
                  onClick={() => void handleSelect(preset.id)}
                  disabled={soul.saving}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left"
                >
                  <AstryxInline
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      active ? "bg-violet-500 text-white" : "bg-violet-500/10 text-violet-500"
                    }`}
                  >
                    {active && !creating ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                  </AstryxInline>
                  <AstryxInline className="min-w-0 flex-1">
                    <AstryxInline className="block truncate text-sm font-medium">
                      {preset.metadata.name || t("settings.soulNewDefaultName")}
                    </AstryxInline>
                    <AstryxInline className="block truncate text-xs text-muted-foreground">
                      {preset.metadata.style || t("settings.soulPresetNoStyle")}
                    </AstryxInline>
                  </AstryxInline>
                </AstryxButton>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void handleDelete(preset.id)}
                  disabled={soul.saving || soul.presets.length <= 1}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t("settings.soulDeletePreset")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AstryxView>
            );
          })}
        </AstryxView>
      </AstryxView>

      {creating ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-violet-700 dark:text-violet-300"
        >
          {t("settings.soulCreateDraftHint")}
        </AstryxView>
      ) : null}

      <AstryxView as="section">
        <AstryxHeading
          level={3}
          className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        >
          {t("settings.soulIdentityGroup")}
        </AstryxHeading>
        <AstryxView
          layout="block"
          direction="horizontal"
          className="divide-y divide-border/55 overflow-hidden rounded-2xl border border-border/60 bg-card"
        >
          <AstryxLabel className="grid min-h-16 grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.2fr)] sm:items-center">
            <AstryxInline>
              <AstryxInline className="block text-sm font-medium">
                {t("settings.soulName")}
              </AstryxInline>
              <AstryxInline className="mt-0.5 block text-xs text-muted-foreground">
                {t("settings.soulNameHint")}
              </AstryxInline>
            </AstryxInline>
            <Input
              value={draft.metadata.name}
              onChange={(event) => updateMetadata({ name: event.currentTarget.value })}
              maxLength={64}
              className="h-10 rounded-xl"
            />
          </AstryxLabel>
          <AstryxLabel className="grid min-h-16 grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.2fr)] sm:items-center">
            <AstryxInline>
              <AstryxInline className="block text-sm font-medium">
                {t("settings.soulLanguage")}
              </AstryxInline>
              <AstryxInline className="mt-0.5 block text-xs text-muted-foreground">
                {t("settings.soulLanguageHint")}
              </AstryxInline>
            </AstryxInline>
            <select
              value={draft.metadata.lang}
              onChange={(event) => updateMetadata({ lang: event.currentTarget.value })}
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="auto">{t("settings.soulLanguageAuto")}</option>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
              <option value="ja-JP">日本語</option>
              <option value="ko-KR">한국어</option>
            </select>
          </AstryxLabel>
        </AstryxView>
      </AstryxView>

      <AstryxView as="section">
        <AstryxHeading
          level={3}
          className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        >
          {t("settings.soulVoiceGroup")}
        </AstryxHeading>
        <AstryxView
          layout="block"
          direction="horizontal"
          className="space-y-4 rounded-2xl border border-border/60 bg-card p-4"
        >
          <AstryxLabel className="block">
            <AstryxInline className="text-sm font-medium">{t("settings.soulStyle")}</AstryxInline>
            <AstryxInline className="mt-0.5 block text-xs text-muted-foreground">
              {t("settings.soulStyleHint")}
            </AstryxInline>
            <Input
              value={draft.metadata.style}
              onChange={(event) => updateMetadata({ style: event.currentTarget.value })}
              placeholder={t("settings.soulStylePlaceholder")}
              className="mt-2 h-10 rounded-xl"
            />
          </AstryxLabel>
          <AstryxLabel className="block">
            <AstryxInline className="text-sm font-medium">
              {t("settings.soulPersonality")}
            </AstryxInline>
            <AstryxInline className="mt-0.5 block text-xs text-muted-foreground">
              {t("settings.soulPersonalityHint")}
            </AstryxInline>
            <Textarea
              value={draft.body}
              onChange={(event) => {
                setSaved(false);
                setDraft((current) => ({ ...current, body: event.currentTarget.value }));
              }}
              className="mt-2 min-h-56 resize-y rounded-xl font-mono text-[13px] leading-6"
            />
            <AstryxInline
              className={`mt-2 block text-right text-[11px] tabular-nums ${
                validation.valid ? "text-muted-foreground" : "text-destructive"
              }`}
            >
              {validation.bodyCount} / {validation.bodyLimit}{" "}
              {validation.countKind === "characters"
                ? t("settings.soulCharacters")
                : t("settings.soulWords")}
            </AstryxInline>
          </AstryxLabel>
        </AstryxView>
      </AstryxView>

      {localError || soul.error ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {localError ?? soul.error}
        </AstryxView>
      ) : saved ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400"
        >
          {t("settings.soulSaved")}
        </AstryxView>
      ) : null}

      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex items-center justify-between gap-3 border-t border-border/55 pt-4"
      >
        <AstryxParagraph
          className="min-w-0 truncate text-xs text-muted-foreground"
          title={soul.document?.path}
        >
          {soul.document?.path || t("settings.soulLoading")}
        </AstryxParagraph>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void soul.reload()}
          disabled={soul.loading || soul.saving}
          className="shrink-0 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${soul.loading ? "animate-spin" : ""}`} />
          {t("settings.soulReload")}
        </Button>
      </AstryxView>
    </AstryxView>
  );
}
