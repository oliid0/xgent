import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  Section,
  VStack,
} from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { type FormEvent, useState } from "react";
import { ArrowLeft, Globe, Terminal } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  HOOK_EVENT_TRANSLATION_KEYS,
  HOOK_EVENTS,
  type HookDef,
  type HookEvent,
  type HookType,
} from "../../lib/automation";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import type { AppSettings } from "../../lib/settings";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { nativeHttpRequestEditor } from "../../presentation/nativeHttpRequestEditor";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import {
  createEmptyRequestDraft,
  type HttpRequestDraft,
  HttpRequestListEditor,
  parseHttpRequestDrafts,
  requestToDraft,
} from "./httpRequestEditor";
import { SettingsModalShell } from "./SettingsModalShell";
import { useAutomationFormOperation } from "./useAutomationFormOperation";

const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;

type HookModalProps = {
  settings?: AppSettings;
  nativeSettingsSurfaceId?: string;
  nativePresentationMode?: "root" | "sheet";
  event?: HookEvent;
  initialData?: HookDef;
  onSave: (data: Omit<HookDef, "id">) => void | Promise<void>;
  onClose: () => void;
};

export function HookModal({
  event,
  initialData,
  onSave,
  onClose,
  settings,
  nativeSettingsSurfaceId,
  nativePresentationMode,
}: HookModalProps) {
  const { t } = useLocale();
  const [name, setName] = useState(initialData?.name ?? "");
  const [selectedEvent, setSelectedEvent] = useState<HookEvent>(
    initialData?.event ?? event ?? HOOK_EVENTS[0],
  );
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [type, setType] = useState<HookType>(initialData?.type ?? "command");
  const [scriptText, setScriptText] = useState(initialData?.script ?? "");
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    initialData?.timeoutMs == null ? "" : String(Math.round(initialData.timeoutMs / 1000)),
  );
  const [requests, setRequests] = useState<HttpRequestDraft[]>(() => {
    if (initialData?.requests?.length) {
      return initialData.requests.map((request) => requestToDraft(request));
    }
    return [createEmptyRequestDraft()];
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const { isSaving, begin, finish } = useAutomationFormOperation();

  const isEditing = Boolean(initialData);
  const title = isEditing ? t("settings.hooksEdit") : t("settings.hooksAdd");
  const scriptLineCount = scriptText.split(/\r?\n/).filter((line) => line.trim()).length;

  async function handleSave() {
    const current = begin();
    if (!current) return;
    try {
      setFormError(null);
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error(t("settings.hooksNameRequired"));
      }
      const trimmedScript = scriptText.trim();
      if (type === "command" && !trimmedScript) {
        throw new Error(t("settings.hooksCommandRequired"));
      }
      const trimmedTimeout = timeoutSeconds.trim();
      const parsedTimeoutSeconds = trimmedTimeout ? Number(trimmedTimeout) : undefined;
      if (
        parsedTimeoutSeconds !== undefined &&
        (!Number.isSafeInteger(parsedTimeoutSeconds) || parsedTimeoutSeconds <= 0)
      ) {
        throw new Error(t("settings.hooksTimeoutInvalid"));
      }

      await onSave({
        event: selectedEvent,
        name: trimmedName,
        description: description.trim(),
        enabled: initialData?.enabled ?? true,
        type,
        script: type === "command" ? trimmedScript : undefined,
        requests: type === "http" ? parseHttpRequestDrafts(requests, t) : undefined,
        timeoutMs:
          type === "command" && parsedTimeoutSeconds !== undefined
            ? parsedTimeoutSeconds * 1000
            : undefined,
      });
      if (current()) onClose();
    } catch (error) {
      if (current()) setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      finish(current);
    }
  }

  function handleSubmit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    void handleSave();
  }

  function clearError() {
    setFormError(null);
  }

  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    const editable = !isSaving;
    const nodes: PresentationNode[] = [
      c.group("hook-basic", t("settings.hooksLifecycle"), [
        c.select(
          "hook-event",
          t("settings.hooksLifecycle"),
          selectedEvent,
          HOOK_EVENTS.map((value) => ({ value, label: t(HOOK_EVENT_TRANSLATION_KEYS[value]) })),
          (value) => {
            clearError();
            setSelectedEvent(value as HookEvent);
          },
          editable,
        ),
        c.input(
          "hook-name",
          t("settings.hooksName"),
          name,
          (value) => {
            clearError();
            setName(value);
          },
          false,
          editable,
        ),
        c.input(
          "hook-description",
          t("settings.hooksDescription"),
          description,
          (value) => {
            clearError();
            setDescription(value);
          },
          false,
          editable,
        ),
        c.select(
          "hook-type",
          t("settings.hooksType"),
          type,
          [
            { value: "command", label: t("settings.hooksTypeCommand") },
            { value: "http", label: t("settings.hooksTypeHttp") },
          ],
          (value) => {
            clearError();
            setType(value as HookType);
          },
          editable,
        ),
      ]),
      ...(type === "command"
        ? [
            {
              id: "hook-script-hint",
              kind: "Text" as const,
              text: t("settings.hooksCommandHint"),
              secondary: true,
            },
            {
              id: "hook-script-lines",
              kind: "Badge" as const,
              label: `${scriptLineCount} ${t("settings.hooksScriptLinesCount")} · ${t("settings.hooksSequential")}`,
            },
            {
              ...c.input(
                "hook-script",
                t("settings.hooksCommandList"),
                scriptText,
                (value) => {
                  clearError();
                  setScriptText(value);
                },
                false,
                editable,
              ),
              kind: "TextArea" as const,
              language: "bash",
              minHeight: 200,
            },
            c.input(
              "hook-timeout",
              t("settings.hooksTimeout"),
              timeoutSeconds,
              (value) => {
                if (!value || /^\d+$/.test(value)) {
                  clearError();
                  setTimeoutSeconds(value);
                }
              },
              false,
              editable,
            ),
          ]
        : [
            c.group("hook-http", t("settings.hooksHttpRequests"), [
              {
                id: "hook-http-hint",
                kind: "Text",
                text: t("settings.hooksHttpHint"),
                secondary: true,
              },
              {
                id: "hook-http-count",
                kind: "Badge",
                label: `${requests.length} ${t("settings.hooksRequestsCount")}`,
              },
              ...nativeHttpRequestEditor({
                controls: c,
                requests,
                expanded: expandedRequest,
                setExpanded: setExpandedRequest,
                setRequests,
                clearError,
                t,
                enabled: editable,
                idPrefix: "hook-http",
              }),
            ]),
          ]),
      ...(formError
        ? [
            {
              id: "hook-form-error",
              kind: "Banner" as const,
              label: formError,
              status: "error" as const,
            },
          ]
        : []),
      {
        ...c.action("hook-save", t("settings.save"), handleSave, editable && !!name.trim()),
        prominent: true,
      },
      c.action("hook-cancel", t("settings.cancel"), onClose, editable),
    ];
    c.handlers.set("close", {
      enabled: editable,
      accepts: (value) => value === null,
      run: onClose,
    });
    return (
      <NativeSurface
        sessionSurface={nativeSettingsSurfaceId}
        document={{
          mode: nativePresentationMode ?? "sheet",
          title,
          appearance: settings?.theme ?? "system",
          formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
          ...(settings
            ? {
                theme: createNativePresentationTheme(
                  settings,
                  isNativeMobileRuntime(),
                  "workspaceTools",
                ),
              }
            : {}),
          nodes,
          dismissAction: editable ? "close" : undefined,
        }}
        handlers={c.handlers}
        onError={(cause) => setFormError(cause instanceof Error ? cause.message : String(cause))}
      />
    );
  }

  return (
    <SettingsModalShell onClose={onClose} purpose="form" ariaLabel={title}>
      <VStack as="form" onSubmit={handleSubmit} height="100%" minHeight={0} gap={0}>
        <DialogHeader
          title={title}
          subtitle={t(HOOK_EVENT_TRANSLATION_KEYS[selectedEvent])}
          startContent={
            <IconButton
              label={t("settings.cancel")}
              tooltip={t("settings.cancel")}
              icon={<Icon icon={ArrowLeft} size="sm" color="inherit" />}
              variant="ghost"
              onClick={onClose}
            />
          }
        />
        <Layout
          height="fill"
          padding={0}
          content={
            <LayoutContent padding={5} isScrollable>
              <FormLayout direction="vertical">
                <Selector
                  label={t("settings.hooksLifecycle")}
                  value={selectedEvent}
                  width="100%"
                  options={HOOK_EVENTS.map((hookEvent) => ({
                    value: hookEvent,
                    label: t(HOOK_EVENT_TRANSLATION_KEYS[hookEvent]),
                  }))}
                  onChange={(value) => {
                    clearError();
                    setSelectedEvent(value as HookEvent);
                  }}
                />
                <HStack gap={1} wrap="wrap">
                  <Token label={selectedEvent} color="gray" size="sm" />
                  <Token
                    label={t(HOOK_EVENT_TRANSLATION_KEYS[selectedEvent])}
                    color="purple"
                    size="sm"
                  />
                </HStack>

                <FormLayout direction="horizontal">
                  <TextInput
                    label={t("settings.hooksName")}
                    value={name}
                    placeholder={t("settings.hooksNamePlaceholder")}
                    isRequired
                    width="100%"
                    onChange={(value) => {
                      clearError();
                      setName(value);
                    }}
                  />
                  <TextInput
                    label={t("settings.hooksDescription")}
                    value={description}
                    placeholder={t("settings.hooksDescriptionPlaceholder")}
                    isOptional
                    width="100%"
                    onChange={(value) => {
                      clearError();
                      setDescription(value);
                    }}
                  />
                </FormLayout>

                <Selector
                  label={t("settings.hooksType")}
                  value={type}
                  width="100%"
                  options={[
                    {
                      value: "command",
                      label: t("settings.hooksTypeCommand"),
                      description: t("settings.hooksCommandHint"),
                      icon: <Icon icon={Terminal} size="sm" color="inherit" />,
                    },
                    {
                      value: "http",
                      label: t("settings.hooksTypeHttp"),
                      description: t("settings.hooksHttpHint"),
                      icon: <Icon icon={Globe} size="sm" color="inherit" />,
                    },
                  ]}
                  onChange={(value) => {
                    clearError();
                    setType(value as HookType);
                  }}
                />

                {type === "command" ? (
                  <Section variant="transparent" padding={0}>
                    <VStack width="100%" gap={3}>
                      <HStack gap={1} wrap="wrap">
                        <Token
                          label={`${scriptLineCount} ${t("settings.hooksScriptLinesCount")}`}
                          color="blue"
                          size="sm"
                        />
                        <Token label={t("settings.hooksSequential")} color="gray" size="sm" />
                      </HStack>
                      <TextArea
                        label={t("settings.hooksCommandList")}
                        description={t("settings.hooksCommandHint")}
                        value={scriptText}
                        placeholder={"pnpm install\npnpm build\npnpm test"}
                        rows={9}
                        width="100%"
                        isRequired
                        hasSpellCheck={false}
                        startIcon={Terminal}
                        onChange={(value) => {
                          clearError();
                          setScriptText(value);
                        }}
                      />
                      <TextInput
                        label={t("settings.hooksTimeout")}
                        value={timeoutSeconds}
                        placeholder={String(DEFAULT_HOOK_TIMEOUT_SECONDS)}
                        width="100%"
                        isOptional
                        onChange={(value) => {
                          const next = value.trim();
                          if (next && !/^\d+$/.test(next)) return;
                          clearError();
                          setTimeoutSeconds(next);
                        }}
                      />
                    </VStack>
                  </Section>
                ) : (
                  <Section variant="transparent" padding={0}>
                    <VStack width="100%" gap={3}>
                      <HStack width="100%" gap={2} vAlign="center" wrap="wrap">
                        <Text type="body" weight="medium">
                          {t("settings.hooksHttpRequests")}
                        </Text>
                        <Token
                          label={`${requests.length} ${t("settings.hooksRequestsCount")}`}
                          color="green"
                          size="sm"
                        />
                        <Button
                          label={t("settings.add")}
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            clearError();
                            const draft = createEmptyRequestDraft();
                            setRequests((current) => [...current, draft]);
                            setExpandedRequest(draft.id);
                          }}
                        />
                      </HStack>
                      <HttpRequestListEditor
                        requests={requests}
                        expandedRequestId={expandedRequest}
                        onExpand={setExpandedRequest}
                        onChange={setRequests}
                        onDirty={clearError}
                        urlPlaceholder="https://example.com/hook"
                      />
                    </VStack>
                  </Section>
                )}

                {formError ? <Banner status="error" title={formError} collapsible={false} /> : null}
              </FormLayout>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack width="100%" gap={2} hAlign="end">
                <Button label={t("settings.cancel")} variant="secondary" onClick={onClose} />
                <Button
                  type="submit"
                  label={t("settings.save")}
                  variant="primary"
                  isDisabled={!name.trim() || isSaving}
                  isLoading={isSaving}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </VStack>
    </SettingsModalShell>
  );
}
