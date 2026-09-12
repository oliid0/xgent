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
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import type { AppSettings } from "../../lib/settings";
import { DEFAULT_SOUL_METADATA, type SoulDraft, useSoul, validateSoulDraft } from "../../lib/soul";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";

type SoulSectionProps = {
  createRequestId?: number;
  settings?: AppSettings;
  onBack?: () => void;
};

function createEmptySoulDraft(): SoulDraft {
  return {
    metadata: { ...DEFAULT_SOUL_METADATA, name: "" },
    body: "",
  };
}

export function SoulSection({ createRequestId = 0, settings, onBack }: SoulSectionProps) {
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

  if (isApplePresentationRuntime() && settings) {
    const compact = isNativeMobileRuntime();
    const c = presentationControls();
    c.handlers.set("close", {
      enabled: !soul.saving,
      accepts: (value) => value === null,
      run: () => onBack?.(),
    });
    const nodes: PresentationNode[] = [
      {
        id: "soul-description",
        kind: "Text",
        text: t("settings.soulDescription"),
        secondary: true,
      },
      c.group("soul-presets", t("settings.soulPresetsGroup"), [
        c.select(
          "soul-preset",
          t("settings.soulPresetsGroup"),
          soul.activeId,
          presetOptions.map(({ value, label }) => ({ value, label })),
          (value) => handleSelect(value),
        ),
        ...(creating
          ? [c.action("soul-cancel-create", t("settings.cancel"), cancelCreate, !soul.saving)]
          : [c.action("soul-create", t("settings.soulAddPreset"), beginCreate, !soul.saving)]),
        {
          ...c.action(
            "soul-delete",
            t("settings.soulDeletePreset"),
            () => setPresetToDelete(soul.activeId),
            !soul.saving && !creating && soul.presets.length > 1,
          ),
          destructive: true,
        },
        ...(creating
          ? [
              {
                id: "soul-create-hint",
                kind: "Banner" as const,
                label: t("settings.soulCreateDraftHint"),
                status: "pending" as const,
              },
            ]
          : []),
      ]),
      c.group("soul-identity", t("settings.soulIdentityGroup"), [
        c.input("soul-name", t("settings.soulName"), draft.metadata.name, (name) =>
          updateMetadata({ name: name.slice(0, 64) }),
        ),
        c.select(
          "soul-language",
          t("settings.soulLanguage"),
          draft.metadata.lang,
          [
            { value: "auto", label: t("settings.soulLanguageAuto") },
            { value: "zh-CN", label: "简体中文" },
            { value: "en-US", label: "English" },
            { value: "ja-JP", label: "日本語" },
            { value: "ko-KR", label: "한국어" },
          ],
          (lang) => updateMetadata({ lang }),
        ),
      ]),
      c.group("soul-voice", t("settings.soulVoiceGroup"), [
        c.input("soul-style", t("settings.soulStyle"), draft.metadata.style, (style) =>
          updateMetadata({ style }),
        ),
        {
          ...c.input("soul-body", t("settings.soulPersonality"), draft.body, (body) => {
            setSaved(false);
            setDraft((current) => ({ ...current, body }));
          }),
          kind: "TextArea",
          fill: true,
        },
        {
          id: "soul-count",
          kind: "Text",
          secondary: true,
          text: `${validation.bodyCount} / ${validation.bodyLimit} ${t(
            validation.countKind === "characters"
              ? "settings.soulCharacters"
              : "settings.soulWords",
          )}`,
        },
      ]),
      {
        ...c.action(
          "soul-save",
          soul.saving ? t("settings.saving") : t("settings.soulSave"),
          handleSave,
          changed && validation.valid && !soul.saving,
        ),
        prominent: true,
      },
      c.action("soul-reload", t("settings.soulReload"), soul.reload, !soul.loading && !soul.saving),
      ...(localError || soul.error
        ? [
            {
              id: "soul-error",
              kind: "Banner" as const,
              label: localError ?? soul.error ?? "",
              status: "error" as const,
            },
          ]
        : saved
          ? [
              {
                id: "soul-saved",
                kind: "Banner" as const,
                label: t("settings.soulSaved"),
                status: "completed" as const,
              },
            ]
          : []),
    ];
    const confirmation = presentationControls();
    const remove = confirmation.action(
      "confirm-delete",
      t("settings.soulDeletePreset"),
      handleDelete,
    );
    return (
      <>
        <NativeSurface
          document={{
            mode: "sheet",
            title: t("settings.soulTitle"),
            appearance: settings.theme,
            formFactor: compact ? "mobile" : "desktop",
            theme: createNativePresentationTheme(settings, compact, "workspaceTools"),
            nodes,
            dismissAction: soul.saving ? undefined : "close",
          }}
          handlers={c.handlers}
          onError={(cause) => setLocalError(cause instanceof Error ? cause.message : String(cause))}
        />
        {presetToDelete ? (
          <NativeSurface
            document={{
              mode: "alert",
              title: t("settings.soulDeletePreset"),
              appearance: settings.theme,
              formFactor: compact ? "mobile" : "desktop",
              theme: createNativePresentationTheme(settings, compact, "workspaceTools"),
              nodes: [
                {
                  id: "soul-delete-description",
                  kind: "Text",
                  text: t("settings.soulDeletePresetConfirm"),
                },
                { ...remove, destructive: true },
                confirmation.action("cancel-delete", t("settings.cancel"), () =>
                  setPresetToDelete(null),
                ),
              ],
              dismissAction: "cancel-delete",
            }}
            handlers={confirmation.handlers}
            onError={(cause) =>
              setLocalError(cause instanceof Error ? cause.message : String(cause))
            }
          />
        ) : null}
      </>
    );
  }

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
