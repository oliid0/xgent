import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import {
  Button as AstryxButton,
  Button as AstryxNativeButton,
  Button,
} from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid as AstryxGrid } from "@astryxdesign/core/Grid";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List as AstryxList, ListItem } from "@astryxdesign/core/List";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Popover } from "@astryxdesign/core/Popover";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Stack as AstryxStack, Stack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text as AstryxText, Heading, Text as Label, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput as Input, TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { invoke } from "@xgent/runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompactDialogHeader } from "../../components/astryx/CompactDialogHeader";
import { ConfirmActionPopover } from "../../components/astryx/ConfirmActionPopover";
import {
  ChevronLeft,
  ClaudeIcon,
  Download,
  Eye,
  EyeOff,
  GeminiIcon,
  Globe,
  GripVertical,
  List,
  MoreHorizontal,
  OpenaiChatgptIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Wallet,
  Waypoints,
  Zap,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  isLocalAccessSecretSentinel,
  LOCAL_ACCESS_SECRET_SENTINEL,
} from "../../lib/localAccessSecrets";
import {
  MODEL_INPUT_OPTIONS,
  type ModelInputMode,
  modelInputMode,
  supportsModelInputOverride,
  withModelInputMode,
} from "../../lib/models/modelInput";
import {
  getCustomHeaderKeyPresets,
  isReservedCustomHeaderKey,
  isValidCustomHeaderKey,
  isValidCustomHeaderValue,
} from "../../lib/providers/customHeaders";
import { moveModelOrder } from "../../lib/providers/modelVendor";
import {
  type ProviderUsageResult,
  testProviderUsage,
  useProviderUsage,
} from "../../lib/providers/usageQuery";
import {
  CODEX_REQUEST_FORMAT_LABELS,
  type CodexRequestFormat,
  type CustomProvider,
  getDefaultUsageQueryConfig,
  normalizeUsageQueryConfig,
  PROVIDER_RETRY_DEFAULT_MAX_RETRIES,
  PROVIDER_RETRY_MAX_RETRIES_LIMITS,
  type PromptCacheHintMode,
  type ProviderAuthMode,
  type ProviderId,
  type ProviderModelConfig,
  type ProviderRetryPolicy,
  switchUsageQueryMode,
  type UsageQueryConfig,
  type UsageQueryMode,
  updateCustomProviders,
} from "../../lib/settings";
import { createUuid } from "../../lib/shared/id";
import { cn } from "../../lib/shared/utils";
import {
  type CherryProviderImportItem,
  type CherryProvidersResponse,
  CherryStudioImportModal,
} from "./CherryStudioImportModal";
import { CodexOAuthAccounts } from "./CodexOAuthAccounts";
import { ModelFailoverSection } from "./ModelFailoverSection";
import { ModelPicker } from "./modelPicker";
import { ProviderSettingsRow } from "./ProviderSettingsRow";
import { PROVIDER_CACHE_HINT_OPTIONS } from "./providerCacheSettings";
import {
  buildCcsImportedProviders,
  type CcsProviderImportItem,
  type CcsProvidersResponse,
  ccsImportIdentity,
  ccsItemKey,
  ccsProviderCanSyncModels,
  ccsProviderIsTransferable,
  cherryProviderId,
  providerFromCherry,
  syncCcsImportModels,
  syncCherryImportModels,
} from "./providerImports";
import { providerListDetails } from "./providerListDetails";
import {
  createModelEditDraft,
  editedProviderModel,
  type ModelEditDraft,
  mergeModelEdit,
  parseCostRate,
  parsePositiveInteger,
} from "./providerModelSettings";
import { providerRuntimeActions, runtimeModelOptions } from "./providerRuntimeSettings";
import {
  buildProviderModelsFetchKey,
  createDraftModelConfig,
  fetchModelsFromApi,
  isBrowserRuntime,
  mergeFetchedModels,
  normalizeFetchedModels,
  sortModelsBySelection,
} from "./providerUtils";
import { RetryErrorSection } from "./RetryErrorSection";
import { SecretTextInput } from "./SecretTextInput";
import { SettingsDetailHeader } from "./SettingsDetailHeader";
import { SettingsModalShell } from "./SettingsModalShell";
import { ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

type ModalProps = {
  providerType: ProviderId;
  initialData?: CustomProvider;
  onSave: (data: Omit<CustomProvider, "id">) => void;
  onClose: () => void;
};

type ProviderDialogPanel = "general" | "request" | "usage";
type ProviderSettingsView = "list" | "editor" | "advanced";

const USAGE_QUERY_MODES: UsageQueryMode[] = [
  "coding-plan",
  "balance",
  "general",
  "newapi",
  "custom",
];

const PROVIDER_TABS: ProviderId[] = ["claude_code", "codex", "gemini", "xai", "deepseek"];
const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude_code: "Anthropic",
  codex: "OpenAI",
  gemini: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
};

function getProviderLabel(type: ProviderId) {
  return PROVIDER_LABELS[type];
}

function ProviderBrandIcon({ type }: { type: ProviderId }) {
  const icon = {
    claude_code: ClaudeIcon,
    codex: OpenaiChatgptIcon,
    gemini: GeminiIcon,
    xai: Zap,
    deepseek: Waypoints,
  }[type];
  return <Icon className="settings-provider-brand" icon={icon} size="sm" color="inherit" />;
}

const REDACTED_API_KEY_DISPLAY = "API Key";
const CHERRY_DATA_PATH_STORAGE_KEY = "xgent.cherryStudioDataPath";

// A local rescan usually returns within a frame, which makes the refresh
// feedback flash for a single frame. Hold the loading state for one full
// spinner revolution so the rescan reads as motion instead of a flicker.
const THIRD_PARTY_SCAN_FEEDBACK_MS = 1000;

