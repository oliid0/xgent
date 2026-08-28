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
import { ArrowLeft, Globe, Plus, Terminal } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  HOOK_EVENT_TRANSLATION_KEYS,
  type HookDef,
  type HookEvent,
  type HookType,
} from "../../lib/automation";
import {
  createEmptyRequestDraft,
  type HttpRequestDraft,
  HttpRequestListEditor,
  parseHttpRequestDrafts,
  requestToDraft,
} from "./httpRequestEditor";
import { SettingsModalShell } from "./SettingsModalShell";

const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;

type HookModalProps = {
  event: HookEvent;
  initialData?: HookDef;
  onSave: (data: Omit<HookDef, "id">) => void | Promise<void>;
  onClose: () => void;
};

export function HookModal({ event, initialData, onSave, onClose }: HookModalProps) {
  const { t } = useLocale();
  const [name, setName] = useState(initialData?.name ?? "");
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
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = Boolean(initialData);
  const title = isEditing ? t("settings.hooksEdit") : t("settings.hooksAdd");
  const scriptLineCount = scriptText.split(/\r?\n/).filter((line) => line.trim()).length;

  async function handleSave() {
    try {
      setIsSaving(true);
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
        event,
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
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    void handleSave();
  }

  function clearError() {
    setFormError(null);
  }

  return (
    <SettingsModalShell onClose={onClose} purpose="form" ariaLabel={title}>
      <VStack as="form" onSubmit={handleSubmit} height="100%" minHeight={0} gap={0}>
        <DialogHeader
          title={title}
          subtitle={t(HOOK_EVENT_TRANSLATION_KEYS[event])}
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
                <HStack gap={1} wrap="wrap">
                  <Token label={event} color="gray" size="sm" />
                  <Token label={t(HOOK_EVENT_TRANSLATION_KEYS[event])} color="purple" size="sm" />
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
                          icon={<Icon icon={Plus} size="sm" color="inherit" />}
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
