import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  Section,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Selector } from "@astryxdesign/core/Selector";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState } from "react";
import {
  ArrowLeft,
  Clock3,
  Folder,
  FolderOpen,
  Globe,
  MessageSquare,
  Terminal,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  type CronTask,
  type CronTaskType,
  DEFAULT_CRON_TIMEOUT_SECONDS,
  MAX_CRON_TIMEOUT_SECONDS,
  MIN_CRON_TIMEOUT_SECONDS,
  validateCronExpression,
} from "../../lib/automation";
import { parseModelValue, toModelValue } from "../../lib/providers/llm";
import { type ExecutionMode, isAgentExecutionMode } from "../../lib/settings";
import {
  createEmptyRequestDraft,
  type HttpRequestDraft,
  HttpRequestListEditor,
  parseHttpRequestDrafts,
  requestToDraft,
} from "./httpRequestEditor";
import { ModelPicker, type ModelPickerOption } from "./modelPicker";
import { SettingsModalShell } from "./SettingsModalShell";

export type CronPromptModelOption = ModelPickerOption;

export type CronWorkspaceOption = {
  path: string;
  name: string;
};

/**
 * Radix SelectItem rejects an empty-string value at runtime, so "follow the
 * active workspace" (stored as an empty workdir) uses this sentinel in the
 * select and is mapped back to "" on save.
 */
const FOLLOW_ACTIVE_WORKSPACE_VALUE = "__follow-active-workspace__";

/**
 * "Custom path" entry: the CronTaskManager tool can pin arbitrary paths, so
 * the form offers a free-form path input alongside the workspace list.
 */
const CUSTOM_WORKDIR_VALUE = "__custom-workdir__";

/**
 * Windows paths reach us in several spellings ("\\" vs "/", drive-letter
 * case, trailing separators) depending on which picker produced them, so a
 * pinned workspace path must match its workspace entry shape-insensitively.
 * POSIX paths stay case-sensitive.
 */
function comparableWorkdirPath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) return "";
  const isWindowsShape = /^[A-Za-z]:/.test(normalized) || normalized.startsWith("//");
  const comparable = isWindowsShape ? normalized.toLowerCase() : normalized;
  if (comparable === "/" || /^[a-z]:\/$/.test(comparable)) return comparable;
  return comparable.replace(/\/+$/, "");
}

function findWorkspaceOptionByPath(options: CronWorkspaceOption[], path: string) {
  const target = comparableWorkdirPath(path);
  if (!target) return null;
  return options.find((option) => comparableWorkdirPath(option.path) === target) ?? null;
}

const CRON_REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type CronReasoningLevel = (typeof CRON_REASONING_LEVELS)[number];

const DEFAULT_CRON_REASONING: CronReasoningLevel = "medium";

const REASONING_LEVEL_I18N_KEYS: Record<CronReasoningLevel, string> = {
  off: "settings.reasoning.off",
  minimal: "settings.reasoning.minimal",
  low: "settings.reasoning.low",
  medium: "settings.reasoning.medium",
  high: "settings.reasoning.high",
  xhigh: "settings.reasoning.xhigh",
  max: "settings.reasoning.max",
};

function isCronReasoningLevel(value: string): value is CronReasoningLevel {
  return (CRON_REASONING_LEVELS as readonly string[]).includes(value);
}

/**
 * Fields the modal edits. `enabled` is deliberately not part of the payload:
 * toggling is its own operation, so saving an edit can never write back a
 * stale enabled flag captured when the modal opened.
 */
export type CronTaskFormData = Omit<CronTask, "id" | "enabled" | "lastError">;

type CronTaskModalProps = {
  mode: "add" | "edit";
  initialData?: CronTask;
  modelOptions: CronPromptModelOption[];
  workspaceOptions: CronWorkspaceOption[];
  executionMode: ExecutionMode;
  /**
   * Platform directory picker injected by each end's CronSection (native
   * dialog on desktop, remote path prompt on the WebUI). The browse button
   * is hidden when absent.
   */
  onPickWorkdir?: (initialWorkdir: string) => Promise<string | null>;
  onSave: (data: CronTaskFormData) => void | Promise<void>;
  onClose: () => void;
};

