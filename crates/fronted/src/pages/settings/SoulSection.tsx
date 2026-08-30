import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { StackItem } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "../../i18n";
import { DEFAULT_SOUL_METADATA, type SoulDraft, useSoul, validateSoulDraft } from "../../lib/soul";

type SoulSectionProps = {
  createRequestId?: number;
};

function createEmptySoulDraft(): SoulDraft {
  return {
    metadata: { ...DEFAULT_SOUL_METADATA, name: "" },
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
  const [presetToDelete, setPresetToDelete] = useState<string | null>(null);

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
    if (!presetId || (presetId === soul.activeId && !creating)) return;
    try {
      setCreating(false);
      await soul.select(presetId);
      setLocalError(null);
      setSaved(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDelete = async () => {
    const presetId = presetToDelete;
    if (!presetId) return;
    setPresetToDelete(null);
    try {
      await soul.remove(presetId);
      setLocalError(null);
      setSaved(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const presetOptions = soul.presets.map((preset) => ({
    value: preset.id,
    label: preset.metadata.name || t("settings.soulNewDefaultName"),
    description: preset.metadata.style || t("settings.soulPresetNoStyle"),
  }));

  return (
    <>
      <VStack width="100%" gap={5}>
        <HStack width="100%" gap={3} vAlign="start" wrap="wrap">
          <StackItem size="fill">
            <Text type="supporting" color="secondary">
              {t("settings.soulDescription")}
            </Text>
          </StackItem>
          <Button
            label={soul.saving ? t("settings.saving") : t("settings.soulSave")}
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            isLoading={soul.saving}
            isDisabled={!changed || !validation.valid}
          />
        </HStack>

        <VStack as="section" width="100%" gap={3}>
          <Heading level={4}>{t("settings.soulPresetsGroup")}</Heading>
          <HStack width="100%" gap={2} vAlign="end" wrap="wrap">
            <StackItem size="fill">
              <Selector
                label={t("settings.soulPresetsGroup")}
                isLabelHidden
                options={presetOptions}
                value={soul.activeId}
                onChange={(value) => void handleSelect(value)}
                width="100%"
                isLoading={soul.loading}
                isDisabled={soul.saving || presetOptions.length === 0}
              />
            </StackItem>
            {creating ? (
              <Button
                label={t("settings.cancel")}
                variant="ghost"
                size="sm"
                onClick={cancelCreate}
                isDisabled={soul.saving}
              />
            ) : (
              <Button
                label={t("settings.soulAddPreset")}
                variant="secondary"
                size="sm"
                onClick={beginCreate}
                isDisabled={soul.saving}
              />
            )}
            <Button
              label={t("settings.soulDeletePreset")}
              variant="ghost"
              size="sm"
              onClick={() => setPresetToDelete(soul.activeId)}
              isDisabled={soul.saving || creating || soul.presets.length <= 1}
            />
          </HStack>
          {creating ? <Banner status="info" title={t("settings.soulCreateDraftHint")} /> : null}
        </VStack>

        <VStack as="section" width="100%" gap={3}>
          <Heading level={4}>{t("settings.soulIdentityGroup")}</Heading>
          <FormLayout direction="horizontal-labels">
            <TextInput
              label={t("settings.soulName")}
              description={t("settings.soulNameHint")}
              type="text"
              value={draft.metadata.name}
              onChange={(value) => updateMetadata({ name: value.slice(0, 64) })}
              width="100%"
            />
            <Selector
              label={t("settings.soulLanguage")}
              description={t("settings.soulLanguageHint")}
              value={draft.metadata.lang}
              onChange={(lang) => updateMetadata({ lang })}
              options={[
                { value: "auto", label: t("settings.soulLanguageAuto") },
                { value: "zh-CN", label: "简体中文" },
                { value: "en-US", label: "English" },
                { value: "ja-JP", label: "日本語" },
                { value: "ko-KR", label: "한국어" },
              ]}
              width="100%"
            />
          </FormLayout>
        </VStack>

        <VStack as="section" width="100%" gap={3}>
          <Heading level={4}>{t("settings.soulVoiceGroup")}</Heading>
          <FormLayout>
            <TextInput
              label={t("settings.soulStyle")}
              description={t("settings.soulStyleHint")}
              value={draft.metadata.style}
              onChange={(value) => updateMetadata({ style: value })}
              placeholder={t("settings.soulStylePlaceholder")}
              width="100%"
            />
            <TextArea
              label={t("settings.soulPersonality")}
              description={t("settings.soulPersonalityHint")}
              value={draft.body}
              onChange={(value) => {
                setSaved(false);
                setDraft((current) => ({ ...current, body: value }));
              }}
              rows={10}
              width="100%"
              status={validation.valid ? undefined : { type: "error", message: validation.message }}
              statusVariant="detached"
            />
          </FormLayout>
          <HStack width="100%" hAlign="end">
            <Text type="supporting" color="secondary">
              {validation.bodyCount} / {validation.bodyLimit}{" "}
              {validation.countKind === "characters"
                ? t("settings.soulCharacters")
                : t("settings.soulWords")}
            </Text>
          </HStack>
        </VStack>

        {localError || soul.error ? (
          <Banner status="error" title={localError ?? soul.error} />
        ) : saved ? (
          <Banner
            status="success"
            title={t("settings.soulSaved")}
            isDismissable
            onDismiss={() => setSaved(false)}
          />
        ) : null}

        <HStack width="100%" hAlign="end">
          <Button
            label={t("settings.soulReload")}
            variant="ghost"
            size="sm"
            onClick={() => void soul.reload()}
            isLoading={soul.loading}
            isDisabled={soul.saving}
          />
        </HStack>
      </VStack>

      <AlertDialog
        isOpen={presetToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPresetToDelete(null);
        }}
        title={t("settings.soulDeletePreset")}
        description={t("settings.soulDeletePresetConfirm")}
        actionLabel={t("settings.soulDeletePreset")}
        cancelLabel={t("settings.cancel")}
        actionVariant="destructive"
        isActionLoading={soul.saving}
        onAction={handleDelete}
      />
    </>
  );
}