function inferFullRequestUrl(providerType: ProviderId, input: string) {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return false;
  let route = trimmed.toLowerCase();
  try {
    const parsed = new URL(trimmed);
    route = `${parsed.pathname}${parsed.search}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    // The request layer owns URL validation. Suffix inference also works while
    // the user is still typing an incomplete URL.
  }
  if (providerType === "gemini") {
    return /:streamgeneratecontent$|:generatecontent$/.test(route);
  }
  if (providerType === "claude_code") return /\/v\d+\/messages$/.test(route);
  return /\/chat\/completions$|\/responses?$/.test(route);
}

function withScanFeedback<T>(work: Promise<T>): Promise<T> {
  return Promise.all([
    work,
    new Promise<void>((resolve) => setTimeout(resolve, THIRD_PARTY_SCAN_FEEDBACK_MS)),
  ]).then(([result]) => result);
}

function readCherryDataPath() {
  try {
    return localStorage.getItem(CHERRY_DATA_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
}

type CustomHeaderKeyIssue = "reserved" | "invalid";

function getCustomHeaderKeyIssue(key: string, includeEmpty = false): CustomHeaderKeyIssue | null {
  if (!key && !includeEmpty) return null;
  if (isReservedCustomHeaderKey(key)) return "reserved";
  return isValidCustomHeaderKey(key) ? null : "invalid";
}

function DialogSwitch(props: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  const { checked, onCheckedChange, ariaLabel } = props;
  return (
    <Switch label={ariaLabel} isLabelHidden size="sm" value={checked} onChange={onCheckedChange} />
  );
}
function formatTokenCount(value: number): string {
  if (value < 1_000) return String(value);
  return `${String(Math.round(value / 1_000))}K`;
}
function ProviderEditor({ providerType, initialData, onSave, onClose }: ModalProps) {
  const { t } = useLocale();
  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );
  const isBrowser = isBrowserRuntime();
  const initialApiKey = initialData?.apiKey ?? "";
  const initialUsesRedactedApiKey =
    isBrowser &&
    initialData?.apiKeyConfigured === true &&
    (initialApiKey.trim() === "" || isLocalAccessSecretSentinel(initialApiKey));
  const [name, setName] = useState(initialData?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initialData?.baseUrl ?? "");
  const [modelsUrl, setModelsUrl] = useState(initialData?.modelsUrl ?? "");
  const [apiKey, setApiKey] = useState(
    initialUsesRedactedApiKey ? REDACTED_API_KEY_DISPLAY : initialApiKey,
  );
  const isFullUrl = inferFullRequestUrl(providerType, baseUrl);
  const supportsOAuth = providerType === "claude_code" || providerType === "codex";
  const [authMode, setAuthMode] = useState<ProviderAuthMode>(
    providerType === "codex" && initialData?.authMode === "oauth-managed"
      ? "oauth-managed"
      : supportsOAuth &&
          (initialData?.authMode === "oauth-token" || initialApiKey.includes("sk-ant-oat"))
        ? "oauth-token"
        : "api-key",
  );
  const [managedOAuthAccountId, setManagedOAuthAccountId] = useState(
    initialData?.oauthAccountId ?? "",
  );
  const [customHeaders, setCustomHeaders] = useState(() =>
    (initialData?.customHeaders ?? []).map((header) => ({ ...header })),
  );
  const [models, publishModels] = useState<ProviderModelConfig[]>(() =>
    normalizeFetchedModels(initialData?.models ?? [], providerType),
  );
  const acceptedModels = useRef(models);
  acceptedModels.current = models;
  function setModels(
    next: ProviderModelConfig[] | ((previous: ProviderModelConfig[]) => ProviderModelConfig[]),
  ) {
    acceptedModels.current = typeof next === "function" ? next(acceptedModels.current) : next;
    modelOrderScope.current.models = acceptedModels.current;
    publishModels(acceptedModels.current);
  }
  const [activeModels, publishActiveModels] = useState<Set<string>>(
    new Set(initialData?.activeModels ?? []),
  );
  const [modelOrder, setModelOrder] = useState<string[] | undefined>(initialData?.modelOrder);
  const modelOrderScope = useRef({
    models,
    activeModels,
    order: modelOrder,
    query: "",
    bulk: false,
  });
  function setActiveModels(next: Set<string> | ((previous: Set<string>) => Set<string>)) {
    modelOrderScope.current.activeModels =
      typeof next === "function" ? next(modelOrderScope.current.activeModels) : next;
    publishActiveModels(modelOrderScope.current.activeModels);
  }
  const [requestFormat, setRequestFormat] = useState<CodexRequestFormat>(
    initialData?.requestFormat ?? "openai-responses",
  );
  const [useSystemProxy, setUseSystemProxy] = useState(initialData?.useSystemProxy ?? false);
  const [promptCachingEnabled, setPromptCachingEnabled] = useState(
    initialData?.promptCachingEnabled ??
      (providerType !== "gemini" && providerType !== "xai" && providerType !== "deepseek"),
  );
  const [promptCacheRetention, setPromptCacheRetention] = useState<"short" | "long">(
    initialData?.promptCacheRetention === "long" ? "long" : "short",
  );
  const [promptCacheHintMode, setPromptCacheHintMode] = useState<PromptCacheHintMode>(
    initialData?.promptCacheHintMode ?? "auto",
  );
  const acceptedCacheHint = useRef(promptCacheHintMode);
  acceptedCacheHint.current = promptCacheHintMode;
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [addingModel, setAddingModel] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [modelBulkMode, setModelBulkMode] = useState(false);
  const [modelBulkSelection, setModelBulkSelection] = useState<Set<string>>(new Set());
  const [editingModel, publishEditingModel] = useState<ModelEditDraft | null>(null);
  const acceptedModelEdit = useRef(editingModel);
  const modelEditGeneration = useRef(0);
  acceptedModelEdit.current = editingModel;
  function setEditingModel(
    next: ModelEditDraft | null | ((previous: ModelEditDraft | null) => ModelEditDraft | null),
  ) {
    const previous = acceptedModelEdit.current;
    acceptedModelEdit.current = typeof next === "function" ? next(previous) : next;
    if (previous?.model.id !== acceptedModelEdit.current?.model.id) modelEditGeneration.current++;
    publishEditingModel(acceptedModelEdit.current);
  }
  const [activePanel, setActivePanel] = useState<ProviderDialogPanel>("general");
  const [headerValidationSubmitted, setHeaderValidationSubmitted] = useState(false);
  const [visibleHeaderValues, setVisibleHeaderValues] = useState<Set<number>>(new Set());
  const [headerSuggest, setHeaderSuggest] = useState<{ index: number } | null>(null);
  const [headerSuggestActive, setHeaderSuggestActive] = useState(0);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [usageQuery, setUsageQuery] = useState<UsageQueryConfig>(() =>
    normalizeUsageQueryConfig(initialData?.usageQuery ?? getDefaultUsageQueryConfig()),
  );
  const [streamRetryMode, setStreamRetryMode] = useState<"default" | "off" | "custom">(
    initialData?.retryPolicy?.mode ?? "default",
  );
  const [streamRetryCount, setStreamRetryCount] = useState(
    initialData?.retryPolicy?.mode === "custom"
      ? initialData.retryPolicy.maxRetries
      : PROVIDER_RETRY_DEFAULT_MAX_RETRIES,
  );
  const [usageTest, setUsageTest] = useState<{
    loading: boolean;
    result: ProviderUsageResult | null;
    error: string | null;
  }>({ loading: false, result: null, error: null });

  const acceptedUsageQuery = useRef(usageQuery);
  const usageRequest = useRef({ active: false, session: 0, request: 0, pending: false });
  const usageSession = usageRequest.current.session;
  const invalidateUsageTest = useCallback(() => {
    usageRequest.current.request++;
    usageRequest.current.pending = false;
    setUsageTest({ loading: false, result: null, error: null });
  }, []);
  const retireUsageTests = useCallback(() => {
    usageRequest.current.active = false;
    usageRequest.current.session++;
    usageRequest.current.request++;
    usageRequest.current.pending = false;
  }, []);

  useEffect(() => {
    usageRequest.current.active = true;
    invalidateUsageTest();
    return retireUsageTests;
  }, [invalidateUsageTest, retireUsageTests]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFetchKey = useRef("");
  const modelRequest = useRef({
    active: false,
    configuration: "",
    editVersion: 0,
    request: 0,
    pending: false,
  });
  const headerKeyRefs = useRef<Array<HTMLInputElement | null>>([]);
  const headerValueRefs = useRef<Array<HTMLInputElement | null>>([]);
  const apiKeyIsRedactedDisplay = initialUsesRedactedApiKey && apiKey === REDACTED_API_KEY_DISPLAY;
  const apiKeyForRequest =
    authMode === "oauth-managed"
      ? ""
      : apiKeyIsRedactedDisplay
        ? LOCAL_ACCESS_SECRET_SENTINEL
        : apiKey.trim();
  const modelFetchCredential =
    authMode === "oauth-managed" ? managedOAuthAccountId.trim() : apiKeyForRequest;
  const canFetchModels =
    (baseUrl.trim().length > 0 || modelsUrl.trim().length > 0) && modelFetchCredential.length > 0;
  const modelFetchKey = JSON.stringify([
    providerType,
    initialData?.id,
    buildProviderModelsFetchKey(
      baseUrl.trim(),
      apiKeyForRequest,
      useSystemProxy,
      supportsOAuth ? authMode : "api-key",
      customHeaders,
      authMode === "oauth-managed" ? managedOAuthAccountId : undefined,
      isFullUrl,
      modelsUrl,
    ),
  ]);
  const modelEditVersion = modelRequest.current.editVersion;

  const clearModelDebounce = useCallback(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = null;
  }, []);

  const retireModelRequests = useCallback(() => {
    modelRequest.current.active = false;
    modelRequest.current.request++;
    modelRequest.current.pending = false;
    prevFetchKey.current = "";
    clearModelDebounce();
  }, [clearModelDebounce]);

  const invalidateModelRequest = useCallback(() => {
    invalidateUsageTest();
    modelRequest.current.editVersion++;
    modelRequest.current.request++;
    modelRequest.current.pending = false;
    prevFetchKey.current = "";
    clearModelDebounce();
    setFetchingModels(false);
    setFetchError(null);
  }, [clearModelDebounce, invalidateUsageTest]);

  useEffect(() => {
    modelRequest.current.active = true;
    setFetchingModels(false);
    return retireModelRequests;
  }, [retireModelRequests]);

  useEffect(() => {
    modelRequest.current.configuration = modelFetchKey;
    modelRequest.current.request++;
    modelRequest.current.pending = false;
    prevFetchKey.current = "";
    clearModelDebounce();
    setFetchingModels(false);
    setFetchError(null);
  }, [clearModelDebounce, modelFetchKey]);

  const doFetch = useCallback(
    async (url: string, key: string) => {
      const scope = modelRequest.current;
      if (
        !scope.active ||
        scope.configuration !== modelFetchKey ||
        scope.editVersion !== modelEditVersion ||
        scope.pending
      )
        return;
      scope.pending = true;
      const request = ++scope.request;
      const ownsRequest = () =>
        scope.active &&
        scope.configuration === modelFetchKey &&
        scope.editVersion === modelEditVersion &&
        scope.request === request;
      clearModelDebounce();
      prevFetchKey.current = modelFetchKey;
      setFetchingModels(true);
      setFetchError(null);
      try {
        const list = await fetchModelsFromApi(providerType, url, key, {
          authMode: supportsOAuth ? authMode : "api-key",
          oauthAccountId: authMode === "oauth-managed" ? managedOAuthAccountId : undefined,
          providerConfigId: initialData?.id,
          customHeaders,
          useSystemProxy,
          isFullUrl,
          modelsUrl,
        });
        if (ownsRequest()) {
          setModels((prev) => (ownsRequest() ? mergeFetchedModels(list, prev) : prev));
        }
      } catch (err) {
        if (ownsRequest()) setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (ownsRequest()) {
          scope.pending = false;
          setFetchingModels(false);
        }
      }
    },
    [
      authMode,
      clearModelDebounce,
      customHeaders,
      isFullUrl,
      initialData?.id,
      managedOAuthAccountId,
      modelEditVersion,
      modelFetchKey,
      modelsUrl,
      providerType,
      supportsOAuth,
      useSystemProxy,
    ],
  );

  useEffect(() => {
    const trimUrl = baseUrl.trim();
    const trimKey = apiKeyForRequest;
    const trimCredential = modelFetchCredential;
    if ((!trimUrl && !modelsUrl.trim()) || !trimCredential) return;
    if (modelFetchKey === prevFetchKey.current || !modelRequest.current.active) return;

    clearModelDebounce();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void doFetch(trimUrl, trimKey);
    }, 900);

    return clearModelDebounce;
  }, [
    apiKeyForRequest,
    authMode,
    baseUrl,
    clearModelDebounce,
    customHeaders,
    doFetch,
    managedOAuthAccountId,
    isFullUrl,
    modelFetchCredential,
    modelFetchKey,
    modelsUrl,
    supportsOAuth,
    useSystemProxy,
  ]);

  function handleRefresh() {
    if (
      !modelRequest.current.active ||
      modelRequest.current.configuration !== modelFetchKey ||
      modelRequest.current.editVersion !== modelEditVersion
    )
      return;
    const trimUrl = baseUrl.trim();
    const trimKey = apiKeyForRequest;
    if ((!trimUrl && !modelsUrl.trim()) || !modelFetchCredential) {
      setFetchError(t("settings.noBaseUrlApiKey"));
      return;
    }
    void doFetch(trimUrl, trimKey);
  }

  function closeEditor() {
    if (!usageRequest.current.active || usageRequest.current.session !== usageSession) return;
    retireModelRequests();
    retireUsageTests();
    onClose();
  }

  function patchUsageQuery(patch: Partial<UsageQueryConfig>) {
    acceptUsageQuery(normalizeUsageQueryConfig({ ...acceptedUsageQuery.current, ...patch }));
  }

  function acceptUsageQuery(next: UsageQueryConfig) {
    if (!usageRequest.current.active || usageRequest.current.session !== usageSession) return;
    acceptedUsageQuery.current = next;
    invalidateUsageTest();
    setUsageQuery(next);
  }

  function serializeRetryPolicy(): ProviderRetryPolicy | undefined {
    if (streamRetryMode === "off") return { mode: "off" };
    if (streamRetryMode !== "custom") return undefined;
    return {
      mode: "custom",
      maxRetries: Math.min(
        PROVIDER_RETRY_MAX_RETRIES_LIMITS.max,
        Math.max(PROVIDER_RETRY_MAX_RETRIES_LIMITS.min, Math.round(streamRetryCount)),
      ),
    };
  }

  async function runUsageQueryTest() {
    const scope = usageRequest.current;
    if (!initialData?.id || !scope.active || scope.session !== usageSession || scope.pending)
      return;
    scope.pending = true;
    const request = ++scope.request;
    const ownsRequest = () =>
      scope.active && scope.session === usageSession && scope.request === request;
    setUsageTest({ loading: true, result: null, error: null });
    try {
      const result = await testProviderUsage(initialData.id, acceptedUsageQuery.current);
      if (ownsRequest()) {
        setUsageTest((previous) =>
          ownsRequest() ? { loading: false, result, error: result?.error ?? null } : previous,
        );
      }
    } catch (error) {
      if (ownsRequest()) {
        setUsageTest((previous) =>
          ownsRequest()
            ? {
                loading: false,
                result: null,
                error: error instanceof Error ? error.message : String(error),
              }
            : previous,
        );
      }
    } finally {
      if (ownsRequest()) scope.pending = false;
    }
  }

  function toggleModel(model: string) {
    setActiveModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) next.delete(model);
      else next.add(model);
      return next;
    });
  }

  function handleAddModel() {
    const model = newModelName.trim();
    if (!model) return;
    if (!models.some((item) => item.id === model)) {
      setModels((prev) => [...prev, createDraftModelConfig(providerType, model)]);
    }
    setActiveModels((prev) => new Set([...prev, model]));
    setNewModelName("");
    setAddingModel(false);
  }

  function removeModel(model: string) {
    setModels((prev) => prev.filter((item) => item.id !== model));
    setActiveModels((prev) => {
      const next = new Set(prev);
      next.delete(model);
      return next;
    });
    setEditingModel((prev) => (prev?.model.id === model ? null : prev));
  }

  function openModelSettings(modelId: string) {
    if (!usageRequest.current.active || usageRequest.current.session !== usageSession) return;
    if (acceptedModelEdit.current?.model.id === modelId) {
      setEditingModel(null);
      return;
    }
    const nextModels = modelsWithEditingDraft();
    if (!nextModels) return;
    const target = nextModels.find((item) => item.id === modelId);
    if (!target) return;
    setModels(nextModels);
    setEditingModel(createModelEditDraft(target));
  }

  const editingModelContextWindow = editingModel
    ? parsePositiveInteger(editingModel.contextWindow)
    : null;
  const editingModelMaxOutputToken = editingModel
    ? parsePositiveInteger(editingModel.maxOutputToken)
    : null;
  const canSaveEditingModel = editedProviderModel(editingModel) !== null;
  const presentedModelGeneration = modelEditGeneration.current;
  const presentedModelId = editingModel?.model.id;
  const ownsModelDialog = () =>
    !!presentedModelId &&
    usageRequest.current.active &&
    usageRequest.current.session === usageSession &&
    modelEditGeneration.current === presentedModelGeneration &&
    acceptedModelEdit.current?.model.id === presentedModelId;
  const updatePresentedModel = (next: Parameters<typeof setEditingModel>[0]) => {
    if (ownsModelDialog()) setEditingModel(next);
  };

  function modelsWithEditingDraft(): ProviderModelConfig[] | null {
    const draft = acceptedModelEdit.current;
    if (!draft) return acceptedModels.current;
    const nextModel = editedProviderModel(draft);
    if (!nextModel) return null;
    return acceptedModels.current.map((item) =>
      item.id === nextModel.id ? mergeModelEdit(item, nextModel, draft.model) : item,
    );
  }

  function saveModelSettings() {
    if (!ownsModelDialog()) return;
    const nextModels = modelsWithEditingDraft();
    if (!nextModels) return;
    setModels(nextModels);
    setEditingModel(null);
  }
  function updateCustomHeader(index: number, field: "key" | "value", value: string) {
    if (customHeaders[index]?.[field] === value) return;
    invalidateModelRequest();
    setCustomHeaders((prev) =>
      prev.map((header, headerIndex) =>
        headerIndex === index ? { ...header, [field]: value } : header,
      ),
    );
    setHeaderValidationSubmitted(false);
  }

  function focusCustomHeader(index: number, field: "key" | "value") {
    requestAnimationFrame(() => {
      const target =
        field === "key" ? headerKeyRefs.current[index] : headerValueRefs.current[index];
      target?.focus();
    });
  }

  function addCustomHeader(key = "", focusField: "key" | "value" = "key") {
    invalidateModelRequest();
    const nextIndex = customHeaders.length;
    setCustomHeaders((prev) => [...prev, { key, value: "" }]);
    setHeaderValidationSubmitted(false);
    focusCustomHeader(nextIndex, focusField);
  }

  function removeCustomHeader(index: number) {
    invalidateModelRequest();
    setCustomHeaders((prev) => prev.filter((_, headerIndex) => headerIndex !== index));
    setVisibleHeaderValues((prev) => {
      const next = new Set<number>();
      for (const visibleIndex of prev) {
        if (visibleIndex < index) next.add(visibleIndex);
        if (visibleIndex > index) next.add(visibleIndex - 1);
      }
      return next;
    });
    setHeaderValidationSubmitted(false);
  }

  const manualOAuthAccountId =
    customHeaders.find((header) => header.key.toLowerCase() === "chatgpt-account-id")?.value ?? "";

  function setManualOAuthAccountId(value: string) {
    if (value === manualOAuthAccountId) return;
    invalidateModelRequest();
    setCustomHeaders((current) => {
      const index = current.findIndex(
        (header) => header.key.toLowerCase() === "chatgpt-account-id",
      );
      if (index < 0) {
        return value ? [...current, { key: "chatgpt-account-id", value }] : current;
      }
      if (!value) return current.filter((_, headerIndex) => headerIndex !== index);
      return current.map((header, headerIndex) =>
        headerIndex === index ? { ...header, value } : header,
      );
    });
  }

  function toggleCustomHeaderValue(index: number) {
    setVisibleHeaderValues((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function openHeaderSuggest(index: number) {
    const input = headerKeyRefs.current[index];
    if (!input) return;
    setHeaderSuggest({ index });
    setHeaderSuggestActive(0);
  }

  function applyHeaderSuggestion(preset: string) {
    if (!headerSuggest) return;
    updateCustomHeader(headerSuggest.index, "key", preset);
    setHeaderSuggest(null);
    focusCustomHeader(headerSuggest.index, "value");
  }

  function handleSave() {
    if (!usageRequest.current.active || usageRequest.current.session !== usageSession) return;
    setSaveAttempted(true);
    if (!name.trim()) {
      setActivePanel("general");
      return;
    }
    const nextModels = modelsWithEditingDraft();
    if (!nextModels) {
      setActivePanel("general");
      return;
    }
    if (authMode === "oauth-managed" && !managedOAuthAccountId.trim()) {
      setActivePanel("general");
      return;
    }
    const invalidHeaderIndex = customHeaders.findIndex(
      (header) =>
        getCustomHeaderKeyIssue(header.key, true) !== null ||
        !isValidCustomHeaderValue(header.value),
    );
    if (invalidHeaderIndex >= 0) {
      setHeaderValidationSubmitted(true);
      setActivePanel("request");
      focusCustomHeader(
        invalidHeaderIndex,
        getCustomHeaderKeyIssue(customHeaders[invalidHeaderIndex].key, true) ? "key" : "value",
      );
      return;
    }
    const nextApiKey =
      authMode === "oauth-managed"
        ? ""
        : apiKeyIsRedactedDisplay
          ? LOCAL_ACCESS_SECRET_SENTINEL
          : apiKey.trim();
    onSave({
      name: name.trim(),
      type: providerType,
      baseUrl: baseUrl.trim(),
      isFullUrl,
      modelsUrl: providerType === "gemini" ? undefined : modelsUrl.trim() || undefined,
      apiKey: nextApiKey,
      apiKeyConfigured:
        (authMode === "oauth-managed" && managedOAuthAccountId.trim().length > 0) ||
        nextApiKey.length > 0 ||
        apiKeyIsRedactedDisplay ||
        (isBrowser && initialData?.apiKeyConfigured === true),
      authMode: supportsOAuth ? authMode : "api-key",
      oauthAccountId:
        providerType === "codex" && authMode === "oauth-managed"
          ? managedOAuthAccountId.trim() || undefined
          : undefined,
      customHeaders:
        providerType === "codex" && authMode !== "oauth-token"
          ? customHeaders.filter((header) => header.key.toLowerCase() !== "chatgpt-account-id")
          : customHeaders,
      models: nextModels,
      modelOrder: modelOrderScope.current.order,
      activeModels: Array.from(modelOrderScope.current.activeModels),
      requestFormat:
        providerType === "xai"
          ? "openai-responses"
          : providerType === "codex"
            ? requestFormat
            : undefined,
      reasoning:
        providerType === "gemini" && initialData?.reasoning === "xhigh"
          ? "high"
          : (initialData?.reasoning ?? "off"),
      promptCachingEnabled:
        providerType === "gemini" || providerType === "xai" || providerType === "deepseek"
          ? false
          : promptCachingEnabled,
      promptCacheRetention:
        providerType === "claude_code" && promptCachingEnabled && promptCacheRetention === "long"
          ? "long"
          : undefined,
      promptCacheHintMode:
        providerType === "codex" ? acceptedCacheHint.current : initialData?.promptCacheHintMode,
      nativeWebSearchEnabled: initialData?.nativeWebSearchEnabled ?? true,
      useSystemProxy,
      retryPolicy: serializeRetryPolicy(),
      usageQuery: acceptedUsageQuery.current,
    });
    retireModelRequests();
    retireUsageTests();
  }

  const isEditing = Boolean(initialData);
  const typeLabel = getProviderLabel(providerType);
  const orderedModels = useMemo(
    () => sortModelsBySelection(models, activeModels, modelOrder),
    [models, activeModels, modelOrder],
  );
  const modelSearchQuery = modelSearch.trim().toLowerCase();
  modelOrderScope.current = {
    models,
    activeModels,
    order: modelOrder,
    query: modelSearchQuery,
    bulk: modelBulkMode,
  };
  function moveModel(id: string, offset: -1 | 1) {
    if (!usageRequest.current.active || usageRequest.current.session !== usageSession) return;
    const latest = modelOrderScope.current;
    if (latest.query || latest.bulk) return;
    const next = moveModelOrder(latest.models, latest.order, latest.activeModels, id, offset);
    if (next) {
      latest.order = next;
      setModelOrder(next);
    }
  }
  const visibleModels = useMemo(
    () =>
      modelSearchQuery
        ? orderedModels.filter((model) => model.id.toLowerCase().includes(modelSearchQuery))
        : orderedModels,
    [orderedModels, modelSearchQuery],
  );
  const selectedModelsToEnable = Array.from(modelBulkSelection).filter(
    (modelId) => !activeModels.has(modelId),
  );
  const selectedModelsToDisable = Array.from(modelBulkSelection).filter((modelId) =>
    activeModels.has(modelId),
  );

  function setModelBulkState(enabled: boolean) {
    setActiveModels((current) => {
      const next = new Set(current);
      for (const modelId of modelBulkSelection) {
        if (enabled) next.add(modelId);
        else next.delete(modelId);
      }
      return next;
    });
  }

  function toggleModelBulkSelection(modelId: string) {
    setModelBulkSelection((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }
  const headerSuggestQuery = headerSuggest
    ? (customHeaders[headerSuggest.index]?.key ?? "").trim().toLowerCase()
    : "";
  const headerSuggestUsed = new Set(
    headerSuggest
      ? customHeaders
          .filter((_, index) => index !== headerSuggest.index)
          .map((header) => header.key.trim().toLowerCase())
          .filter(Boolean)
      : [],
  );
  const headerSuggestItems = headerSuggest
    ? headerSuggestQuery
      ? getCustomHeaderKeyPresets(providerType).filter((preset) => {
          const lower = preset.toLowerCase();
          if (headerSuggestUsed.has(lower)) return false;
          return lower.includes(headerSuggestQuery) && lower !== headerSuggestQuery;
        })
      : []
    : [];
  const headerSuggestActiveIndex = Math.min(
    headerSuggestActive,
    Math.max(0, headerSuggestItems.length - 1),
  );
  const firstHeaderIssue =
    customHeaders
      .map(
        (header) =>
          getCustomHeaderKeyIssue(header.key, headerValidationSubmitted) ??
          (!isValidCustomHeaderValue(header.value) ? "invalid-value" : null),
      )
      .find((issue) => issue !== null) ?? null;
  const headerIssueMessage =
    firstHeaderIssue === "reserved"
      ? t("settings.customHeaderReservedTitle")
      : firstHeaderIssue === "invalid"
        ? t("settings.invalidCustomHeaderKey")
        : firstHeaderIssue === "invalid-value"
          ? t("settings.invalidCustomHeaderValue")
          : null;
  return (
    <VStack
      className="settings-provider-editor"
      data-compact={isCompact}
      height="100%"
      minHeight={0}
      gap={0}
    >
      <SettingsDetailHeader
        title={isEditing ? t("settings.editProvider") : t("settings.addProvider")}
        subtitle={`${typeLabel} ${t("settings.compatible")}`}
        startContent={
          <IconButton
            label={t("settings.providerDialogNavigation")}
            tooltip={t("settings.providerDialogNavigation")}
            variant="ghost"
            icon={<Icon icon={ChevronLeft} size={isCompact ? "lg" : "md"} color="inherit" />}
            size="lg"
            onClick={closeEditor}
          />
        }
        endContent={<ProviderBrandIcon type={providerType} />}
      />

      <StackItem size="fill" className="settings-provider-editor-fill">
        <Stack
          className="settings-provider-editor-body"
          direction={isCompact ? "vertical" : "horizontal"}
          height="100%"
          minHeight={0}
          gap={0}
        >
          {isCompact ? (
            <StackItem>
              <AstryxStack direction="vertical" paddingInline={3} paddingBlockStart={2}>
                <TabList
                  value={activePanel}
                  onChange={(value) => setActivePanel(value as ProviderDialogPanel)}
                  role="tablist"
                  layout="fill"
                  size="lg"
                >
                  <Tab
                    value="general"
                    label={t("settings.providerDialogGeneral")}
                    panelId="provider-settings-panel"
                    icon={<Icon icon={Settings} size={isCompact ? "lg" : "sm"} color="inherit" />}
                  />
                  <Tab
                    value="request"
                    label={t("settings.providerDialogRequest")}
                    panelId="provider-settings-panel"
                    icon={<Icon icon={Globe} size={isCompact ? "lg" : "sm"} color="inherit" />}
                    endContent={
                      customHeaders.length > 0 ? (
                        <Badge label={customHeaders.length} variant="neutral" />
                      ) : undefined
                    }
                  />
                  <Tab
                    value="usage"
                    label={t("settings.navUsage")}
                    panelId="provider-settings-panel"
                    icon={<Icon icon={Wallet} size={isCompact ? "lg" : "sm"} color="inherit" />}
                  />
                </TabList>
              </AstryxStack>
            </StackItem>
          ) : (
            <AstryxStack
              as="nav"
              direction="vertical"
              className="w-[172px] shrink-0 border-r bg-muted/30 p-2.5"
              aria-label={t("settings.providerDialogNavigation")}
            >
              <AstryxList density="compact">
                <ListItem
                  label={t("settings.providerDialogGeneral")}
                  startContent={
                    <Icon icon={Settings} size={isCompact ? "lg" : "sm"} color="secondary" />
                  }
                  isSelected={activePanel === "general"}
                  onClick={() => setActivePanel("general")}
                />
                <ListItem
                  label={t("settings.providerDialogRequest")}
                  startContent={
                    <Icon icon={Globe} size={isCompact ? "lg" : "sm"} color="secondary" />
                  }
                  endContent={
                    customHeaders.length > 0 ? (
                      <Badge label={customHeaders.length} variant="neutral" />
                    ) : undefined
                  }
                  isSelected={activePanel === "request"}
                  onClick={() => setActivePanel("request")}
                />
                <ListItem
                  label={t("settings.navUsage")}
                  startContent={
                    <Icon icon={Wallet} size={isCompact ? "lg" : "sm"} color="secondary" />
                  }
                  isSelected={activePanel === "usage"}
                  onClick={() => setActivePanel("usage")}
                />
              </AstryxList>
            </AstryxStack>
          )}

          <StackItem
            id="provider-settings-panel"
            role="tabpanel"
            size="fill"
            isScrollable
            onScroll={() => setHeaderSuggest(null)}
          >
            <VStack padding={isCompact ? 4 : 6} width="100%">
              {activePanel === "general" ? (
                <AstryxStack
                  direction="vertical"
                  as="section"
                  key="general"
                  gap={4}
                  className="provider-panel-enter"
                >
                  <AstryxStack direction="vertical" className="text-sm font-semibold">
                    {t("settings.basicInformation")}
                  </AstryxStack>

                  <VStack gap={1.5}>
                    <TextInput
                      size={isCompact ? "lg" : "md"}
                      label={t("settings.providerName")}
                      value={name}
                      onChange={(value) => {
                        setName(value);
                        if (value.trim()) setSaveAttempted(false);
                      }}
                      isRequired
                      hasAutoFocus={!initialData}
                      status={
                        saveAttempted && !name.trim()
                          ? { type: "error", message: t("settings.providerNameRequired") }
                          : undefined
                      }
                      width="100%"
                    />
                  </VStack>

                  {supportsOAuth ? (
                    <AstryxStack direction="vertical" gap={2}>
                      <Label as="label" type="label" weight="medium">
                        {t("settings.providerAuthMethod")}
                      </Label>
                      <AstryxGrid
                        data-options={providerType === "codex" ? 3 : 2}
                        columns={providerType === "codex" ? 3 : 2}
                        gap={1}
                      >
                        {(providerType === "codex"
                          ? (["api-key", "oauth-managed", "oauth-token"] as const)
                          : (["api-key", "oauth-token"] as const)
                        ).map((mode) => (
                          <ToggleButton
                            key={mode}
                            label={
                              mode === "api-key"
                                ? t("settings.providerAuthApiKey")
                                : mode === "oauth-managed"
                                  ? t("settings.providerAuthOAuth")
                                  : t("settings.providerAuthToken")
                            }
                            isPressed={authMode === mode}
                            onPressedChange={() => {
                              if (mode === authMode) return;
                              invalidateModelRequest();
                              setAuthMode(mode);
                            }}
                            size={isCompact ? "lg" : "sm"}
                          >
                            {mode === "api-key"
                              ? t("settings.providerAuthApiKey")
                              : mode === "oauth-managed"
                                ? t("settings.providerAuthOAuth")
                                : t("settings.providerAuthToken")}
                          </ToggleButton>
                        ))}
                      </AstryxGrid>
                      {authMode === "oauth-managed" ? (
                        <AstryxText
                          as="p"
                          type="inherit"
                          display="block"
                          className="text-xs leading-5 text-muted-foreground"
                        >
                          {t("settings.providerOAuthManagedHintCodex")}
                        </AstryxText>
                      ) : authMode === "oauth-token" ? (
                        <AstryxText
                          as="p"
                          type="inherit"
                          display="block"
                          className="text-xs leading-5 text-muted-foreground"
                        >
                          {providerType === "claude_code"
                            ? t("settings.providerOAuthHintAnthropic")
                            : t("settings.providerOAuthHintCodex")}
                        </AstryxText>
                      ) : null}
                    </AstryxStack>
                  ) : null}

                  <AstryxGrid
                    className="settings-provider-credentials"
                    columns={authMode === "oauth-managed" ? 1 : { minWidth: 280, max: 2 }}
                    gap={3}
                    width="100%"
                  >
                    <AstryxStack direction="vertical" gap={2}>
                      <Label as="label" type="label" weight="medium">
                        Base URL
                      </Label>
                      <Input
                        size={isCompact ? "lg" : "md"}
                        width="100%"
                        label="modal-baseurl"
                        isLabelHidden
                        id="modal-baseurl"
                        value={baseUrl}
                        onChange={(nextValue) => {
                          if (nextValue === baseUrl) return;
                          invalidateModelRequest();
                          setBaseUrl(nextValue);
                        }}
                      />
                    </AstryxStack>

                    {authMode !== "oauth-managed" ? (
                      <SecretTextInput
                        label={
                          authMode === "oauth-token" ? t("settings.providerOAuthToken") : "API Key"
                        }
                        compact={isCompact}
                        value={apiKey}
                        onChange={(nextValue) => {
                          if (nextValue === apiKey) return;
                          invalidateModelRequest();
                          setApiKey(nextValue);
                        }}
                        onFocus={(event) => {
                          if (apiKeyIsRedactedDisplay && event.target instanceof HTMLInputElement) {
                            event.target.select();
                          }
                        }}
                      />
                    ) : null}
                  </AstryxGrid>

                  {providerType !== "gemini" ? (
                    <VStack gap={1} paddingBlockStart={3}>
                      <TextInput
                        size={isCompact ? "lg" : "md"}
                        label={t("settings.providerModelsUrl")}
                        description={t("settings.providerModelsUrlHint")}
                        id="modal-models-url"
                        value={modelsUrl}
                        width="100%"
                        onChange={(nextValue) => {
                          if (nextValue === modelsUrl) return;
                          invalidateModelRequest();
                          setModelsUrl(nextValue);
                        }}
                        placeholder="https://example.com/v1/models"
                      />
                    </VStack>
                  ) : null}

                  {providerType === "codex" && authMode === "oauth-managed" ? (
                    <AstryxStack direction="vertical" gap={2}>
                      <Label as="label" type="label" weight="medium">
                        {t("settings.providerOAuthAccounts")}
                      </Label>
                      <CodexOAuthAccounts
                        value={managedOAuthAccountId}
                        onChange={(nextValue) => {
                          if (nextValue === managedOAuthAccountId) return;
                          invalidateModelRequest();
                          setManagedOAuthAccountId(nextValue);
                        }}
                        browserRuntime={isBrowser}
                      />
                    </AstryxStack>
                  ) : null}

                  {providerType === "codex" && authMode === "oauth-token" ? (
                    <AstryxStack direction="vertical" gap={2}>
                      <Label as="label" type="label" weight="medium">
                        {t("settings.providerOAuthAccountId")}
                      </Label>
                      <Input
                        size={isCompact ? "lg" : "md"}
                        width="100%"
                        label={t("settings.providerOAuthAccountIdPlaceholder")}
                        isLabelHidden
                        id="modal-oauth-account-id"
                        value={manualOAuthAccountId}
                        onChange={(nextValue) => setManualOAuthAccountId(nextValue)}
                        placeholder={t("settings.providerOAuthAccountIdPlaceholder")}
                      />
                      <AstryxText
                        as="p"
                        type="inherit"
                        display="block"
                        className="text-xs leading-5 text-muted-foreground"
                      >
                        {t("settings.providerOAuthAccountIdHint")}
                      </AstryxText>
                    </AstryxStack>
                  ) : null}

                  {providerType === "codex" ? (
                    <AstryxStack direction="vertical" gap={2}>
                      <Label as="label" type="label" weight="medium">
                        {t("settings.requestFormat")}
                      </Label>
                      <Selector
                        size={isCompact ? "lg" : "md"}
                        label={t("settings.requestFormat")}
                        isLabelHidden
                        value={requestFormat}
                        width="100%"
                        options={Object.entries(CODEX_REQUEST_FORMAT_LABELS).map(
                          ([value, label]) => ({
                            value,
                            label,
                          }),
                        )}
                        onChange={(value) => setRequestFormat(value as CodexRequestFormat)}
                      />
                    </AstryxStack>
                  ) : null}

                  <AstryxStack direction="vertical" className="mt-6 text-sm font-semibold">
                    {t("settings.models")}
                  </AstryxStack>
                  <AstryxStack direction="vertical" gap={3}>
                    <AstryxStack direction="vertical" gap={2}>
                      <Input
                        label={t("settings.searchModels")}
                        isLabelHidden
                        {...({ autoComplete: "off", spellCheck: false } as const)}
                        type="text"
                        value={modelSearch}
                        startIcon={Search}
                        hasClear
                        size={isCompact ? "lg" : "md"}
                        width="100%"
                        placeholder={t("settings.searchModels")}
                        aria-label={t("settings.searchModels")}
                        onChange={(nextValue) => {
                          modelOrderScope.current.query = nextValue.trim().toLowerCase();
                          setModelSearch(nextValue);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            modelOrderScope.current.query = "";
                            setModelSearch("");
                          }
                        }}
                      />
                      <AstryxStack direction="horizontal" gap={2} wrap="wrap">
                        {modelOrder ? (
                          <Button
                            label={t("settings.resetModelOrder")}
                            variant="ghost"
                            size={isCompact ? "lg" : "sm"}
                            onClick={() => {
                              if (
                                !usageRequest.current.active ||
                                usageRequest.current.session !== usageSession
                              )
                                return;
                              modelOrderScope.current.order = undefined;
                              setModelOrder(undefined);
                            }}
                          />
                        ) : null}
                        <ToggleButton
                          label={t("settings.skillsBulkSelect")}
                          size={isCompact ? "lg" : "sm"}
                          isPressed={modelBulkMode}
                          onPressedChange={(pressed) => {
                            modelOrderScope.current.bulk = pressed;
                            setModelBulkMode(pressed);
                            if (!pressed) setModelBulkSelection(new Set());
                          }}
                        >
                          {modelBulkMode
                            ? t("settings.skillsBulkDone")
                            : t("settings.skillsBulkSelect")}
                        </ToggleButton>
                        <Button
                          label={
                            fetchingModels ? t("settings.fetching") : t("settings.refreshModels")
                          }
                          type="button"
                          variant="secondary"
                          size={isCompact ? "lg" : "sm"}
                          onClick={handleRefresh}
                          isLoading={fetchingModels}
                          isDisabled={fetchingModels || !canFetchModels}
                        />
                        <Button
                          label={t("settings.manualAddModel")}
                          type="button"
                          variant="secondary"
                          size={isCompact ? "lg" : "sm"}
                          onClick={() => setAddingModel(true)}
                        />
                      </AstryxStack>
                    </AstryxStack>

                    {modelBulkMode ? (
                      <HStack gap={2} vAlign="center" wrap="wrap" padding={2}>
                        <CheckboxInput
                          label={t("settings.skillsBulkSelectAll")}
                          value={
                            modelBulkSelection.size === 0
                              ? false
                              : visibleModels.every((model) => modelBulkSelection.has(model.id))
                                ? true
                                : "indeterminate"
                          }
                          size={isCompact ? "md" : "sm"}
                          onChange={(checked) =>
                            setModelBulkSelection(
                              checked ? new Set(visibleModels.map((model) => model.id)) : new Set(),
                            )
                          }
                        />
                        <StackItem size="fill">
                          <Text type="supporting" color="secondary">
                            {t("settings.skillsBulkSelectedCount").replace(
                              "{count}",
                              String(modelBulkSelection.size),
                            )}
                          </Text>
                        </StackItem>
                        <Button
                          label={`${t("settings.skillsBulkEnable")} (${selectedModelsToEnable.length})`}
                          variant="ghost"
                          size={isCompact ? "lg" : "sm"}
                          isDisabled={selectedModelsToEnable.length === 0}
                          onClick={() => setModelBulkState(true)}
                        />
                        <Button
                          label={`${t("settings.skillsBulkDisable")} (${selectedModelsToDisable.length})`}
                          variant="ghost"
                          size={isCompact ? "lg" : "sm"}
                          isDisabled={selectedModelsToDisable.length === 0}
                          onClick={() => setModelBulkState(false)}
                        />
                      </HStack>
                    ) : null}

                    {fetchError ? (
                      <AstryxStack
                        direction="vertical"
                        className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                      >
                        {fetchError}
                      </AstryxStack>
                    ) : null}

                    {addingModel ? (
                      <AstryxStack
                        direction="horizontal"
                        className="flex gap-2 border-b bg-muted/20 p-2.5 max-[720px]:flex-wrap"
                      >
                        <Input
                          size={isCompact ? "lg" : "md"}
                          width="100%"
                          label={t("settings.modelName")}
                          isLabelHidden
                          hasAutoFocus
                          value={newModelName}
                          placeholder={t("settings.modelName")}
                          onChange={(nextValue) => setNewModelName(nextValue)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") handleAddModel();
                            if (event.key === "Escape") setAddingModel(false);
                          }}
                        />
                        <Button
                          variant="primary"
                          label={t("settings.add")}
                          size={isCompact ? "lg" : "sm"}
                          onClick={handleAddModel}
                        >
                          {t("settings.add")}
                        </Button>
                        <Button
                          label={t("settings.cancel")}
                          type="button"
                          variant="ghost"
                          size={isCompact ? "lg" : "sm"}
                          onClick={() => setAddingModel(false)}
                        >
                          {t("settings.cancel")}
                        </Button>
                      </AstryxStack>
                    ) : null}

                    <AstryxStack direction="vertical" className="divide-y">
                      {visibleModels.length === 0 ? (
                        <AstryxStack
                          direction="vertical"
                          className="px-3 py-8 text-center text-xs text-muted-foreground"
                        >
                          {models.length > 0 && modelSearchQuery
                            ? t("settings.noMatchingModels")
                            : baseUrl.trim() && modelFetchCredential
                              ? t("settings.fetchFailed")
                              : t("settings.fetchHint")}
                        </AstryxStack>
                      ) : (
                        visibleModels.map((model, index) => {
                          const isEditingModel = editingModel?.model.id === model.id;
                          return (
                            <AstryxStack
                              direction="vertical"
                              key={model.id}
                              className="settings-provider-model-item group hover:bg-accent/30"
                            >
                              <AstryxStack
                                direction="horizontal"
                                className="settings-provider-model-row"
                                gap={2}
                                padding={3}
                                width="100%"
                                vAlign="center"
                              >
                                <StackItem>
                                  <DropdownMenu
                                    button={{
                                      label: `${t("settings.reorderModel")}: ${model.id}`,
                                      variant: "ghost",
                                      size: isCompact ? "lg" : "md",
                                      icon: <Icon icon={GripVertical} size="sm" color="inherit" />,
                                      isIconOnly: true,
                                      isDisabled: !!modelSearchQuery || modelBulkMode,
                                    }}
                                    alignment="end"
                                    items={[
                                      {
                                        id: "up",
                                        label: t("settings.failover.moveUp"),
                                        isDisabled: index === 0,
                                        onClick: () => moveModel(model.id, -1),
                                      },
                                      {
                                        id: "down",
                                        label: t("settings.failover.moveDown"),
                                        isDisabled: index + 1 === visibleModels.length,
                                        onClick: () => moveModel(model.id, 1),
                                      },
                                    ]}
                                  />
                                </StackItem>
                                <StackItem size="fill">
                                  <HStack gap={2} vAlign="start" width="100%">
                                    {modelBulkMode ? (
                                      <CheckboxInput
                                        label={model.id}
                                        isLabelHidden
                                        value={modelBulkSelection.has(model.id)}
                                        size={isCompact ? "md" : "sm"}
                                        onChange={() => toggleModelBulkSelection(model.id)}
                                      />
                                    ) : (
                                      <DialogSwitch
                                        checked={activeModels.has(model.id)}
                                        onCheckedChange={() => toggleModel(model.id)}
                                        ariaLabel={model.id}
                                      />
                                    )}
                                    <StackItem size="fill">
                                      <VStack className="settings-provider-model-name" gap={1}>
                                        <AstryxText
                                          as="span"
                                          type="body"
                                          weight="medium"
                                          maxLines={1}
                                          className="settings-provider-model-label"
                                        >
                                          {model.id}
                                        </AstryxText>
                                        <Text
                                          className="settings-provider-model-limits"
                                          type="supporting"
                                          hasTabularNumbers
                                        >
                                          {formatTokenCount(model.contextWindow)} ctx ·{" "}
                                          {formatTokenCount(model.maxOutputToken)} out
                                        </Text>
                                      </VStack>
                                    </StackItem>
                                  </HStack>
                                </StackItem>
                                <StackItem>
                                  <DropdownMenu
                                    button={{
                                      label: `${t("settings.modelSettings")}: ${model.id}`,
                                      variant: "ghost",
                                      size: isCompact ? "lg" : "md",
                                      isIconOnly: true,
                                      icon: (
                                        <Icon icon={MoreHorizontal} size="sm" color="inherit" />
                                      ),
                                    }}
                                    alignment="end"
                                    items={[
                                      {
                                        id: "edit",
                                        label: t("settings.modelSettings"),
                                        icon: (
                                          <Icon
                                            icon={Pencil}
                                            size="sm"
                                            color={isEditingModel ? "accent" : "inherit"}
                                          />
                                        ),
                                        onClick: () => openModelSettings(model.id),
                                      },
                                      {
                                        id: "delete",
                                        label: t("settings.delete"),
                                        icon: <Icon icon={Trash2} size="sm" color="inherit" />,
                                        variant: "destructive",
                                        onClick: () => removeModel(model.id),
                                      },
                                    ]}
                                  />
                                </StackItem>
                              </AstryxStack>
                            </AstryxStack>
                          );
                        })
                      )}
                    </AstryxStack>
                  </AstryxStack>
                </AstryxStack>
              ) : activePanel === "request" ? (
                <AstryxStack
                  direction="vertical"
                  as="section"
                  key="request"
                  gap={4}
                  className="provider-panel-enter"
                >
                  <AstryxStack direction="vertical" className="text-sm font-semibold">
                    {t("settings.providerDialogRequest")}
                  </AstryxStack>

                  <AstryxStack
                    direction="horizontal"
                    className={cn(
                      "mt-3 flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors",
                      useSystemProxy && "border-primary/35 bg-primary/[0.04]",
                    )}
                  >
                    <AstryxStack
                      as="span"
                      direction="horizontal"
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                        useSystemProxy && "bg-primary/15 text-primary",
                      )}
                    >
                      <Waypoints className="h-4 w-4" />
                    </AstryxStack>
                    <AstryxStack
                      direction="vertical"
                      className="min-w-0 flex-1 text-sm font-medium"
                    >
                      {t("settings.providerUseSystemProxy")}
                    </AstryxStack>
                    <DialogSwitch
                      checked={useSystemProxy}
                      onCheckedChange={(nextValue) => {
                        if (nextValue === useSystemProxy) return;
                        invalidateModelRequest();
                        setUseSystemProxy(nextValue);
                      }}
                      ariaLabel={t("settings.providerUseSystemProxy")}
                    />
                  </AstryxStack>

                  <Section padding={4} width="100%" dividers={["top", "bottom"]}>
                    <VStack gap={3}>
                      <VStack gap={0.5}>
                        <Heading level={4}>{t("settings.providerStreamRetry")}</Heading>
                        <Text type="supporting" color="secondary">
                          {t("settings.providerStreamRetryDesc")}
                        </Text>
                      </VStack>
                      <Selector
                        size={isCompact ? "lg" : "md"}
                        label={t("settings.providerStreamRetry")}
                        isLabelHidden
                        value={streamRetryMode}
                        width="100%"
                        options={[
                          {
                            value: "default",
                            label: t("settings.providerStreamRetryDefault"),
                          },
                          { value: "off", label: t("settings.providerStreamRetryOff") },
                          {
                            value: "custom",
                            label: t("settings.providerStreamRetryCustom"),
                          },
                        ]}
                        onChange={(value) =>
                          setStreamRetryMode(value as "default" | "off" | "custom")
                        }
                      />
                      {streamRetryMode === "custom" ? (
                        <NumberInput
                          size={isCompact ? "lg" : "md"}
                          label={t("settings.providerStreamRetryMaxRetries")}
                          description={t("settings.providerStreamRetryMaxRetriesDesc")}
                          min={PROVIDER_RETRY_MAX_RETRIES_LIMITS.min}
                          max={PROVIDER_RETRY_MAX_RETRIES_LIMITS.max}
                          value={streamRetryCount}
                          isWheelEnabled={false}
                          width="100%"
                          onChange={(value) =>
                            setStreamRetryCount(value ?? PROVIDER_RETRY_DEFAULT_MAX_RETRIES)
                          }
                        />
                      ) : null}
                    </VStack>
                  </Section>

                  {providerType === "claude_code" || providerType === "codex" ? (
                    <Section
                      padding={4}
                      width="100%"
                      className={cn(
                        "mt-3 rounded-xl border bg-card transition-colors",
                        promptCachingEnabled && "border-primary/35 bg-primary/[0.04]",
                      )}
                    >
                      <HStack gap={3} vAlign="center">
                        <AstryxStack
                          as="span"
                          direction="horizontal"
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                            promptCachingEnabled && "bg-primary/15 text-primary",
                          )}
                        >
                          <Zap className="h-4 w-4" />
                        </AstryxStack>
                        <StackItem size="fill">
                          <AstryxStack direction="vertical" className="text-sm font-medium">
                            {t("settings.promptCaching")}
                          </AstryxStack>
                          <AstryxStack
                            direction="vertical"
                            className="text-xs text-muted-foreground"
                          >
                            {providerType === "claude_code"
                              ? t("settings.promptCachingDescClaude")
                              : t("settings.promptCachingDescCodex")}
                          </AstryxStack>
                        </StackItem>
                        <DialogSwitch
                          checked={promptCachingEnabled}
                          onCheckedChange={setPromptCachingEnabled}
                          ariaLabel={t("settings.promptCaching")}
                        />
                      </HStack>
                      {providerType === "claude_code" && promptCachingEnabled ? (
                        <AstryxStack
                          direction="horizontal"
                          className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
                        >
                          <AstryxText
                            as="span"
                            type="inherit"
                            className="text-xs text-muted-foreground"
                          >
                            {t("settings.promptCacheRetention")}
                          </AstryxText>
                          {(
                            [
                              ["short", "settings.promptCacheRetentionShort"],
                              ["long", "settings.promptCacheRetentionLong"],
                            ] as const
                          ).map(([value, labelKey]) => (
                            <ToggleButton
                              key={value}
                              label={t(labelKey)}
                              isPressed={promptCacheRetention === value}
                              onPressedChange={() => setPromptCacheRetention(value)}
                              size={isCompact ? "lg" : "sm"}
                            >
                              {t(labelKey)}
                            </ToggleButton>
                          ))}
                        </AstryxStack>
                      ) : null}
                      {providerType === "codex" && promptCachingEnabled ? (
                        <Selector
                          size={isCompact ? "lg" : "md"}
                          label={t("settings.promptCacheHintMode")}
                          width="100%"
                          value={promptCacheHintMode}
                          options={PROVIDER_CACHE_HINT_OPTIONS.map((option) => ({
                            value: option.value,
                            label: t(option.labelKey),
                          }))}
                          onChange={(value) => {
                            if (
                              !usageRequest.current.active ||
                              usageRequest.current.session !== usageSession
                            )
                              return;
                            acceptedCacheHint.current = value as PromptCacheHintMode;
                            setPromptCacheHintMode(value as PromptCacheHintMode);
                          }}
                        />
                      ) : null}
                    </Section>
                  ) : null}

                  <AstryxStack
                    direction="horizontal"
                    gap={2}
                    wrap="wrap"
                    hAlign="between"
                    vAlign="center"
                  >
                    <AstryxStack direction="horizontal" gap={2} vAlign="center">
                      <AstryxText as="span" type="inherit" className="text-sm font-semibold">
                        {t("settings.customHeaders")}
                      </AstryxText>
                      {customHeaders.length > 0 ? (
                        <AstryxText
                          as="span"
                          type="inherit"
                          className="settings-provider-header-count rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                        >
                          {customHeaders.length}
                        </AstryxText>
                      ) : null}
                    </AstryxStack>
                    <Button
                      label={t("settings.addCustomHeader")}
                      type="button"
                      variant="secondary"
                      size={isCompact ? "lg" : "sm"}
                      onClick={() => addCustomHeader()}
                      isDisabled={isBrowser}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t("settings.addCustomHeader")}
                    </Button>
                  </AstryxStack>

                  {customHeaders.length === 0 ? (
                    <EmptyState
                      isCompact
                      icon={<Icon icon={List} size={isCompact ? "lg" : "sm"} color="inherit" />}
                      title={t("settings.noCustomHeaders")}
                      description={t("settings.noCustomHeadersHint")}
                      actions={
                        <AstryxNativeButton
                          label={t("settings.addCustomHeader")}
                          variant="secondary"
                          size={isCompact ? "lg" : "sm"}
                          isDisabled={isBrowser}
                          onClick={() => addCustomHeader()}
                        />
                      }
                    />
                  ) : (
                    <AstryxStack direction="vertical" gap={2}>
                      <AstryxStack
                        direction="vertical"
                        className="-m-0.5 max-h-[196px] space-y-2 overflow-y-auto p-0.5 max-[720px]:max-h-[360px]"
                        onScroll={() => setHeaderSuggest(null)}
                      >
                        {customHeaders.map((header, index) => {
                          const issue = getCustomHeaderKeyIssue(
                            header.key,
                            headerValidationSubmitted,
                          );
                          const valueIssue = !isValidCustomHeaderValue(header.value);
                          const issueTitle =
                            issue === "reserved"
                              ? t("settings.customHeaderReservedTitle")
                              : issue === "invalid"
                                ? t("settings.invalidCustomHeaderKey")
                                : undefined;
                          const valueVisible = visibleHeaderValues.has(index);
                          const suggestOpen =
                            headerSuggest?.index === index && headerSuggestItems.length > 0;

                          return (
                            <AstryxStack
                              direction={isCompact ? "vertical" : "horizontal"}
                              gap={2}
                              key={index}
                              className={cn(
                                "settings-provider-header-row provider-panel-enter group",
                                (issue || valueIssue) &&
                                  "border-destructive/60 focus-within:border-destructive focus-within:ring-destructive/10",
                              )}
                            >
                              <Input
                                size={isCompact ? "lg" : "md"}
                                width="100%"
                                label={t("settings.customHeaderName")}
                                isLabelHidden
                                {...({ autoComplete: "off", spellCheck: false } as const)}
                                type="text"
                                ref={(element) => {
                                  headerKeyRefs.current[index] = element;
                                }}
                                value={header.key}
                                isDisabled={isBrowser}
                                className={cn("font-mono", issue && "text-destructive")}
                                placeholder={t("settings.customHeaderKeyPlaceholder")}
                                aria-label={t("settings.customHeaderName")}
                                aria-invalid={issue ? true : undefined}
                                role="combobox"
                                aria-expanded={suggestOpen}
                                aria-controls={suggestOpen ? "provider-header-suggest" : undefined}
                                aria-autocomplete="list"
                                labelTooltip={issueTitle}
                                onChange={(nextValue) => {
                                  updateCustomHeader(index, "key", nextValue);
                                  openHeaderSuggest(index);
                                }}
                                onFocus={() => openHeaderSuggest(index)}
                                onBlur={() => setHeaderSuggest(null)}
                                onKeyDown={(event) => {
                                  if (event.key === "ArrowDown") {
                                    event.preventDefault();
                                    if (suggestOpen) {
                                      setHeaderSuggestActive(
                                        (headerSuggestActiveIndex + 1) % headerSuggestItems.length,
                                      );
                                    } else {
                                      openHeaderSuggest(index);
                                    }
                                    return;
                                  }
                                  if (event.key === "ArrowUp" && suggestOpen) {
                                    event.preventDefault();
                                    setHeaderSuggestActive(
                                      (headerSuggestActiveIndex - 1 + headerSuggestItems.length) %
                                        headerSuggestItems.length,
                                    );
                                    return;
                                  }
                                  if (event.key === "Escape" && headerSuggest) {
                                    event.preventDefault();
                                    setHeaderSuggest(null);
                                    return;
                                  }
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  if (suggestOpen) {
                                    applyHeaderSuggestion(
                                      headerSuggestItems[headerSuggestActiveIndex],
                                    );
                                    return;
                                  }
                                  focusCustomHeader(index, "value");
                                }}
                              />
                              <AstryxStack
                                direction="vertical"
                                className="settings-provider-header-value relative min-w-0 flex-1 max-[720px]:basis-full"
                              >
                                <Input
                                  size={isCompact ? "lg" : "md"}
                                  width="100%"
                                  label={t("settings.customHeaderValue")}
                                  isLabelHidden
                                  {...({ autoComplete: "off", spellCheck: false } as const)}
                                  ref={(element) => {
                                    headerValueRefs.current[index] = element;
                                  }}
                                  type={valueVisible ? "text" : "password"}
                                  value={header.value}
                                  aria-invalid={valueIssue ? true : undefined}
                                  labelTooltip={
                                    valueIssue ? t("settings.invalidCustomHeaderValue") : undefined
                                  }
                                  isDisabled={isBrowser}
                                  className="font-mono"
                                  placeholder={t("settings.customHeaderValue")}
                                  aria-label={t("settings.customHeaderValue")}
                                  onChange={(nextValue) =>
                                    updateCustomHeader(index, "value", nextValue)
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key !== "Enter") return;
                                    event.preventDefault();
                                    if (index === customHeaders.length - 1) addCustomHeader();
                                    else focusCustomHeader(index + 1, "key");
                                  }}
                                />
                                <AstryxStack direction="horizontal" gap={1} hAlign="end">
                                  <Button
                                    label={
                                      valueVisible
                                        ? t("settings.hideCustomHeaderValue")
                                        : t("settings.showCustomHeaderValue")
                                    }
                                    type="button"
                                    variant="ghost"
                                    size={isCompact ? "lg" : "md"}
                                    isIconOnly
                                    icon={
                                      <Icon
                                        icon={valueVisible ? EyeOff : Eye}
                                        size="sm"
                                        color="inherit"
                                      />
                                    }
                                    onClick={() => toggleCustomHeaderValue(index)}
                                    isDisabled={isBrowser}
                                    tooltip={
                                      valueVisible
                                        ? t("settings.hideCustomHeaderValue")
                                        : t("settings.showCustomHeaderValue")
                                    }
                                    aria-label={
                                      valueVisible
                                        ? t("settings.hideCustomHeaderValue")
                                        : t("settings.showCustomHeaderValue")
                                    }
                                  />
                                  <Button
                                    label={t("settings.removeCustomHeader")}
                                    type="button"
                                    variant="ghost"
                                    size={isCompact ? "lg" : "md"}
                                    isIconOnly
                                    icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                                    onClick={() => removeCustomHeader(index)}
                                    isDisabled={isBrowser}
                                    tooltip={t("settings.removeCustomHeader")}
                                    aria-label={t("settings.removeCustomHeader")}
                                  />
                                </AstryxStack>
                              </AstryxStack>
                            </AstryxStack>
                          );
                        })}
                      </AstryxStack>
                    </AstryxStack>
                  )}

                  {headerIssueMessage ? (
                    <AstryxText
                      as="p"
                      type="inherit"
                      display="block"
                      className="mt-2 text-xs leading-relaxed text-destructive"
                      role="alert"
                    >
                      {headerIssueMessage}
                    </AstryxText>
                  ) : null}

                  {headerSuggest && headerSuggestItems.length > 0 ? (
                    <Popover
                      anchorRef={{
                        current: headerKeyRefs.current[headerSuggest.index] as HTMLElement,
                      }}
                      isOpen
                      onOpenChange={(isOpen) => {
                        if (!isOpen) setHeaderSuggest(null);
                      }}
                      placement="below"
                      alignment="start"
                      width="var(--xgent-provider-header-menu-width)"
                      label={t("settings.customHeaderKeyPlaceholder")}
                      role="none"
                      hasAutoFocus={false}
                      hasCloseButton={false}
                      content={
                        <AstryxStack
                          direction="vertical"
                          id="provider-header-suggest"
                          role="listbox"
                        >
                          {headerSuggestItems.map((preset, itemIndex) => (
                            <AstryxButton
                              variant="ghost"
                              label={preset}
                              key={preset}
                              type="button"
                              role="option"
                              aria-selected={itemIndex === headerSuggestActiveIndex}
                              className={cn(
                                "flex w-full items-center rounded-md px-2.5 py-2 text-left font-mono text-xs text-muted-foreground transition-colors",
                                itemIndex === headerSuggestActiveIndex &&
                                  "bg-accent text-foreground",
                              )}
                              onMouseDown={(event) => event.preventDefault()}
                              onMouseEnter={() => setHeaderSuggestActive(itemIndex)}
                              onClick={() => applyHeaderSuggestion(preset)}
                            >
                              {preset}
                            </AstryxButton>
                          ))}
                        </AstryxStack>
                      }
                    />
                  ) : null}
                </AstryxStack>
              ) : (
                <VStack as="section" key="usage" className="provider-panel-enter" gap={4}>
                  <HStack gap={3} vAlign="center">
                    <Wallet aria-hidden="true" />
                    <StackItem size="fill">
                      <VStack gap={0.5}>
                        <AstryxText
                          as="p"
                          type="inherit"
                          display="block"
                          className="text-sm font-semibold"
                        >
                          {t("settings.usage.title")}
                        </AstryxText>
                        <AstryxText
                          as="p"
                          type="inherit"
                          display="block"
                          className="text-xs text-muted-foreground"
                        >
                          {t("settings.usage.desc")}
                        </AstryxText>
                      </VStack>
                    </StackItem>
                    <Switch
                      label={t("settings.usage.title")}
                      isLabelHidden
                      size={isCompact ? "md" : "sm"}
                      value={usageQuery.enabled}
                      onChange={(enabled) => patchUsageQuery({ enabled })}
                    />
                  </HStack>

                  <Selector
                    size={isCompact ? "lg" : "md"}
                    label={t("settings.usage.mode")}
                    value={usageQuery.mode}
                    onChange={(mode) =>
                      acceptUsageQuery(
                        switchUsageQueryMode(acceptedUsageQuery.current, mode as UsageQueryMode),
                      )
                    }
                    options={USAGE_QUERY_MODES.map((mode) => ({
                      value: mode,
                      label: t(`settings.usage.mode.${mode}`),
                    }))}
                    width="100%"
                  />
                  <NumberInput
                    size={isCompact ? "lg" : "md"}
                    label={t("settings.usage.timeout")}
                    min={2}
                    max={30}
                    value={usageQuery.timeoutSecs ?? 10}
                    isWheelEnabled={false}
                    width="100%"
                    onChange={(value) => patchUsageQuery({ timeoutSecs: value ?? 10 })}
                  />
                  <TextInput
                    size={isCompact ? "lg" : "md"}
                    label={t("settings.usage.baseUrl")}
                    value={usageQuery.baseUrl}
                    placeholder={baseUrl}
                    width="100%"
                    onChange={(usageBaseUrl) => patchUsageQuery({ baseUrl: usageBaseUrl })}
                  />
                  <SecretTextInput
                    label="API Key"
                    compact={isCompact}
                    value={usageQuery.apiKey}
                    placeholder={
                      usageQuery.apiKeyConfigured
                        ? t("settings.usage.secretSaved")
                        : t("settings.usage.providerCredential")
                    }
                    onChange={(usageApiKey) => patchUsageQuery({ apiKey: usageApiKey })}
                  />

                  {usageQuery.mode === "newapi" ? (
                    <VStack gap={3}>
                      <SecretTextInput
                        label="Access Token"
                        compact={isCompact}
                        value={usageQuery.accessToken}
                        onChange={(accessToken) => patchUsageQuery({ accessToken })}
                      />
                      <TextInput
                        size={isCompact ? "lg" : "md"}
                        label="User ID"
                        value={usageQuery.userId}
                        width="100%"
                        onChange={(userId) => patchUsageQuery({ userId })}
                      />
                    </VStack>
                  ) : null}

                  {usageQuery.mode === "coding-plan" ? (
                    <VStack gap={3}>
                      <TextInput
                        size={isCompact ? "lg" : "md"}
                        label="Plan Provider"
                        value={usageQuery.codingPlanProvider}
                        placeholder="auto / zhipu_team / zenmux"
                        width="100%"
                        onChange={(codingPlanProvider) => patchUsageQuery({ codingPlanProvider })}
                      />
                      <TextInput
                        size={isCompact ? "lg" : "md"}
                        label="Organization ID"
                        value={usageQuery.teamOrganizationId}
                        width="100%"
                        onChange={(teamOrganizationId) => patchUsageQuery({ teamOrganizationId })}
                      />
                      <TextInput
                        size={isCompact ? "lg" : "md"}
                        label="Project ID"
                        value={usageQuery.teamProjectId}
                        width="100%"
                        onChange={(teamProjectId) => patchUsageQuery({ teamProjectId })}
                      />
                      <TextInput
                        size={isCompact ? "lg" : "md"}
                        label="Access Key ID"
                        value={usageQuery.accessKeyId}
                        width="100%"
                        onChange={(accessKeyId) => patchUsageQuery({ accessKeyId })}
                      />
                      <SecretTextInput
                        label="Secret Access Key"
                        compact={isCompact}
                        value={usageQuery.secretAccessKey}
                        onChange={(secretAccessKey) => patchUsageQuery({ secretAccessKey })}
                      />
                    </VStack>
                  ) : null}

                  {usageQuery.mode === "general" ||
                  usageQuery.mode === "newapi" ||
                  usageQuery.mode === "custom" ? (
                    <TextArea
                      label={t("settings.usage.script")}
                      value={usageQuery.script}
                      rows={8}
                      width="100%"
                      hasSpellCheck={false}
                      placeholder={
                        usageQuery.mode === "custom"
                          ? t("settings.usage.scriptRequired")
                          : t("settings.usage.scriptPreset")
                      }
                      onChange={(script) => patchUsageQuery({ script })}
                    />
                  ) : null}

                  <HStack gap={2} wrap="wrap">
                    <AstryxNativeButton
                      label={t("settings.usage.test")}
                      variant="secondary"
                      size={isCompact ? "lg" : "md"}
                      isLoading={usageTest.loading}
                      isDisabled={!initialData?.id || usageTest.loading}
                      onClick={() => void runUsageQueryTest()}
                    />
                    {!initialData?.id ? (
                      <AstryxText
                        as="p"
                        type="inherit"
                        display="block"
                        className="text-xs text-muted-foreground"
                      >
                        {t("settings.usage.saveBeforeTest")}
                      </AstryxText>
                    ) : null}
                  </HStack>
                  {usageTest.error ? (
                    <Banner status="error" title={usageTest.error} collapsible={false} />
                  ) : usageTest.result ? (
                    <Banner
                      status="success"
                      title={t("settings.usage.testSuccess").replace(
                        "{count}",
                        String(usageTest.result.data.length),
                      )}
                      collapsible={false}
                    />
                  ) : null}
                </VStack>
              )}
            </VStack>
          </StackItem>
        </Stack>
      </StackItem>

      <Section
        className="settings-provider-editor-footer"
        variant="transparent"
        padding={3}
        dividers={isCompact ? [] : ["top"]}
      >
        <HStack hAlign="end" width="100%">
          <AstryxGrid columns={2} gap={2} width="100%" maxWidth={isCompact ? undefined : 280}>
            <AstryxNativeButton
              label={t("settings.cancel")}
              variant="secondary"
              size={isCompact ? "lg" : "md"}
              onClick={closeEditor}
              width={isCompact ? "100%" : undefined}
            />
            <AstryxNativeButton
              label={t("settings.save")}
              variant="primary"
              size={isCompact ? "lg" : "md"}
              onClick={handleSave}
              width={isCompact ? "100%" : undefined}
            />
          </AstryxGrid>
        </HStack>
      </Section>
      {editingModel ? (
        <Dialog
          isOpen
          className="settings-provider-model-dialog"
          onOpenChange={(open) => {
            if (!open) updatePresentedModel(null);
          }}
          aria-label={t("settings.modelSettings")}
          purpose="info"
          variant={isCompact ? "fullscreen" : "standard"}
          width={isCompact ? "100dvw" : "var(--xgent-extension-preview-width)"}
          maxHeight="var(--xgent-extension-preview-height)"
          padding={0}
          style={{ blockSize: isCompact ? "100dvh" : "var(--xgent-extension-preview-height)" }}
        >
          <VStack height="100%" minHeight={0} gap={0}>
            <CompactDialogHeader
              title={editingModel.model.id}
              subtitle={t("settings.modelSettings")}
              compact={isCompact}
              closeLabel={t("settings.close")}
              onClose={() => updatePresentedModel(null)}
            />
            <StackItem size="fill" isScrollable className="settings-provider-model-dialog-body">
              <VStack gap={3} padding={4} width="100%">
                {supportsModelInputOverride(providerType) ? (
                  <Selector
                    size={isCompact ? "lg" : "md"}
                    label={t("settings.modelInput")}
                    width="100%"
                    value={modelInputMode(editingModel.model)}
                    options={MODEL_INPUT_OPTIONS.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey),
                    }))}
                    onChange={(value) =>
                      updatePresentedModel((previous) =>
                        previous
                          ? {
                              ...previous,
                              model: withModelInputMode(previous.model, value as ModelInputMode),
                            }
                          : previous,
                      )
                    }
                  />
                ) : null}
                {providerType === "codex" ? (
                  <Selector
                    size={isCompact ? "lg" : "md"}
                    label={t("settings.promptCacheHintModelOverride")}
                    width="100%"
                    value={editingModel.model.promptCacheHintMode ?? "inherit"}
                    options={[
                      {
                        value: "inherit",
                        label: t("settings.promptCacheHintMode.inherit"),
                      },
                      ...PROVIDER_CACHE_HINT_OPTIONS.map((option) => ({
                        value: option.value,
                        label: t(option.labelKey),
                      })),
                    ]}
                    onChange={(value) =>
                      updatePresentedModel((previous) =>
                        previous
                          ? {
                              ...previous,
                              model: {
                                ...previous.model,
                                promptCacheHintMode:
                                  value === "inherit" ? undefined : (value as PromptCacheHintMode),
                              },
                            }
                          : previous,
                      )
                    }
                  />
                ) : null}
                <AstryxGrid columns={{ minWidth: 240, max: 2 }} gap={3} width="100%">
                  <AstryxStack direction="vertical" gap={2}>
                    <Input
                      size={isCompact ? "lg" : "md"}
                      width="100%"
                      label={t("settings.contextWindow")}
                      {...({ inputMode: "numeric" } as const)}
                      type="text"
                      aria-invalid={editingModelContextWindow === null ? true : undefined}
                      status={editingModelContextWindow === null ? { type: "error" } : undefined}
                      value={editingModel.contextWindow}
                      onChange={(nextValue) => {
                        const value = nextValue;
                        updatePresentedModel((prev) =>
                          prev ? { ...prev, contextWindow: value } : prev,
                        );
                      }}
                    />
                  </AstryxStack>
                  <AstryxStack direction="vertical" gap={2}>
                    <Input
                      size={isCompact ? "lg" : "md"}
                      width="100%"
                      label={t("settings.maxOutputToken")}
                      {...({ inputMode: "numeric" } as const)}
                      type="text"
                      aria-invalid={editingModelMaxOutputToken === null ? true : undefined}
                      status={editingModelMaxOutputToken === null ? { type: "error" } : undefined}
                      value={editingModel.maxOutputToken}
                      onChange={(nextValue) => {
                        const value = nextValue;
                        updatePresentedModel((prev) =>
                          prev ? { ...prev, maxOutputToken: value } : prev,
                        );
                      }}
                    />
                  </AstryxStack>
                </AstryxGrid>

                <Text type="body" weight="medium" wordBreak="break-word">
                  {t("settings.modelCost")}
                </Text>
                <Text type="supporting" color="secondary" wordBreak="break-word">
                  {t("settings.modelCostHint")}
                </Text>
                <AstryxGrid columns={{ minWidth: 240, max: 2 }} gap={3} width="100%">
                  {(
                    [
                      ["costInput", "settings.modelCostInput"],
                      ["costOutput", "settings.modelCostOutput"],
                      ["costCacheRead", "settings.modelCostCacheRead"],
                      ["costCacheWrite", "settings.modelCostCacheWrite"],
                    ] as const
                  ).map(([field, labelKey]) => (
                    <AstryxStack direction="vertical" key={field} gap={2}>
                      <Input
                        size={isCompact ? "lg" : "md"}
                        width="100%"
                        label={t(labelKey)}
                        {...({ inputMode: "decimal" } as const)}
                        type="text"
                        placeholder="0"
                        aria-invalid={
                          parseCostRate(editingModel[field]) === null ? true : undefined
                        }
                        status={
                          parseCostRate(editingModel[field]) === null
                            ? { type: "error" }
                            : undefined
                        }
                        value={editingModel[field]}
                        onChange={(nextValue) => {
                          const value = nextValue;
                          updatePresentedModel((prev) =>
                            prev ? { ...prev, [field]: value } : prev,
                          );
                        }}
                      />
                    </AstryxStack>
                  ))}
                </AstryxGrid>

                {!canSaveEditingModel ? (
                  <Banner
                    status="error"
                    title={t("settings.modelParametersInvalid")}
                    collapsible={false}
                  />
                ) : null}
              </VStack>
            </StackItem>
            <Section
              className="settings-provider-model-dialog-footer"
              padding={3}
              width="100%"
              dividers={["top"]}
            >
              <AstryxStack direction="horizontal" gap={2} hAlign="end" wrap="wrap">
                <ConfirmDeletePopover
                  name={editingModel.model.id}
                  onConfirm={() => {
                    if (ownsModelDialog() && presentedModelId) removeModel(presentedModelId);
                  }}
                >
                  {(open) => (
                    <Button
                      label={t("settings.delete")}
                      variant="destructive"
                      size={isCompact ? "lg" : "sm"}
                      onClick={open}
                    />
                  )}
                </ConfirmDeletePopover>
                <Button
                  label={t("settings.cancel")}
                  type="button"
                  variant="secondary"
                  size={isCompact ? "lg" : "sm"}
                  onClick={() => updatePresentedModel(null)}
                >
                  {t("settings.cancel")}
                </Button>
                <Button
                  variant="primary"
                  label={t("settings.save")}
                  type="button"
                  size={isCompact ? "lg" : "sm"}
                  isDisabled={!canSaveEditingModel}
                  onClick={saveModelSettings}
                >
                  {t("settings.save")}
                </Button>
              </AstryxStack>
            </Section>
          </VStack>
        </Dialog>
      ) : null}
    </VStack>
  );
}

function ProviderAdvancedSettingsPanel(
  props: SettingsSectionProps & { providerType: ProviderId; onClose: () => void },
) {
  const { settings, setSettings, providerType, onClose } = props;
  const { t } = useLocale();
  const {
    available: modelOptions,
    value: selectedValue,
    options: titleModelOptions,
  } = useMemo(() => runtimeModelOptions(settings, "conversationTitleModel"), [settings]);
  const { value: commitSelectedValue, options: commitModelOptions } = useMemo(
    () => runtimeModelOptions(settings, "commitMessageModel"),
    [settings],
  );
  const { setModel: handleModelChange, resetRuntimeConfiguration } =
    providerRuntimeActions(setSettings);

  return (
    <VStack height="100%" minHeight={0} gap={0}>
      <SettingsDetailHeader
        title={t("settings.customSettings")}
        subtitle={t("settings.conversationTitleModelHint")}
        startContent={
          <IconButton
            label={t("settings.closeCustomSettings")}
            tooltip={t("settings.closeCustomSettings")}
            variant="ghost"
            icon={<Icon icon={ChevronLeft} size="md" color="inherit" />}
            size="lg"
            onClick={onClose}
          />
        }
      />

      <StackItem size="fill" isScrollable>
        <VStack
          width="100%"
          maxWidth="var(--xgent-settings-content-max-width)"
          gap={5}
          padding={5}
          style={{ marginInline: "auto" }}
        >
          <VStack gap={3}>
            <VStack gap={0.5}>
              <Heading level={4}>{t("settings.conversationTitleModel")}</Heading>
              <Text type="supporting" color="secondary">
                {t("settings.conversationTitleModelHint")}
              </Text>
            </VStack>
            <ModelPicker
              options={titleModelOptions}
              value={selectedValue}
              onChange={(value) => handleModelChange("conversationTitleModel", value)}
              placeholder={t("settings.conversationTitleModelFollowCurrent")}
              noneLabel={t("settings.conversationTitleModelFollowCurrent")}
              ariaLabel={t("settings.conversationTitleModel")}
            />
            <VStack gap={0.5}>
              <Heading level={4}>{t("settings.commitMessageModel")}</Heading>
            </VStack>
            <ModelPicker
              options={commitModelOptions}
              value={commitSelectedValue}
              onChange={(value) => handleModelChange("commitMessageModel", value)}
              placeholder={t("settings.conversationTitleModelFollowCurrent")}
              noneLabel={t("settings.conversationTitleModelFollowCurrent")}
              ariaLabel={t("settings.commitMessageModel")}
            />
            {modelOptions.length === 0 ? (
              <Banner
                status="info"
                title={t("settings.customSettingsModelEmpty")}
                collapsible={false}
              />
            ) : null}
          </VStack>

          <ModelFailoverSection
            settings={settings}
            setSettings={setSettings}
            providerType={providerType}
            compact
          />

          <RetryErrorSection settings={settings} setSettings={setSettings} />

          <ConfirmActionPopover
            title={t("settings.providerRuntimeResetTitle")}
            description={t("settings.providerRuntimeResetDescription")}
            confirmLabel={t("settings.providerRuntimeResetConfirm")}
            onConfirm={resetRuntimeConfiguration}
          >
            {(open) => (
              <AstryxNativeButton
                label={t("settings.providerRuntimeReset")}
                variant="secondary"
                onClick={open}
              />
            )}
          </ConfirmActionPopover>
        </VStack>
      </StackItem>
    </VStack>
  );
}

function CcsProviderRow(props: {
  item: CcsProviderImportItem;
  exists: boolean;
  transferable: boolean;
  selectable: boolean;
  isSelected: boolean;
  submitting: boolean;
  onChange: () => void;
}) {
  const { item, exists, transferable, selectable, isSelected, submitting, onChange } = props;
  const checkboxRef = useRef<HTMLInputElement>(null);
  const statusLabel = exists ? "已导入" : transferable ? "可以导入" : "无 API 或模型配置";

  return (
    <ListItem
      label={item.name}
      description={
        <VStack gap={1}>
          <Text type="supporting" color="secondary">
            {item.baseUrl || "未配置 Base URL"}
          </Text>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <StatusDot
              variant={exists ? "neutral" : transferable ? "success" : "warning"}
              label={statusLabel}
            />
            <Text type="supporting" color="secondary">
              {statusLabel}
            </Text>
            {item.apiKey.trim() ? (
              <Text type="supporting" color="secondary">
                已包含 API Key
              </Text>
            ) : null}
          </HStack>
        </VStack>
      }
      startContent={
        <CheckboxInput
          ref={checkboxRef}
          label={item.name}
          isLabelHidden
          value={selectable && isSelected}
          isDisabled={!selectable || submitting}
          disabledMessage={!selectable ? statusLabel : undefined}
          onChange={onChange}
          size="sm"
        />
      }
      interactiveRef={checkboxRef}
      isDisabled={!selectable || submitting}
    />
  );
}

function CcsImportModal(props: {
  initialType: ProviderId;
  items: CcsProviderImportItem[];
  existingProviders: CustomProvider[];
  message: string | null;
  onRefresh: () => void;
  onImport: (items: CcsProviderImportItem[]) => Promise<string>;
  onClose: () => void;
}) {
  const { initialType, items, existingProviders, message, onRefresh, onImport, onClose } = props;
  const { t } = useLocale();
  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );

  const existingIdentity = useMemo(
    () => new Set(existingProviders.map(ccsImportIdentity)),
    [existingProviders],
  );
  const rows = useMemo(
    () =>
      items.map((item) => {
        const exists = existingIdentity.has(
          ccsImportIdentity({ type: item.providerType, name: item.name, baseUrl: item.baseUrl }),
        );
        const transferable = ccsProviderIsTransferable(item);
        return {
          item,
          key: ccsItemKey(item),
          exists,
          transferable,
          selectable: transferable && !exists,
        };
      }),
    [items, existingIdentity],
  );
  // All provider types in one modal, the tab the user came from leading.
  const groups = useMemo(() => {
    const order = [initialType, ...PROVIDER_TABS.filter((tab) => tab !== initialType)];
    return order
      .map((type) => ({ type, rows: rows.filter((row) => row.item.providerType === type) }))
      .filter((group) => group.rows.length > 0);
  }, [rows, initialType]);

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rows.filter((row) => row.selectable).map((row) => row.key)),
  );
  const [result, setResult] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);
  // Import resolves as soon as the configs are written locally; this only
  // guards the brief await against double-submit.
  const [submitting, setSubmitting] = useState(false);
  const [activeType, setActiveType] = useState<ProviderId>(initialType);

  const selectableKeys = rows.filter((row) => row.selectable).map((row) => row.key);
  const selectedCount = selectableKeys.filter((key) => selected.has(key)).length;

  // The initial tab may have no discovered configs — fall back to the first
  // group that does.
  const activeGroup = groups.find((group) => group.type === activeType) ?? groups[0];
  const activeRows = activeGroup?.rows ?? [];
  const activeSelectableKeys = activeRows.filter((row) => row.selectable).map((row) => row.key);
  const activeSelectedCount = activeSelectableKeys.filter((key) => selected.has(key)).length;
  const activeAllSelected =
    activeSelectableKeys.length > 0 && activeSelectedCount === activeSelectableKeys.length;

  useEffect(() => {
    setSelected(new Set(rows.filter((row) => row.selectable).map((row) => row.key)));
  }, [rows]);

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllActive() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of activeSelectableKeys) {
        if (activeAllSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  }

  async function handleImport() {
    const chosen = rows
      .filter((row) => row.selectable && selected.has(row.key))
      .map((row) => row.item);
    if (!chosen.length || submitting) return;
    setResult(null);
    setSubmitting(true);
    try {
      const summary = await onImport(chosen);
      setResult({ status: "success", message: summary });
      setSelected(new Set());
    } catch (err) {
      setResult({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsModalShell onClose={onClose} purpose="form" ariaLabel="CC Switch">
      <VStack width="100%" height="100%" minHeight={0} gap={0}>
        <SettingsDetailHeader
          title="从 CC Switch 导入"
          subtitle="选择要导入的供应商配置；导入后会自动获取并激活模型。"
          startContent={
            <IconButton
              label="返回"
              tooltip="返回供应商配置"
              variant="ghost"
              size="lg"
              icon={<Icon icon={ChevronLeft} size="md" color="inherit" />}
              isDisabled={submitting}
              onClick={onClose}
            />
          }
          endContent={<Icon icon={Download} size="sm" color="secondary" />}
        />

        {result ? (
          <VStack padding={3}>
            <Banner
              status={result.status}
              title={result.status === "success" ? "导入完成" : "导入失败"}
              description={result.message}
            />
          </VStack>
        ) : null}

        <StackItem size="fill">
          {groups.length === 0 ? (
            <VStack width="100%" height="100%" hAlign="center" vAlign="center" padding={5}>
              <EmptyState
                title="未发现可导入的 CC Switch 配置"
                description={message || "请确认 CC Switch 已配置供应商，然后重新扫描。"}
                actions={
                  <AstryxNativeButton
                    label={t("settings.refreshLocalProviderConfigs")}
                    variant="secondary"
                    size="sm"
                    onClick={onRefresh}
                    isDisabled={submitting}
                  />
                }
              />
            </VStack>
          ) : (
            <HStack width="100%" height="100%" minHeight={0} gap={0}>
              {isCompact ? null : (
                <VStack width="30%" minHeight={0} padding={2}>
                  <AstryxList density="compact">
                    {groups.map((group) => {
                      const groupSelected = group.rows.filter(
                        (row) => row.selectable && selected.has(row.key),
                      ).length;
                      return (
                        <ListItem
                          key={group.type}
                          label={getProviderLabel(group.type)}
                          description={`${group.rows.length} 项配置`}
                          startContent={<ProviderBrandIcon type={group.type} />}
                          endContent={
                            groupSelected > 0 ? (
                              <Badge label={groupSelected} variant="neutral" />
                            ) : undefined
                          }
                          isSelected={group.type === activeGroup?.type}
                          onClick={() => setActiveType(group.type)}
                        />
                      );
                    })}
                  </AstryxList>
                </VStack>
              )}

              <StackItem size="fill">
                <VStack width="100%" height="100%" minHeight={0} gap={0}>
                  {isCompact ? (
                    <TabList
                      value={activeGroup?.type ?? groups[0].type}
                      onChange={(value) => setActiveType(value as ProviderId)}
                      role="tablist"
                      overflow="scroll"
                      size="sm"
                    >
                      {groups.map((group) => {
                        const groupSelected = group.rows.filter(
                          (row) => row.selectable && selected.has(row.key),
                        ).length;
                        return (
                          <Tab
                            key={group.type}
                            value={group.type}
                            label={getProviderLabel(group.type)}
                            panelId="cc-switch-provider-import-panel"
                            icon={<ProviderBrandIcon type={group.type} />}
                            endContent={
                              groupSelected > 0 ? (
                                <Badge label={groupSelected} variant="neutral" />
                              ) : undefined
                            }
                          />
                        );
                      })}
                    </TabList>
                  ) : null}

                  <HStack width="100%" padding={3} hAlign="between" vAlign="center" gap={2}>
                    <Text type="supporting" color="secondary">
                      已选 {activeSelectedCount} / {activeSelectableKeys.length} 个可导入
                    </Text>
                    <AstryxNativeButton
                      label={
                        activeAllSelected ? t("settings.deselectAll") : t("settings.selectAll")
                      }
                      variant="ghost"
                      size="sm"
                      onClick={toggleAllActive}
                      isDisabled={!activeSelectableKeys.length || submitting}
                    />
                  </HStack>

                  <StackItem size="fill" isScrollable>
                    <AstryxList density="balanced" hasDividers>
                      {activeRows.map(({ item, key, exists, transferable, selectable }) => (
                        <CcsProviderRow
                          key={key}
                          item={item}
                          exists={exists}
                          transferable={transferable}
                          selectable={selectable}
                          isSelected={selected.has(key)}
                          submitting={submitting}
                          onChange={() => toggleRow(key)}
                        />
                      ))}
                    </AstryxList>
                  </StackItem>
                </VStack>
              </StackItem>
            </HStack>
          )}
        </StackItem>

        <HStack width="100%" padding={4} hAlign="between" vAlign="center" gap={3} wrap="wrap">
          <Text type="supporting" color="secondary">
            共已选 {selectedCount} / {selectableKeys.length} 个可导入
          </Text>
          <HStack gap={2} vAlign="center">
            <AstryxNativeButton
              label={result ? "关闭" : t("settings.cancel")}
              variant="secondary"
              onClick={onClose}
              isDisabled={submitting}
            />
            <AstryxNativeButton
              label={submitting ? "正在导入…" : `导入 ${selectedCount} 个供应商`}
              variant="primary"
              onClick={() => void handleImport()}
              isLoading={submitting}
              isDisabled={submitting || selectedCount === 0}
            />
          </HStack>
        </HStack>
      </VStack>
    </SettingsModalShell>
  );
}

function ProviderList(props: {
  type: ProviderId;
  isActive: boolean;
  providers: CustomProvider[];
  onAdd: () => void;
  onEdit: (provider: CustomProvider) => void;
  onDelete: (id: string) => void;
  onReorder: (type: ProviderId, nextIds: string[]) => void;
  ccsProviders: CcsProvidersResponse | null;
  ccsLoading: boolean;
  ccsMessage: string | null;
  cherryProviders: CherryProvidersResponse | null;
  cherryLoading: boolean;
  cherryImporting: boolean;
  cherryMessage: string | null;
  onEnsureThirdPartyScan: () => void;
  onRefreshThirdPartyProviders: () => void;
  onOpenCcsImport: () => void;
  onOpenCherryImport: () => void;
  thirdPartyImportEnabled: boolean;
  usage: ReturnType<typeof useProviderUsage>;
}) {
  const { t } = useLocale();
  const isCompact = useMediaQuery("(max-width: 768px), (pointer: coarse) and (hover: none)");
  const {
    type,
    isActive,
    providers,
    onAdd,
    onEdit,
    onDelete,
    onReorder,
    ccsProviders,
    ccsLoading,
    ccsMessage,
    cherryProviders,
    cherryLoading,
    cherryImporting,
    cherryMessage,
    onEnsureThirdPartyScan,
    onRefreshThirdPartyProviders,
    onOpenCcsImport,
    onOpenCherryImport,
    thirdPartyImportEnabled,
  } = props;
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const [draggingProviderId, setDraggingProviderId] = useState("");
  const [previewProviderOrder, setPreviewProviderOrder] = useState<string[] | null>(null);
  const draggingPointerRef = useRef<number | null>(null);
  const previousProviderTypeRef = useRef(type);
  const providerListRef = useRef<HTMLUListElement | HTMLOListElement | null>(null);
  const providerOrderRef = useRef<CustomProvider[]>([]);
  const baseOrderRef = useRef<CustomProvider[]>([]);
  const typeProviders = providers.filter((provider) => provider.type === type);
  baseOrderRef.current = typeProviders;
  const typeProvidersById = new Map(typeProviders.map((provider) => [provider.id, provider]));
  const filtered = previewProviderOrder
    ? previewProviderOrder
        .map((id) => typeProvidersById.get(id))
        .filter((provider): provider is CustomProvider => provider !== undefined)
    : typeProviders;
  providerOrderRef.current = filtered;
  const ccsAll = ccsProviders?.providers ?? [];
  const cherryAll = cherryProviders?.providers ?? [];
  const ccsBreakdown = PROVIDER_TABS.map((tab) => ({
    type: tab,
    count: ccsAll.filter((provider) => provider.providerType === tab).length,
  })).filter((entry) => entry.count > 0);

  // The menu popup is portaled, so it would outlive its trigger when the tab
  // pane is slid away and marked inert — close it as the pane deactivates.
  useEffect(() => {
    if (!isActive) setSyncMenuOpen(false);
    if (!isActive || previousProviderTypeRef.current !== type) {
      draggingPointerRef.current = null;
      setDraggingProviderId("");
      setPreviewProviderOrder(null);
    }
    previousProviderTypeRef.current = type;
  }, [isActive, type]);

  useEffect(() => {
    if (!draggingProviderId) return;
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== draggingPointerRef.current) return;
      const rows = Array.from(
        providerListRef.current?.querySelectorAll<HTMLElement>("[data-provider-reorder-id]") ?? [],
      );
      if (rows.length < 2) return;
      const current = providerOrderRef.current;
      const sourceIndex = current.findIndex((provider) => provider.id === draggingProviderId);
      if (sourceIndex < 0) return;
      let insertionIndex = rows.findIndex(
        (row) => event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2,
      );
      if (insertionIndex < 0) insertionIndex = rows.length;
      const next = current.filter((provider) => provider.id !== draggingProviderId);
      const adjustedInsertionIndex =
        insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex;
      const boundedIndex = Math.max(0, Math.min(next.length, adjustedInsertionIndex));
      next.splice(boundedIndex, 0, current[sourceIndex]);
      const nextIds = next.map((provider) => provider.id);
      if (nextIds.every((id, index) => id === current[index]?.id)) return;
      providerOrderRef.current = next;
      setPreviewProviderOrder(nextIds);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== draggingPointerRef.current) return;
      const nextIds = providerOrderRef.current.map((provider) => provider.id);
      const previousIds = baseOrderRef.current.map((provider) => provider.id);
      draggingPointerRef.current = null;
      setDraggingProviderId("");
      setPreviewProviderOrder(null);
      if (
        event.type !== "pointercancel" &&
        !nextIds.every((id, index) => id === previousIds[index])
      ) {
        onReorder(type, nextIds);
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [draggingProviderId, onReorder, type]);

  function reorderProviderByKeyboard(providerId: string, key: string) {
    const current = providerOrderRef.current;
    const sourceIndex = current.findIndex((provider) => provider.id === providerId);
    if (sourceIndex < 0) return false;
    const targetIndex =
      key === "ArrowUp"
        ? sourceIndex - 1
        : key === "ArrowDown"
          ? sourceIndex + 1
          : key === "Home"
            ? 0
            : key === "End"
              ? current.length - 1
              : sourceIndex;
    const boundedIndex = Math.max(0, Math.min(current.length - 1, targetIndex));
    if (boundedIndex === sourceIndex) return false;
    const next = [...current];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(boundedIndex, 0, moved);
    providerOrderRef.current = next;
    onReorder(
      type,
      next.map((provider) => provider.id),
    );
    return true;
  }

  function handleSyncMenuOpenChange(open: boolean) {
    setSyncMenuOpen(open);
    if (open) onEnsureThirdPartyScan();
  }

  const scanned = ccsProviders !== null;
  const ccsSubtitle = ccsLoading
    ? "正在扫描本地配置…"
    : ccsAll.length
      ? `发现 ${ccsBreakdown
          .map((entry) => `${getProviderLabel(entry.type)} ${entry.count}`)
          .join(" · ")}`
      : scanned
        ? ccsMessage || "未发现可导入的供应商"
        : "点击扫描本地配置";
  // The import modal shows every provider type, so the badge and fallback
  // subtitle must count across all of them — not just the current tab.
  const cherryReady = cherryAll.filter((provider) => provider.importable).length;
  const cherrySubtitle = cherryImporting
    ? "正在同步供应商、获取并激活模型…"
    : cherryLoading
      ? "正在扫描本地配置…"
      : cherryProviders
        ? cherryMessage || `发现 ${cherryReady} 个可同步配置`
        : cherryMessage || "点击扫描本地配置";
  const thirdPartyLoading = ccsLoading || cherryLoading;
  const thirdPartyImporting = cherryImporting;

  return (
    <VStack width="100%" gap={4}>
      <HStack width="100%" gap={3} vAlign="center" hAlign="between" wrap="wrap">
        <AstryxStack direction="vertical" className="text-sm text-muted-foreground">
          {filtered.length === 0
            ? t("settings.noProviders")
            : `${filtered.length} ${t("settings.navProviders")}`}
        </AstryxStack>
        <HStack
          className="settings-provider-list-actions"
          gap={2}
          vAlign="center"
          style={{ minWidth: 0, maxWidth: "100%" }}
        >
          <AstryxNativeButton
            label={t("settings.addProvider")}
            variant="primary"
            size="lg"
            isIconOnly={isCompact}
            icon={<Icon icon={Plus} size="sm" color="inherit" />}
            tooltip={t("settings.addProvider")}
            onClick={onAdd}
          />
          {thirdPartyImportEnabled ? (
            <DropdownMenu
              button={{
                label: t("settings.thirdPartySync"),
                variant: "secondary",
                size: "lg",
                isIconOnly: isCompact,
                icon: <Icon icon={RefreshCw} size="sm" color="inherit" />,
                isLoading: thirdPartyImporting,
                isDisabled: thirdPartyImporting,
              }}
              isMenuOpen={syncMenuOpen}
              onOpenChange={handleSyncMenuOpenChange}
              alignment="end"
              menuWidth="var(--xgent-provider-import-menu-width)"
              items={[
                {
                  id: "refresh",
                  label: t("settings.refreshLocalProviderConfigs"),
                  icon: <Icon icon={RefreshCw} size="sm" color="inherit" />,
                  isDisabled: thirdPartyLoading || thirdPartyImporting,
                  onClick: onRefreshThirdPartyProviders,
                },
                { type: "divider" },
                {
                  id: "cc-switch",
                  label: `CC Switch${ccsAll.length > 0 ? ` (${ccsAll.length})` : ""}`,
                  description: ccsSubtitle,
                  icon: <Icon icon={Waypoints} size="sm" color="inherit" />,
                  isDisabled: ccsLoading || thirdPartyImporting,
                  onClick: onOpenCcsImport,
                },
                {
                  id: "cherry-studio",
                  label: `Cherry Studio${cherryReady > 0 ? ` (${cherryReady})` : ""}`,
                  description: cherrySubtitle,
                  icon: <Icon icon={Download} size="sm" color="inherit" />,
                  isDisabled: cherryLoading || cherryImporting,
                  onClick: onOpenCherryImport,
                },
              ]}
            />
          ) : null}
        </HStack>
      </HStack>

      <VStack width="100%">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<ProviderBrandIcon type={type} />}
            title={t("settings.noProvidersHint")}
            description={t("settings.noProvidersAdd")}
            actions={
              <AstryxNativeButton
                label={t("settings.addProvider")}
                variant="primary"
                size="lg"
                onClick={onAdd}
              />
            }
          />
        ) : (
          <AstryxList
            className="settings-provider-list"
            ref={providerListRef}
            density="compact"
            hasDividers
          >
            {filtered.map((provider) => {
              const usageState = props.usage.getState(provider.id);
              const details = providerListDetails(provider, usageState.result, t);
              return (
                <ProviderSettingsRow
                  key={provider.id}
                  id={provider.id}
                  name={provider.name}
                  icon={<ProviderBrandIcon type={type} />}
                  isSelected={draggingProviderId === provider.id}
                  connection={details.connection}
                  usage={details.usage}
                  proxy={
                    provider.useSystemProxy ? (
                      <HStack as="span" gap={1} vAlign="center" wrap="wrap">
                        <Icon icon={Waypoints} size="sm" color="secondary" />
                        {t("settings.providerUseSystemProxy")}
                      </HStack>
                    ) : null
                  }
                  reorder={
                    <IconButton
                      label={`${t("settings.reorderProvider")}: ${provider.name}`}
                      variant="ghost"
                      size="lg"
                      isDisabled={filtered.length < 2}
                      style={{ touchAction: "none" }}
                      icon={<Icon icon={GripVertical} size="sm" color="inherit" />}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (
                          event.button === 0 &&
                          filtered.length > 1 &&
                          draggingPointerRef.current === null
                        ) {
                          event.currentTarget.setPointerCapture(event.pointerId);
                          draggingPointerRef.current = event.pointerId;
                          setPreviewProviderOrder(filtered.map((item) => item.id));
                          setDraggingProviderId(provider.id);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (reorderProviderByKeyboard(provider.id, event.key)) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                    />
                  }
                  actions={
                    <ConfirmDeletePopover
                      name={provider.name}
                      onConfirm={() => onDelete(provider.id)}
                    >
                      {(open) => (
                        <DropdownMenu
                          button={{
                            label: `${t("settings.providerMore")}: ${provider.name}`,
                            variant: "ghost",
                            size: "lg",
                            isIconOnly: true,
                            icon: <Icon icon={MoreHorizontal} size="sm" color="inherit" />,
                          }}
                          alignment="end"
                          items={[
                            ...(provider.usageQuery?.enabled
                              ? [
                                  {
                                    id: "refresh",
                                    label: t("settings.usage.refresh"),
                                    icon: <Icon icon={RefreshCw} size="sm" color="inherit" />,
                                    isDisabled: usageState.loading,
                                    onClick: () => {
                                      void props.usage.refresh(provider.id);
                                    },
                                  },
                                ]
                              : []),
                            {
                              id: "edit",
                              label: t("settings.edit"),
                              icon: <Icon icon={Pencil} size="sm" color="inherit" />,
                              onClick: () => onEdit(provider),
                            },
                            {
                              id: "delete",
                              label: t("settings.delete"),
                              icon: <Icon icon={Trash2} size="sm" color="inherit" />,
                              onClick: open,
                              variant: "destructive",
                            },
                          ]}
                        />
                      )}
                    </ConfirmDeletePopover>
                  }
                  onEdit={() => onEdit(provider)}
                />
              );
            })}
          </AstryxList>
        )}
      </VStack>
    </VStack>
  );
}

export function ProvidersSection(
  props: SettingsSectionProps & { thirdPartyImportEnabled?: boolean },
) {
  const { settings, setSettings } = props;
  const thirdPartyImportEnabled = props.thirdPartyImportEnabled !== false;
  const { t } = useLocale();
  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );

  const [activeTab, setActiveTab] = useState<ProviderId>("claude_code");
  const [view, setView] = useState<ProviderSettingsView>("list");
  const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);
  const [ccsImportType, setCcsImportType] = useState<ProviderId | null>(null);
  const [cherryImportType, setCherryImportType] = useState<ProviderId | null>(null);
  const [ccsProviders, setCcsProviders] = useState<CcsProvidersResponse | null>(null);
  const [ccsLoading, setCcsLoading] = useState(false);
  const [ccsMessage, setCcsMessage] = useState<string | null>(null);
  const [cherryProviders, setCherryProviders] = useState<CherryProvidersResponse | null>(null);
  const [cherryLoading, setCherryLoading] = useState(false);
  const [cherryImporting, setCherryImporting] = useState(false);
  const [cherryMessage, setCherryMessage] = useState<string | null>(null);
  const [cherryDataPath, setCherryDataPath] = useState<string | null>(readCherryDataPath);
  const usage = useProviderUsage(settings.customProviders);

  async function refreshThirdPartyProviders() {
    if (!thirdPartyImportEnabled) return;
    setCcsLoading(true);
    setCherryLoading(true);
    const [ccsResult, cherryResult] = await withScanFeedback(
      Promise.allSettled([
        invoke<CcsProvidersResponse>("settings_list_ccswitch_providers"),
        cherryDataPath
          ? invoke<CherryProvidersResponse>("settings_list_cherry_studio_providers_from_path", {
              dataPath: cherryDataPath,
            })
          : invoke<CherryProvidersResponse>("settings_list_cherry_studio_providers"),
      ]),
    );
    if (ccsResult.status === "fulfilled") {
      setCcsProviders(ccsResult.value);
      setCcsMessage(ccsResult.value.message);
    } else {
      setCcsProviders(null);
      setCcsMessage(
        ccsResult.reason instanceof Error ? ccsResult.reason.message : String(ccsResult.reason),
      );
    }
    if (cherryResult.status === "fulfilled") {
      setCherryProviders(cherryResult.value);
      setCherryMessage(cherryResult.value.message);
    } else {
      setCherryProviders(null);
      setCherryMessage(
        cherryResult.reason instanceof Error
          ? cherryResult.reason.message
          : String(cherryResult.reason),
      );
    }
    setCcsLoading(false);
    setCherryLoading(false);
  }

  async function chooseCherryDataDirectory() {
    if (!thirdPartyImportEnabled) return;
    try {
      const selected = await invoke<string | null>("system_pick_folder", {
        initial_workdir: cherryDataPath ?? cherryProviders?.dataPath ?? undefined,
      });
      if (!selected) return;

      setCherryLoading(true);
      setCherryMessage("正在扫描选择的 Cherry Studio 数据目录…");
      const response = await withScanFeedback(
        invoke<CherryProvidersResponse>("settings_list_cherry_studio_providers_from_path", {
          dataPath: selected,
        }),
      );
      const resolvedPath = response.dataPath || selected;
      localStorage.setItem(CHERRY_DATA_PATH_STORAGE_KEY, resolvedPath);
      setCherryDataPath(resolvedPath);
      setCherryProviders(response);
      setCherryMessage(response.message);
    } catch (error) {
      setCherryMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCherryLoading(false);
    }
  }

  function resetCherryDataDirectory() {
    if (!thirdPartyImportEnabled) return;
    localStorage.removeItem(CHERRY_DATA_PATH_STORAGE_KEY);
    setCherryDataPath(null);
    // Keep the stale provider list while rescanning: the import modal renders
    // only while cherryProviders is set, so nulling it here would unmount an
    // open modal mid-interaction.
    setCherryMessage("已恢复自动检测，正在重新扫描…");
    setCherryLoading(true);
    void withScanFeedback(invoke<CherryProvidersResponse>("settings_list_cherry_studio_providers"))
      .then((response) => {
        setCherryProviders(response);
        setCherryMessage(response.message);
      })
      .catch((error) => {
        setCherryMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setCherryLoading(false));
  }

  function ensureThirdPartyScan() {
    if (!thirdPartyImportEnabled) return;
    if ((!ccsProviders || !cherryProviders) && !ccsLoading && !cherryLoading) {
      void refreshThirdPartyProviders();
    }
  }

  async function syncCcsModelsInBackground(
    transferable: CcsProviderImportItem[],
    importedSummary: string,
  ) {
    const { fetchedCount, failedCount, totalModels } = await syncCcsImportModels(
      transferable,
      setSettings,
    );
    const details = [
      importedSummary,
      fetchedCount > 0 ? `已在后台获取并激活 ${totalModels} 个模型` : "",
      failedCount > 0 ? `${failedCount} 个供应商模型获取失败（导入的配置不受影响）` : "",
    ].filter(Boolean);
    setCcsMessage(details.join("，"));
  }

  async function importCcsProviders(items: CcsProviderImportItem[]): Promise<string> {
    const transferable = items.filter(ccsProviderIsTransferable);
    if (!transferable.length) {
      const message = "所选供应商没有可导入的 API 配置";
      setCcsMessage(message);
      return message;
    }

    setSettings((prev) => {
      const nextImported = buildCcsImportedProviders(prev.customProviders, transferable);
      if (!nextImported.length) return prev;
      return updateCustomProviders(prev, [...prev.customProviders, ...nextImported]);
    });

    const importedByType = PROVIDER_TABS.map((tab) => ({
      type: tab,
      count: transferable.filter((item) => item.providerType === tab).length,
    })).filter((entry) => entry.count > 0);
    const importedSummary = `已导入 ${importedByType
      .map((entry) => `${entry.count} 个 ${getProviderLabel(entry.type)}`)
      .join("、")} 供应商`;
    const summary = transferable.some(ccsProviderCanSyncModels)
      ? `${importedSummary}，正在后台获取模型列表…`
      : `${importedSummary}，已激活供应商内的全部模型`;
    setCcsMessage(summary);
    void syncCcsModelsInBackground(transferable, importedSummary);
    return summary;
  }

  async function syncCherryModelsInBackground(
    importable: CherryProviderImportItem[],
    existingById: Map<string, CustomProvider>,
    importedSummary: string,
  ) {
    const {
      fetchedCount,
      failedCount,
      totalModels: refreshedModelCount,
    } = await syncCherryImportModels(importable, existingById, setSettings);
    const details = [
      importedSummary,
      fetchedCount > 0 && refreshedModelCount > 0
        ? `已在后台获取并激活 ${refreshedModelCount} 个模型`
        : "API 未返回可用模型",
      failedCount > 0 ? `${failedCount} 个供应商模型获取失败（配置已成功导入）` : "",
    ].filter(Boolean);
    setCherryMessage(details.join("，"));
  }

  function importCherryProviders(items: CherryProviderImportItem[]) {
    const importable = items.filter((item) => item.importable);
    if (!importable.length) {
      const message = "所选 Cherry Studio 配置没有可导入的 API 配置";
      setCherryMessage(message);
      return;
    }

    setCherryImporting(true);
    setCherryMessage("正在导入供应商配置…");

    const allItems = cherryProviders?.providers ?? importable;
    const existingById = new Map(
      settings.customProviders.map((provider) => [provider.id, provider] as const),
    );

    setSettings((prev) => {
      let changed = false;
      const providers = [...prev.customProviders];

      for (const item of importable) {
        const id = cherryProviderId(item);
        const existingIndex = providers.findIndex((provider) => provider.id === id);
        const nextProvider = providerFromCherry(
          item,
          allItems,
          existingIndex >= 0 ? providers[existingIndex] : undefined,
        );

        if (existingIndex >= 0) providers[existingIndex] = nextProvider;
        else providers.push(nextProvider);
        changed = true;
      }

      return changed ? updateCustomProviders(prev, providers) : prev;
    });

    const importedByType = PROVIDER_TABS.map((type) => ({
      type,
      count: importable.filter((item) => item.providerType === type).length,
    })).filter((entry) => entry.count > 0);
    const importedSummary = `已导入 ${importedByType
      .map((entry) => `${entry.count} 个 ${getProviderLabel(entry.type)}`)
      .join("、")} 供应商`;

    // Saving the provider configuration is the completion boundary. Model
    // discovery is network-bound and must never keep the import screen locked.
    setCherryMessage(`${importedSummary}，正在后台获取模型列表…`);
    setCherryImportType(null);
    setCherryImporting(false);
    void syncCherryModelsInBackground(importable, existingById, importedSummary).catch((error) => {
      setCherryMessage(
        `${importedSummary}，后台获取模型失败：${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  function openAdd() {
    setEditingProvider(null);
    setView("editor");
  }

  function openEdit(provider: CustomProvider) {
    setEditingProvider(provider);
    setView("editor");
  }

  function closeEditor() {
    setView("list");
    setEditingProvider(null);
  }

  function handleSave(data: Omit<CustomProvider, "id">) {
    setSettings((prev) => {
      if (editingProvider) {
        const updated = prev.customProviders.map((provider) =>
          provider.id === editingProvider.id ? { ...provider, ...data } : provider,
        );
        return updateCustomProviders(prev, updated);
      }

      const newProvider: CustomProvider = {
        id: createUuid(),
        ...data,
      };
      return updateCustomProviders(prev, [...prev.customProviders, newProvider]);
    });
    closeEditor();
  }

  function handleDelete(id: string) {
    setSettings((prev) =>
      updateCustomProviders(
        prev,
        prev.customProviders.filter((provider) => provider.id !== id),
      ),
    );
  }

  function handleProviderReorder(type: ProviderId, nextIds: string[]) {
    setSettings((previous) => {
      const byId = new Map(
        previous.customProviders
          .filter((provider) => provider.type === type)
          .map((provider) => [provider.id, provider]),
      );
      const reordered = nextIds
        .map((id) => byId.get(id))
        .filter((provider): provider is CustomProvider => Boolean(provider));
      for (const provider of byId.values()) {
        if (!nextIds.includes(provider.id)) reordered.push(provider);
      }
      let index = 0;
      return updateCustomProviders(
        previous,
        previous.customProviders.map((provider) =>
          provider.type === type ? (reordered[index++] ?? provider) : provider,
        ),
      );
    });
  }

  if (view === "list" && thirdPartyImportEnabled && ccsImportType) {
    return (
      <CcsImportModal
        initialType={ccsImportType}
        items={ccsProviders?.providers ?? []}
        existingProviders={settings.customProviders}
        message={ccsMessage}
        onRefresh={() => void refreshThirdPartyProviders()}
        onImport={importCcsProviders}
        onClose={() => setCcsImportType(null)}
      />
    );
  }

  if (view === "list" && thirdPartyImportEnabled && cherryImportType) {
    return (
      <CherryStudioImportModal
        initialType={cherryImportType}
        response={
          cherryProviders ?? {
            status: "not-found",
            message: cherryMessage || "未检测到 Cherry Studio 配置",
            version: "",
            dataPath: cherryDataPath ?? "",
            totalProviderCount: 0,
            enabledProviderCount: 0,
            providers: [],
          }
        }
        importing={cherryImporting}
        scanning={cherryLoading}
        dataPath={cherryDataPath}
        isExisting={(item) =>
          settings.customProviders.some((provider) => provider.id === cherryProviderId(item))
        }
        onChooseDataDirectory={() => void chooseCherryDataDirectory()}
        onResetDataDirectory={resetCherryDataDirectory}
        onConfirm={(items) => void importCherryProviders(items)}
        onClose={() => setCherryImportType(null)}
      />
    );
  }

  return (
    <>
      {view === "editor" ? (
        <SettingsModalShell
          onClose={closeEditor}
          purpose="form"
          ariaLabel={editingProvider ? t("settings.editProvider") : t("settings.addProvider")}
        >
          <ProviderEditor
            key={editingProvider ? `existing:${editingProvider.id}` : `new:${activeTab}`}
            providerType={activeTab}
            initialData={editingProvider ?? undefined}
            onSave={handleSave}
            onClose={closeEditor}
          />
        </SettingsModalShell>
      ) : view === "advanced" ? (
        <SettingsModalShell
          onClose={() => setView("list")}
          ariaLabel={t("settings.openCustomSettings")}
        >
          <ProviderAdvancedSettingsPanel
            settings={settings}
            setSettings={setSettings}
            providerType={activeTab}
            onClose={() => setView("list")}
          />
        </SettingsModalShell>
      ) : (
        <VStack height="100%" minHeight={0} gap={0}>
          <Toolbar
            className="settings-provider-tabs-toolbar"
            label={t("settings.navProviders")}
            size={isCompact ? "lg" : "sm"}
            dividers={isCompact ? [] : ["bottom"]}
            startContent={
              <TabList
                value={activeTab}
                onChange={(value) => setActiveTab(value as ProviderId)}
                size={isCompact ? "lg" : "sm"}
                overflow="scroll"
                role="tablist"
              >
                {PROVIDER_TABS.map((tab) => (
                  <Tab
                    key={tab}
                    value={tab}
                    label={getProviderLabel(tab)}
                    icon={<ProviderBrandIcon type={tab} />}
                    panelId={`provider-panel-${tab}`}
                  />
                ))}
              </TabList>
            }
            endContent={
              <IconButton
                label={t("settings.openCustomSettings")}
                tooltip={t("settings.openCustomSettings")}
                variant="ghost"
                size={isCompact ? "lg" : "sm"}
                icon={<Icon icon={Settings} size="sm" color="inherit" />}
                onClick={() => setView("advanced")}
              />
            }
          />
          <StackItem size="fill" isScrollable>
            <VStack id={`provider-panel-${activeTab}`} role="tabpanel" padding={4}>
              <ProviderList
                type={activeTab}
                isActive
                providers={settings.customProviders}
                onAdd={openAdd}
                onEdit={openEdit}
                onDelete={handleDelete}
                onReorder={handleProviderReorder}
                ccsProviders={ccsProviders}
                ccsLoading={ccsLoading}
                ccsMessage={ccsMessage}
                cherryProviders={cherryProviders}
                cherryLoading={cherryLoading}
                cherryImporting={cherryImporting}
                cherryMessage={cherryMessage}
                onEnsureThirdPartyScan={ensureThirdPartyScan}
                onRefreshThirdPartyProviders={() => void refreshThirdPartyProviders()}
                onOpenCcsImport={() => setCcsImportType(activeTab)}
                onOpenCherryImport={() => setCherryImportType(activeTab)}
                thirdPartyImportEnabled={thirdPartyImportEnabled}
                usage={usage}
              />
            </VStack>
          </StackItem>
        </VStack>
      )}
    </>
  );
}
