import { Button as AstryxButton, Button } from "@astryxdesign/core/Button";
import { Grid as AstryxGrid } from "@astryxdesign/core/Grid";
import { Selector } from "@astryxdesign/core/Selector";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import {
  Heading as AstryxHeadingCore,
  Text as AstryxLabel,
  Text as AstryxText,
} from "@astryxdesign/core/Text";
import { TextArea as Textarea } from "@astryxdesign/core/TextArea";
import { TextInput as Input } from "@astryxdesign/core/TextInput";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, RefreshCw, Save, Sparkles, Trash2, X } from "../../components/icons";
import { useLocale } from "../../i18n";
import { DEFAULT_SOUL_METADATA, type SoulDraft, useSoul, validateSoulDraft } from "../../lib/soul";

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
    <AstryxStack direction="vertical" className="mx-auto w-full max-w-3xl space-y-6 pb-4">
      <AstryxStack direction="horizontal" className="flex items-start justify-between gap-4">
        <AstryxStack direction="horizontal" className="flex min-w-0 items-center gap-3">
          <AstryxStack
            direction="horizontal"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-500"
          >
            <Sparkles className="h-5 w-5" />
          </AstryxStack>
          <AstryxStack direction="vertical" className="min-w-0">
            <AstryxHeadingCore level={2} className="text-base font-semibold">
              {t("settings.soulTitle")}
            </AstryxHeadingCore>
            <AstryxText
              as="p"
              type="inherit"
              display="block"
              className="mt-0.5 text-xs leading-5 text-muted-foreground"
            >
              {t("settings.soulDescription")}
            </AstryxText>
          </AstryxStack>
        </AstryxStack>
        <Button
          variant="primary"
          label={soul.saving ? t("settings.saving") : t("settings.soulSave")}
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          isDisabled={!changed || soul.saving || !validation.valid}
          className="shrink-0 gap-1.5"
        >
          <Save className="h-3.5 w-3.5" />
          {soul.saving ? t("settings.saving") : t("settings.soulSave")}
        </Button>
      </AstryxStack>

      <AstryxStack direction="vertical" as="section">
        <AstryxStack
          direction="horizontal"
          className="mb-2 flex items-center justify-between gap-3 px-1"
        >
          <AstryxHeadingCore
            level={3}
            className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {t("settings.soulPresetsGroup")}
          </AstryxHeadingCore>
          <AstryxStack direction="horizontal" className="flex items-center gap-1.5">
            {creating ? (
              <Button
                label={t("settings.cancel")}
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancelCreate}
                isDisabled={soul.saving}
                className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
              >
                <X className="h-3.5 w-3.5" />
                {t("settings.cancel")}
              </Button>
            ) : null}
            <Button
              label={t("settings.soulAddPreset")}
              type="button"
              variant="ghost"
              size="sm"
              onClick={beginCreate}
              isDisabled={soul.saving || creating}
              className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("settings.soulAddPreset")}
            </Button>
          </AstryxStack>
        </AstryxStack>
        <AstryxStack
          direction="vertical"
          className="divide-y divide-border/55 overflow-hidden rounded-2xl border border-border/60 bg-card"
        >
          {soul.presets.map((preset) => {
            const active = preset.id === soul.activeId;
            return (
              <AstryxStack
                direction="horizontal"
                key={preset.id}
                className="flex min-h-14 items-center gap-3 px-3 py-2"
              >
                <AstryxButton
                  variant="ghost"
                  label={preset.metadata.style || t("settings.soulPresetNoStyle")}
                  type="button"
                  onClick={() => void handleSelect(preset.id)}
                  isDisabled={soul.saving}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left"
                >
                  <AstryxText
                    as="span"
                    type="inherit"
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      active ? "bg-violet-500 text-white" : "bg-violet-500/10 text-violet-500"
                    }`}
                  >
                    {active && !creating ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                  </AstryxText>
                  <AstryxText as="span" type="inherit" className="min-w-0 flex-1">
                    <AstryxText
                      as="span"
                      type="inherit"
                      className="block truncate text-sm font-medium"
                    >
                      {preset.metadata.name || t("settings.soulNewDefaultName")}
                    </AstryxText>
                    <AstryxText
                      as="span"
                      type="inherit"
                      className="block truncate text-xs text-muted-foreground"
                    >
                      {preset.metadata.style || t("settings.soulPresetNoStyle")}
                    </AstryxText>
                  </AstryxText>
                </AstryxButton>
                <Button
                  label={t("settings.soulDeletePreset")}
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => void handleDelete(preset.id)}
                  isDisabled={soul.saving || soul.presets.length <= 1}
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  tooltip={t("settings.soulDeletePreset")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AstryxStack>
            );
          })}
        </AstryxStack>
      </AstryxStack>

      {creating ? (
        <AstryxStack
          direction="vertical"
          className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-sm text-violet-700 dark:text-violet-300"
        >
          {t("settings.soulCreateDraftHint")}
        </AstryxStack>
      ) : null}

      <AstryxStack direction="vertical" as="section">
        <AstryxHeadingCore
          level={3}
          className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        >
          {t("settings.soulIdentityGroup")}
        </AstryxHeadingCore>
        <AstryxStack
          direction="vertical"
          className="divide-y divide-border/55 overflow-hidden rounded-2xl border border-border/60 bg-card"
        >
          <AstryxLabel
            as="label"
            type="label"
            weight="medium"
            className="grid min-h-16 grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.2fr)] sm:items-center"
          >
            <AstryxText as="span" type="inherit">
              <AstryxText as="span" type="inherit" className="block text-sm font-medium">
                {t("settings.soulName")}
              </AstryxText>
              <AstryxText
                as="span"
                type="inherit"
                className="mt-0.5 block text-xs text-muted-foreground"
              >
                {t("settings.soulNameHint")}
              </AstryxText>
            </AstryxText>
            <Input
              label={t("settings.soulName")}
              isLabelHidden
              {...({ maxLength: 64 } as const)}
              type="text"
              value={draft.metadata.name}
              onChange={(nextValue) => updateMetadata({ name: nextValue })}
              className="h-10 rounded-xl"
            />
          </AstryxLabel>
          <AstryxGrid className="grid min-h-16 grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.2fr)] sm:items-center">
            <AstryxText as="span" type="inherit">
              <AstryxText as="span" type="inherit" className="block text-sm font-medium">
                {t("settings.soulLanguage")}
              </AstryxText>
              <AstryxText
                as="span"
                type="inherit"
                className="mt-0.5 block text-xs text-muted-foreground"
              >
                {t("settings.soulLanguageHint")}
              </AstryxText>
            </AstryxText>
            <Selector
              label={t("settings.soulLanguage")}
              isLabelHidden
              width="100%"
              value={draft.metadata.lang}
              onChange={(lang) => updateMetadata({ lang })}
              options={[
                { value: "auto", label: t("settings.soulLanguageAuto") },
                { value: "zh-CN", label: "简体中文" },
                { value: "en-US", label: "English" },
                { value: "ja-JP", label: "日本語" },
                { value: "ko-KR", label: "한국어" },
              ]}
            />
          </AstryxGrid>
        </AstryxStack>
      </AstryxStack>

      <AstryxStack direction="vertical" as="section">
        <AstryxHeadingCore
          level={3}
          className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        >
          {t("settings.soulVoiceGroup")}
        </AstryxHeadingCore>
        <AstryxStack
          direction="vertical"
          className="space-y-4 rounded-2xl border border-border/60 bg-card p-4"
        >
          <AstryxLabel as="label" type="label" weight="medium" className="block">
            <AstryxText as="span" type="inherit" className="text-sm font-medium">
              {t("settings.soulStyle")}
            </AstryxText>
            <AstryxText
              as="span"
              type="inherit"
              className="mt-0.5 block text-xs text-muted-foreground"
            >
              {t("settings.soulStyleHint")}
            </AstryxText>
            <Input
              label={t("settings.soulStylePlaceholder")}
              isLabelHidden
              value={draft.metadata.style}
              onChange={(nextValue) => updateMetadata({ style: nextValue })}
              placeholder={t("settings.soulStylePlaceholder")}
              className="mt-2 h-10 rounded-xl"
            />
          </AstryxLabel>
          <AstryxLabel as="label" type="label" weight="medium" className="block">
            <AstryxText as="span" type="inherit" className="text-sm font-medium">
              {t("settings.soulPersonality")}
            </AstryxText>
            <AstryxText
              as="span"
              type="inherit"
              className="mt-0.5 block text-xs text-muted-foreground"
            >
              {t("settings.soulPersonalityHint")}
            </AstryxText>
            <Textarea
              label={t("settings.soulPersonality")}
              isLabelHidden
              value={draft.body}
              onChange={(nextValue) => {
                setSaved(false);
                setDraft((current) => ({ ...current, body: nextValue }));
              }}
              className="mt-2 min-h-56 resize-y rounded-xl font-mono text-[13px] leading-6"
            />
            <AstryxText
              as="span"
              type="inherit"
              className={`mt-2 block text-right text-[11px] tabular-nums ${
                validation.valid ? "text-muted-foreground" : "text-destructive"
              }`}
            >
              {validation.bodyCount} / {validation.bodyLimit}{" "}
              {validation.countKind === "characters"
                ? t("settings.soulCharacters")
                : t("settings.soulWords")}
            </AstryxText>
          </AstryxLabel>
        </AstryxStack>
      </AstryxStack>

      {localError || soul.error ? (
        <AstryxStack
          direction="vertical"
          className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {localError ?? soul.error}
        </AstryxStack>
      ) : saved ? (
        <AstryxStack
          direction="vertical"
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400"
        >
          {t("settings.soulSaved")}
        </AstryxStack>
      ) : null}

      <AstryxStack
        direction="horizontal"
        className="flex items-center justify-between gap-3 border-t border-border/55 pt-4"
      >
        <AstryxText
          as="p"
          type="inherit"
          display="block"
          className="min-w-0 truncate text-xs text-muted-foreground"
          aria-label={soul.document?.path}
        >
          {soul.document?.path || t("settings.soulLoading")}
        </AstryxText>
        <Button
          label={t("settings.soulReload")}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void soul.reload()}
          isDisabled={soul.loading || soul.saving}
          className="shrink-0 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${soul.loading ? "animate-spin" : ""}`} />
          {t("settings.soulReload")}
        </Button>
      </AstryxStack>
    </AstryxStack>
  );
}