export function CronTaskModal({
  mode,
  initialData,
  modelOptions,
  workspaceOptions,
  executionMode,
  onPickWorkdir,
  onSave,
  onClose,
}: CronTaskModalProps) {
  const { t } = useLocale();
  const autoPromptSupported = isAgentExecutionMode(executionMode);

  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [cron, setCron] = useState(initialData?.cron ?? "");
  const [remainingExecutions, setRemainingExecutions] = useState<number | null>(
    initialData?.remainingExecutions ?? null,
  );
  // Prefilled with the effective value: tasks saved before the field existed
  // run with the default, so showing it is truthful 鈥?and clearing the input
  // simply falls back to the same default on save.
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    initialData?.timeoutSeconds ?? DEFAULT_CRON_TIMEOUT_SECONDS,
  );
  const [type, setType] = useState<CronTaskType>(initialData?.type ?? "bash");
  const [scriptText, setScriptText] = useState(initialData?.script ?? "");
  const [requests, setRequests] = useState<HttpRequestDraft[]>(() => {
    if (initialData?.requests?.length) {
      return initialData.requests.map((request) => requestToDraft(request));
    }
    return [createEmptyRequestDraft()];
  });
  const [prompt, setPrompt] = useState(initialData?.prompt ?? "");
  const [reasoning, setReasoning] = useState<CronReasoningLevel>(() => {
    const initial = initialData?.reasoning ?? "";
    return isCronReasoningLevel(initial) ? initial : DEFAULT_CRON_REASONING;
  });
  // A Windows pin may spell the same directory differently than the
  // workspace list ("\\" vs "/", drive-letter case); snap it to the list
  // entry's exact spelling so the Select matches it by value.
  const [workdir, setWorkdir] = useState(() => {
    const initialWorkdir = initialData?.workdir ?? "";
    if (!initialWorkdir) return "";
    return findWorkspaceOptionByPath(workspaceOptions, initialWorkdir)?.path ?? initialWorkdir;
  });
  // A pinned path outside the workspace list (e.g. set by the CronTaskManager
  // tool, or whose workspace was removed) opens in custom-path mode so the
  // user sees and can edit the raw path.
  const [customWorkdir, setCustomWorkdir] = useState(() => {
    const initialWorkdir = initialData?.workdir ?? "";
    return Boolean(initialWorkdir && !findWorkspaceOptionByPath(workspaceOptions, initialWorkdir));
  });
  const [selectedModelValue, setSelectedModelValue] = useState(() =>
    initialData?.selectedModel
      ? toModelValue(initialData.selectedModel.customProviderId, initialData.selectedModel.model)
      : "",
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const promptModelOptions =
    selectedModelValue &&
    !modelOptions.some((option) => option.value === selectedModelValue) &&
    initialData?.selectedModel
      ? [
          ...modelOptions,
          {
            value: selectedModelValue,
            label: initialData.selectedModel.model,
            providerName: initialData.selectedModel.customProviderId,
          },
        ]
      : modelOptions;

  const formReady =
    Boolean(name.trim()) &&
    Boolean(cron.trim()) &&
    (type !== "bash" || Boolean(scriptText.trim())) &&
    (type !== "prompt" || Boolean(prompt.trim() && parseModelValue(selectedModelValue)));

  async function handleSave() {
    try {
      setIsSaving(true);
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error(`${t("settings.cronTaskName")} is required`);
      if (!cron.trim()) throw new Error(`${t("settings.cronExpression")} is required`);
      const parsedRemainingExecutions = remainingExecutions ?? undefined;
      if (
        parsedRemainingExecutions !== undefined &&
        (!Number.isSafeInteger(parsedRemainingExecutions) || parsedRemainingExecutions < 0)
      ) {
        throw new Error(t("settings.cronRemainingExecutionsInvalid"));
      }
      const parsedTimeoutSeconds = timeoutSeconds;
      if (
        !Number.isSafeInteger(parsedTimeoutSeconds) ||
        parsedTimeoutSeconds < MIN_CRON_TIMEOUT_SECONDS ||
        parsedTimeoutSeconds > MAX_CRON_TIMEOUT_SECONDS
      ) {
        throw new Error(t("settings.cronTimeoutSecondsInvalid"));
      }

      await validateCronExpression(cron.trim());

      const trimmedPrompt = prompt.trim();
      const trimmedScript = scriptText.trim();
      const parsedSelectedModel = type === "prompt" ? parseModelValue(selectedModelValue) : null;
      if (type === "bash" && !trimmedScript) {
        throw new Error(t("settings.cronCommandRequired"));
      }
      if (type === "prompt") {
        if (!autoPromptSupported) {
          throw new Error(t("settings.cronPromptAgentModeRequired"));
        }
        if (!trimmedPrompt) {
          throw new Error(t("settings.cronPromptRequired"));
        }
        if (!parsedSelectedModel) {
          throw new Error(
            promptModelOptions.length === 0
              ? t("settings.cronPromptModelEmpty")
              : t("settings.cronPromptModelRequired"),
          );
        }
      }

      const data: CronTaskFormData = {
        name: trimmedName,
        description: description.trim(),
        cron: cron.trim(),
        remainingExecutions: parsedRemainingExecutions,
        timeoutSeconds: parsedTimeoutSeconds,
        type,
        script: type === "bash" ? trimmedScript : undefined,
        requests: type === "http" ? parseHttpRequestDrafts(requests, t) : undefined,
        prompt: type === "prompt" ? trimmedPrompt : undefined,
        selectedModel: type === "prompt" ? (parsedSelectedModel ?? undefined) : undefined,
        // Prompt tasks always carry a concrete level (default "medium");
        // other kinds clear the field.
        reasoning: type === "prompt" ? reasoning : "",
        // Always carried: an empty string is the explicit "follow the active
        // workspace" signal 鈥?omitting the key would make merge_patch keep a
        // stale pin forever.
        workdir: type === "http" ? "" : workdir.trim(),
      };

      await onSave(data);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  const scriptLineCount = scriptText.split(/\r?\n/).filter((l) => l.trim()).length;

  const modalTitle = mode === "add" ? t("settings.cronModalAdd") : t("settings.cronModalEdit");

  return (
    <SettingsModalShell onClose={onClose} purpose="form" ariaLabel={modalTitle}>
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider>
            <HStack gap={3} vAlign="center">
              <IconButton
                label={t("settings.cancel")}
                tooltip={t("settings.cancel")}
                icon={<ArrowLeft aria-hidden="true" />}
                variant="ghost"
                size="sm"
                onClick={onClose}
              />
              <Clock3 aria-hidden="true" />
              <StackItem size="fill">
                <VStack gap={0.5}>
                  <Heading level={3}>{modalTitle}</Heading>
                  <Text type="supporting" color="secondary">
                    {t("settings.cronExpressionHint")}
                  </Text>
                </VStack>
              </StackItem>
            </HStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={0} isScrollable>
            <VStack gap={0}>
              {formError ? (
                <Banner
                  status="error"
                  title={formError}
                  container="section"
                  isDismissable
                  onDismiss={() => setFormError(null)}
                />
              ) : null}

              <Section variant="transparent" padding={5} dividers={["bottom"]}>
                <VStack gap={4}>
                  <Heading level={4}>{t("settings.cronStepBasic")}</Heading>
                  <FormLayout>
                    <FormLayout direction="horizontal">
                      <TextInput
                        label={t("settings.cronTaskName")}
                        value={name}
                        placeholder={t("settings.cronTaskNamePlaceholder")}
                        isRequired
                        onChange={(value) => {
                          setFormError(null);
                          setName(value);
                        }}
                      />
                      <TextInput
                        label={t("settings.cronExpression")}
                        value={cron}
                        placeholder={t("settings.cronExpressionPlaceholder")}
                        isRequired
                        onChange={(value) => {
                          setFormError(null);
                          setCron(value);
                        }}
                      />
                    </FormLayout>
                    <FormLayout direction="horizontal">
                      <NumberInput
                        label={t("settings.cronRemainingExecutions")}
                        value={remainingExecutions}
                        min={0}
                        step={1}
                        isIntegerOnly
                        hasClear
                        isWheelEnabled={false}
                        placeholder={t("settings.cronRemainingExecutionsPlaceholder")}
                        onChange={(value) => {
                          setFormError(null);
                          setRemainingExecutions(value ?? null);
                        }}
                      />
                      <NumberInput
                        label={t("settings.cronTimeoutSeconds")}
                        value={timeoutSeconds}
                        min={MIN_CRON_TIMEOUT_SECONDS}
                        max={MAX_CRON_TIMEOUT_SECONDS}
                        step={1}
                        units={t("settings.cronTimeoutSecondsUnitShort")}
                        isIntegerOnly
                        isWheelEnabled={false}
                        onChange={(value) => {
                          setFormError(null);
                          setTimeoutSeconds(value);
                        }}
                      />
                    </FormLayout>
                    <TextInput
                      label={t("settings.cronTaskDesc")}
                      value={description}
                      placeholder={t("settings.cronTaskDescPlaceholder")}
                      onChange={(value) => {
                        setFormError(null);
                        setDescription(value);
                      }}
                    />
                  </FormLayout>
                </VStack>
              </Section>

              <Section variant="transparent" padding={5} dividers={["bottom"]}>
                <VStack gap={4}>
                  <Heading level={4}>{t("settings.cronStepType")}</Heading>
                  <RadioList
                    label={t("settings.cronStepType")}
                    isLabelHidden
                    value={type}
                    orientation="vertical"
                    onChange={(value) => {
                      if (value !== "bash" && value !== "http" && value !== "prompt") return;
                      setFormError(null);
                      setType(value);
                    }}
                  >
                    <RadioListItem
                      value="bash"
                      label={t("settings.cronTypeBash")}
                      description={t("settings.cronTypeBashHint")}
                      startContent={<Terminal aria-hidden="true" />}
                    />
                    <RadioListItem
                      value="http"
                      label={t("settings.cronTypeHttp")}
                      description={t("settings.cronTypeHttpHint")}
                      startContent={<Globe aria-hidden="true" />}
                    />
                    <RadioListItem
                      value="prompt"
                      label={t("settings.cronTypePrompt")}
                      description={t("settings.cronTypePromptHint")}
                      startContent={<MessageSquare aria-hidden="true" />}
                    />
                  </RadioList>
                </VStack>
              </Section>

              <Section variant="transparent" padding={5}>
                <VStack gap={4}>
                  <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
                    <VStack gap={0.5}>
                      <Heading level={4}>{t("settings.cronStepConfig")}</Heading>
                      {type === "bash" ? (
                        <Text type="supporting" color="secondary">
                          {scriptLineCount} {t("settings.cronCommandsCount")}
                        </Text>
                      ) : type === "http" ? (
                        <Text type="supporting" color="secondary">
                          {requests.length} {t("settings.cronRequestsCount")}
                        </Text>
                      ) : null}
                    </VStack>
                    {type === "http" ? (
                      <Button
                        label={t("settings.add")}
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setFormError(null);
                          const draft = createEmptyRequestDraft();
                          setRequests((current) => [...current, draft]);
                          setExpandedRequest(draft.id);
                        }}
                      />
                    ) : null}
                  </HStack>

                  {type !== "http" ? (
                    <FormLayout>
                      <Selector
                        label={t("settings.cronWorkdirLabel")}
                        width="100%"
                        startIcon={<Folder aria-hidden="true" />}
                        value={
                          customWorkdir
                            ? CUSTOM_WORKDIR_VALUE
                            : workdir || FOLLOW_ACTIVE_WORKSPACE_VALUE
                        }
                        options={[
                          {
                            value: FOLLOW_ACTIVE_WORKSPACE_VALUE,
                            label: t("settings.cronWorkdirFollowActive"),
                          },
                          {
                            value: CUSTOM_WORKDIR_VALUE,
                            label: t("settings.cronWorkdirCustom"),
                          },
                          ...(workspaceOptions.length > 0 ? [{ type: "divider" as const }] : []),
                          ...workspaceOptions.map((option) => ({
                            value: option.path,
                            label: option.name,
                            description: option.path,
                          })),
                        ]}
                        onChange={(value) => {
                          setFormError(null);
                          if (value === FOLLOW_ACTIVE_WORKSPACE_VALUE) {
                            setCustomWorkdir(false);
                            setWorkdir("");
                          } else if (value === CUSTOM_WORKDIR_VALUE) {
                            setCustomWorkdir(true);
                          } else {
                            setCustomWorkdir(false);
                            setWorkdir(value);
                          }
                        }}
                      />
                      {customWorkdir ? (
                        <HStack gap={2} vAlign="end">
                          <StackItem size="fill">
                            <TextInput
                              label={t("settings.cronWorkdirCustom")}
                              value={workdir}
                              placeholder={t("settings.cronWorkdirCustomPlaceholder")}
                              onChange={(value) => {
                                setFormError(null);
                                setWorkdir(value);
                              }}
                            />
                          </StackItem>
                          {onPickWorkdir ? (
                            <IconButton
                              label={t("settings.cronWorkdirBrowse")}
                              tooltip={t("settings.cronWorkdirBrowse")}
                              icon={<FolderOpen aria-hidden="true" />}
                              variant="secondary"
                              onClick={() => {
                                void (async () => {
                                  try {
                                    const picked = await onPickWorkdir(workdir.trim());
                                    const path = picked?.trim();
                                    if (!path) return;
                                    setFormError(null);
                                    setWorkdir(path);
                                  } catch (error) {
                                    setFormError(
                                      error instanceof Error ? error.message : String(error),
                                    );
                                  }
                                })();
                              }}
                            />
                          ) : null}
                        </HStack>
                      ) : (
                        <Text type="supporting" color="secondary">
                          {workdir || t("settings.cronWorkdirHint")}
                        </Text>
                      )}
                    </FormLayout>
                  ) : null}

                  {type === "bash" ? (
                    <TextArea
                      label={t("settings.cronCommandList")}
                      description={t("settings.cronCommandHint")}
                      value={scriptText}
                      rows={9}
                      isRequired
                      hasSpellCheck={false}
                      placeholder={"pnpm install\npnpm build\npnpm test"}
                      onChange={(value) => {
                        setFormError(null);
                        setScriptText(value);
                      }}
                    />
                  ) : null}

                  {type === "http" ? (
                    <HttpRequestListEditor
                      requests={requests}
                      expandedRequestId={expandedRequest}
                      onExpand={setExpandedRequest}
                      onChange={setRequests}
                      onDirty={() => setFormError(null)}
                      urlPlaceholder="https://example.com/webhook"
                    />
                  ) : null}

                  {type === "prompt" ? (
                    <FormLayout>
                      <VStack gap={1}>
                        <Text type="body" weight="semibold">
                          {t("settings.cronPromptModelLabel")}
                        </Text>
                        <ModelPicker
                          options={promptModelOptions}
                          value={selectedModelValue}
                          disabled={promptModelOptions.length === 0}
                          placeholder={t("settings.cronPromptModelPlaceholder")}
                          ariaLabel={t("settings.cronPromptModelLabel")}
                          onChange={(value) => {
                            setFormError(null);
                            setSelectedModelValue(value);
                          }}
                        />
                      </VStack>
                      {promptModelOptions.length === 0 ? (
                        <Banner
                          status="warning"
                          title={t("settings.cronPromptModelEmpty")}
                          container="card"
                        />
                      ) : null}
                      <Selector
                        label={t("settings.cronReasoningLabel")}
                        value={reasoning}
                        width="100%"
                        options={CRON_REASONING_LEVELS.map((level) => ({
                          value: level,
                          label: t(REASONING_LEVEL_I18N_KEYS[level]),
                        }))}
                        onChange={(value) => {
                          setFormError(null);
                          if (isCronReasoningLevel(value)) setReasoning(value);
                        }}
                      />
                      <TextArea
                        label={t("settings.cronPromptLabel")}
                        value={prompt}
                        rows={9}
                        isRequired
                        placeholder={t("settings.cronPromptPlaceholder")}
                        onChange={(value) => {
                          setFormError(null);
                          setPrompt(value);
                        }}
                      />
                    </FormLayout>
                  ) : null}
                </VStack>
              </Section>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={3} vAlign="center">
              <StackItem size="fill">
                {formReady ? (
                  <Text type="supporting" color="secondary">
                    {t("settings.agentsReady")}
                  </Text>
                ) : null}
              </StackItem>
              <Button label={t("settings.cancel")} variant="secondary" onClick={onClose} />
              <Button
                label={t("settings.save")}
                variant="primary"
                isLoading={isSaving}
                isDisabled={!name.trim() || !cron.trim() || isSaving}
                onClick={() => void handleSave()}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </SettingsModalShell>
  );
}
