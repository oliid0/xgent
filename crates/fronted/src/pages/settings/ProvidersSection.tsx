import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button as AstryxNativeButton } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List as AstryxList, ListItem } from "@astryxdesign/core/List";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Popover } from "@astryxdesign/core/Popover";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Stack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { invoke } from "@xagent/runtime";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import {
  Inline as AstryxInline,
  Paragraph as AstryxParagraph,
  View as AstryxView,
} from "@xagent/ui/components/ui/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ccswitchLogoUrl from "../../../src-tauri/icons/custom/ccswitch.png";
import cherryStudioLogoUrl from "../../../src-tauri/icons/custom/cherrystudio.png";
import {
  ArrowLeft,
  ClaudeIcon,
  Download,
  Eye,
  EyeOff,
  GeminiIcon,
  Globe,
  List,
  OpenaiChatgptIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Wallet,
  Waypoints,
  X,
  Zap,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { ConfirmActionPopover } from "../../components/ui/confirm-action-popover";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useLocale } from "../../i18n";
import { buildModelOptions } from "../../lib/chat/page/chatPageHelpers";
import {
  isLocalAccessSecretSentinel,
  LOCAL_ACCESS_SECRET_SENTINEL,
} from "../../lib/localAccessSecrets";
import {
  getCustomHeaderKeyPresets,
  isReservedCustomHeaderKey,
  isValidCustomHeaderKey,
} from "../../lib/providers/customHeaders";
import { parseModelValue, toModelValue } from "../../lib/providers/llm";
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
  normalizeModelFailoverSettings,
  normalizeRetryErrorSettings,
  normalizeUsageQueryConfig,
  PROVIDER_RETRY_DEFAULT_MAX_RETRIES,
  PROVIDER_RETRY_MAX_RETRIES_LIMITS,
  type ProviderAuthMode,
  type ProviderId,
  type ProviderModelConfig,
  type ProviderRetryPolicy,
  type UsageQueryConfig,
  type UsageQueryMode,
  updateCustomProviders,
  updateCustomSettings,
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

type ModelEditDraft = {
  model: ProviderModelConfig;
  contextWindow: string;
  maxOutputToken: string;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
};
type CcsProviderImportItem = {
  sourceId: string;
  appType: string;
  providerType: ProviderId;
  name: string;
  baseUrl: string;
  isFullUrl: boolean;
  modelsUrl?: string;
  apiKey: string;
  requestFormat: CodexRequestFormat;
  models?: string[];
};

type CcsProvidersResponse = {
  status: string;
  message: string;
  providers: CcsProviderImportItem[];
};

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
  if (type === "claude_code") return <ClaudeIcon height="1em" />;
  if (type === "gemini") return <GeminiIcon height="1em" />;
  if (type === "xai") return <Zap className="h-[1em] w-[1em]" />;
  if (type === "deepseek") return <Waypoints className="h-[1em] w-[1em]" />;
  return <OpenaiChatgptIcon height="1em" className="fill-current dark:text-white" />;
}

const REDACTED_API_KEY_DISPLAY = "API Key";
const CHERRY_DATA_PATH_STORAGE_KEY = "xagent.cherryStudioDataPath";

// A local rescan usually returns within a frame, which makes the refresh
// feedback flash for a single frame. Hold the loading state for one full
// spinner revolution so the rescan reads as motion instead of a flicker.
const THIRD_PARTY_SCAN_FEEDBACK_MS = 1000;

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

function parsePositiveInteger(input: string): number | null {
  const value = Number(input.trim());
  if (!Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

// 单价输入：留空视为未配置（0），负数与非数字视为非法。
function parseCostRate(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function formatCostRate(value: number | undefined): string {
  return typeof value === "number" && value > 0 ? String(value) : "";
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
  const [isFullUrl, setIsFullUrl] = useState(initialData?.isFullUrl ?? false);
  const [modelsUrl, setModelsUrl] = useState(initialData?.modelsUrl ?? "");
  const [apiKey, setApiKey] = useState(
    initialUsesRedactedApiKey ? REDACTED_API_KEY_DISPLAY : initialApiKey,
  );
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
  const [models, setModels] = useState<ProviderModelConfig[]>(() =>
    normalizeFetchedModels(initialData?.models ?? [], providerType),
  );
  const [activeModels, setActiveModels] = useState<Set<string>>(
    new Set(initialData?.activeModels ?? []),
  );
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
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [addingModel, setAddingModel] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [editingModel, setEditingModel] = useState<ModelEditDraft | null>(null);
  const [activePanel, setActivePanel] = useState<ProviderDialogPanel>("general");
  const [visibleHeaderValues, setVisibleHeaderValues] = useState<Set<number>>(new Set());
  const [headerValidationSubmitted, setHeaderValidationSubmitted] = useState(false);
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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFetchKey = useRef("");
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
  const canFetchModels = baseUrl.trim().length > 0 && modelFetchCredential.length > 0;

  const doFetch = useCallback(
    async (url: string, key: string) => {
      setFetchingModels(true);
      setFetchError(null);
      try {
        const list = await fetchModelsFromApi(providerType, url, key, {
          authMode: supportsOAuth ? authMode : "api-key",
          oauthAccountId: authMode === "oauth-managed" ? managedOAuthAccountId : undefined,
          customHeaders,
          useSystemProxy,
          isFullUrl,
          modelsUrl,
        });
        setModels((prev) => mergeFetchedModels(list, prev));
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        setFetchingModels(false);
      }
    },
    [
      authMode,
      customHeaders,
      isFullUrl,
      managedOAuthAccountId,
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
    const key = buildProviderModelsFetchKey(
      trimUrl,
      trimKey,
      useSystemProxy,
      supportsOAuth ? authMode : "api-key",
      customHeaders,
      authMode === "oauth-managed" ? managedOAuthAccountId : undefined,
      isFullUrl,
      modelsUrl,
    );
    if (!trimUrl || !trimCredential) return;
    if (key === prevFetchKey.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      prevFetchKey.current = key;
      void doFetch(trimUrl, trimKey);
    }, 900);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    apiKeyForRequest,
    authMode,
    baseUrl,
    customHeaders,
    doFetch,
    managedOAuthAccountId,
    isFullUrl,
    modelFetchCredential,
    modelsUrl,
    supportsOAuth,
    useSystemProxy,
  ]);

  function handleRefresh() {
    const trimUrl = baseUrl.trim();
    const trimKey = apiKeyForRequest;
    if (!trimUrl || !modelFetchCredential) {
      setFetchError(t("settings.noBaseUrlApiKey"));
      return;
    }
    prevFetchKey.current = "";
    void doFetch(trimUrl, trimKey);
  }

  function patchUsageQuery(patch: Partial<UsageQueryConfig>) {
    setUsageQuery((previous) => normalizeUsageQueryConfig({ ...previous, ...patch }));
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
    if (!initialData?.id) return;
    setUsageTest({ loading: true, result: null, error: null });
    try {
      const result = await testProviderUsage(initialData.id, usageQuery);
      setUsageTest({ loading: false, result, error: result?.error ?? null });
    } catch (error) {
      setUsageTest({
        loading: false,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      });
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
    const target = models.find((item) => item.id === modelId);
    if (!target) return;
    setEditingModel((prev) =>
      prev?.model.id === target.id
        ? null
        : {
            model: target,
            contextWindow: String(target.contextWindow),
            maxOutputToken: String(target.maxOutputToken),
            costInput: formatCostRate(target.cost?.input),
            costOutput: formatCostRate(target.cost?.output),
            costCacheRead: formatCostRate(target.cost?.cacheRead),
            costCacheWrite: formatCostRate(target.cost?.cacheWrite),
          },
    );
  }

  const editingModelContextWindow = editingModel
    ? parsePositiveInteger(editingModel.contextWindow)
    : null;
  const editingModelMaxOutputToken = editingModel
    ? parsePositiveInteger(editingModel.maxOutputToken)
    : null;
  const editingModelCost = editingModel
    ? {
        input: parseCostRate(editingModel.costInput),
        output: parseCostRate(editingModel.costOutput),
        cacheRead: parseCostRate(editingModel.costCacheRead),
        cacheWrite: parseCostRate(editingModel.costCacheWrite),
      }
    : null;
  const editingModelCostValid =
    editingModelCost === null ||
    (editingModelCost.input !== null &&
      editingModelCost.output !== null &&
      editingModelCost.cacheRead !== null &&
      editingModelCost.cacheWrite !== null);
  const canSaveEditingModel =
    editingModelContextWindow !== null &&
    editingModelMaxOutputToken !== null &&
    editingModelCostValid;

  function saveInlineModelSettings() {
    if (
      !editingModel ||
      editingModelContextWindow === null ||
      editingModelMaxOutputToken === null ||
      !editingModelCostValid
    ) {
      return;
    }
    const cost = editingModelCost
      ? {
          input: editingModelCost.input ?? 0,
          output: editingModelCost.output ?? 0,
          cacheRead: editingModelCost.cacheRead ?? 0,
          cacheWrite: editingModelCost.cacheWrite ?? 0,
        }
      : undefined;
    const hasCost =
      cost !== undefined &&
      (cost.input > 0 || cost.output > 0 || cost.cacheRead > 0 || cost.cacheWrite > 0);
    const nextModel: ProviderModelConfig = {
      ...editingModel.model,
      contextWindow: editingModelContextWindow,
      maxOutputToken: editingModelMaxOutputToken,
      cost: hasCost ? cost : undefined,
    };
    setModels((prev) => prev.map((item) => (item.id === nextModel.id ? nextModel : item)));
    setEditingModel(null);
  }
  function updateCustomHeader(index: number, field: "key" | "value", value: string) {
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
    const nextIndex = customHeaders.length;
    setCustomHeaders((prev) => [...prev, { key, value: "" }]);
    setHeaderValidationSubmitted(false);
    focusCustomHeader(nextIndex, focusField);
  }

  function removeCustomHeader(index: number) {
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
    setSaveAttempted(true);
    if (!name.trim()) {
      setActivePanel("general");
      return;
    }
    if (authMode === "oauth-managed" && !managedOAuthAccountId.trim()) {
      setActivePanel("general");
      return;
    }
    const invalidHeaderIndex = customHeaders.findIndex(
      (header) => getCustomHeaderKeyIssue(header.key, true) !== null,
    );
    if (invalidHeaderIndex >= 0) {
      setHeaderValidationSubmitted(true);
      setActivePanel("request");
      focusCustomHeader(invalidHeaderIndex, "key");
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
      models,
      activeModels: Array.from(activeModels),
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
      nativeWebSearchEnabled: initialData?.nativeWebSearchEnabled ?? true,
      useSystemProxy,
      retryPolicy: serializeRetryPolicy(),
      usageQuery,
    });
  }

  const isEditing = Boolean(initialData);
  const typeLabel = getProviderLabel(providerType);
  const orderedModels = useMemo(
    () => sortModelsBySelection(models, activeModels),
    [models, activeModels],
  );
  const modelSearchQuery = modelSearch.trim().toLowerCase();
  const visibleModels = useMemo(
    () =>
      modelSearchQuery
        ? orderedModels.filter((model) => model.id.toLowerCase().includes(modelSearchQuery))
        : orderedModels,
    [orderedModels, modelSearchQuery],
  );
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
      .map((header) => getCustomHeaderKeyIssue(header.key, headerValidationSubmitted))
      .find((issue) => issue !== null) ?? null;
  const headerIssueMessage =
    firstHeaderIssue === "reserved"
      ? t("settings.customHeaderReservedTitle")
      : firstHeaderIssue === "invalid"
        ? t("settings.invalidCustomHeaderKey")
        : null;
  return (
    <VStack height="100%" minHeight={0} gap={0}>
      <Toolbar
        label={isEditing ? t("settings.editProvider") : t("settings.addProvider")}
        size="md"
        dividers={["bottom"]}
        startContent={
          <HStack gap={2} vAlign="center">
            <IconButton
              label={t("settings.providerDialogNavigation")}
              tooltip={t("settings.providerDialogNavigation")}
              variant="ghost"
              icon={<ArrowLeft />}
              onClick={onClose}
            />
            <ProviderBrandIcon type={providerType} />
            <VStack gap={0.5}>
              <Heading level={3}>
                {isEditing ? t("settings.editProvider") : t("settings.addProvider")}
              </Heading>
              <Text type="supporting" color="secondary">
                {typeLabel} {t("settings.compatible")}
              </Text>
            </VStack>
          </HStack>
        }
      />

      <StackItem size="fill">
        <Stack
          direction={isCompact ? "vertical" : "horizontal"}
          height="100%"
          minHeight={0}
          gap={0}
        >
          {isCompact ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="shrink-0 border-b bg-muted/30 px-3 pt-2"
            >
              <TabList
                value={activePanel}
                onChange={(value) => setActivePanel(value as ProviderDialogPanel)}
                role="tablist"
                layout="fill"
                size="sm"
              >
                <Tab
                  value="general"
                  label={t("settings.providerDialogGeneral")}
                  panelId="provider-settings-panel"
                  icon={<Settings className="h-4 w-4" />}
                />
                <Tab
                  value="request"
                  label={t("settings.providerDialogRequest")}
                  panelId="provider-settings-panel"
                  icon={<Globe className="h-4 w-4" />}
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
                  icon={<Wallet className="h-4 w-4" />}
                />
              </TabList>
            </AstryxView>
          ) : (
            <AstryxView
              as="nav"
              layout="block"
              direction="horizontal"
              className="w-[172px] shrink-0 border-r bg-muted/30 p-2.5"
              aria-label={t("settings.providerDialogNavigation")}
            >
              <AstryxList density="compact">
                <ListItem
                  label={t("settings.providerDialogGeneral")}
                  startContent={<Settings className="h-4 w-4" />}
                  isSelected={activePanel === "general"}
                  onClick={() => setActivePanel("general")}
                />
                <ListItem
                  label={t("settings.providerDialogRequest")}
                  startContent={<Globe className="h-4 w-4" />}
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
                  startContent={<Wallet className="h-4 w-4" />}
                  isSelected={activePanel === "usage"}
                  onClick={() => setActivePanel("usage")}
                />
              </AstryxList>
            </AstryxView>
          )}

          <AstryxView
            id="provider-settings-panel"
            role="tabpanel"
            layout="block"
            direction="horizontal"
            className="min-w-0 flex-1 overflow-y-auto px-6 py-5 max-[720px]:px-3.5 max-[720px]:pb-[calc(0.875rem+env(safe-area-inset-bottom))] max-[720px]:pt-3.5"
            onScroll={() => setHeaderSuggest(null)}
          >
            {activePanel === "general" ? (
              <AstryxView as="section" key="general" className="provider-panel-enter">
                <AstryxView layout="block" direction="horizontal" className="text-sm font-semibold">
                  {t("settings.basicInformation")}
                </AstryxView>

                <VStack gap={1.5}>
                  <TextInput
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
                  <AstryxView layout="block" direction="horizontal" className="mt-4 space-y-2">
                    <Label>{t("settings.providerAuthMethod")}</Label>
                    <AstryxView
                      layout="grid"
                      direction="horizontal"
                      className={cn(
                        "grid rounded-xl bg-muted/65 p-1",
                        providerType === "codex" ? "grid-cols-3" : "grid-cols-2",
                      )}
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
                          onPressedChange={() => setAuthMode(mode)}
                          size="sm"
                        >
                          {mode === "api-key"
                            ? t("settings.providerAuthApiKey")
                            : mode === "oauth-managed"
                              ? t("settings.providerAuthOAuth")
                              : t("settings.providerAuthToken")}
                        </ToggleButton>
                      ))}
                    </AstryxView>
                    {authMode === "oauth-managed" ? (
                      <AstryxParagraph className="text-xs leading-5 text-muted-foreground">
                        {t("settings.providerOAuthManagedHintCodex")}
                      </AstryxParagraph>
                    ) : authMode === "oauth-token" ? (
                      <AstryxParagraph className="text-xs leading-5 text-muted-foreground">
                        {providerType === "claude_code"
                          ? t("settings.providerOAuthHintAnthropic")
                          : t("settings.providerOAuthHintCodex")}
                      </AstryxParagraph>
                    ) : null}
                  </AstryxView>
                ) : null}

                <AstryxView
                  layout="grid"
                  direction="horizontal"
                  className={cn(
                    "mt-4 grid gap-3 max-[720px]:grid-cols-1",
                    authMode === "oauth-managed" ? "grid-cols-1" : "grid-cols-2",
                  )}
                >
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label htmlFor="modal-baseurl">Base URL</Label>
                    <Input
                      id="modal-baseurl"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.currentTarget.value)}
                    />
                  </AstryxView>

                  {authMode !== "oauth-managed" ? (
                    <TextInput
                      type="password"
                      label={
                        authMode === "oauth-token" ? t("settings.providerOAuthToken") : "API Key"
                      }
                      value={apiKey}
                      width="100%"
                      isDisabled={isBrowser}
                      onChange={setApiKey}
                      onFocus={(event) => {
                        if (apiKeyIsRedactedDisplay && event.target instanceof HTMLInputElement) {
                          event.target.select();
                        }
                      }}
                    />
                  ) : null}
                </AstryxView>

                <AstryxView
                  layout="grid"
                  direction="horizontal"
                  className="mt-3 grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex items-center justify-between gap-3"
                  >
                    <AstryxView layout="block" direction="horizontal">
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="text-sm font-medium"
                      >
                        {t("settings.providerFullUrl")}
                      </AstryxView>
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="text-xs text-muted-foreground"
                      >
                        {t("settings.providerFullUrlDesc")}
                      </AstryxView>
                    </AstryxView>
                    <DialogSwitch
                      checked={isFullUrl}
                      onCheckedChange={setIsFullUrl}
                      ariaLabel={t("settings.providerFullUrl")}
                    />
                  </AstryxView>
                  {providerType !== "gemini" ? (
                    <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                      <Label htmlFor="modal-models-url">{t("settings.providerModelsUrl")}</Label>
                      <Input
                        id="modal-models-url"
                        value={modelsUrl}
                        onChange={(event) => setModelsUrl(event.currentTarget.value)}
                        placeholder="https://example.com/v1/models"
                      />
                    </AstryxView>
                  ) : null}
                </AstryxView>

                {providerType === "codex" && authMode === "oauth-managed" ? (
                  <AstryxView layout="block" direction="horizontal" className="mt-4 space-y-1.5">
                    <Label>{t("settings.providerOAuthAccounts")}</Label>
                    <CodexOAuthAccounts
                      value={managedOAuthAccountId}
                      onChange={setManagedOAuthAccountId}
                      browserRuntime={isBrowser}
                    />
                  </AstryxView>
                ) : null}

                {providerType === "codex" && authMode === "oauth-token" ? (
                  <AstryxView layout="block" direction="horizontal" className="mt-4 space-y-1.5">
                    <Label htmlFor="modal-oauth-account-id">
                      {t("settings.providerOAuthAccountId")}
                    </Label>
                    <Input
                      id="modal-oauth-account-id"
                      value={manualOAuthAccountId}
                      disabled={isBrowser}
                      onChange={(event) => setManualOAuthAccountId(event.currentTarget.value)}
                      placeholder={t("settings.providerOAuthAccountIdPlaceholder")}
                    />
                    <AstryxParagraph className="text-xs leading-5 text-muted-foreground">
                      {t("settings.providerOAuthAccountIdHint")}
                    </AstryxParagraph>
                  </AstryxView>
                ) : null}

                {providerType === "codex" ? (
                  <AstryxView layout="block" direction="horizontal" className="mt-4 space-y-1.5">
                    <Label>{t("settings.requestFormat")}</Label>
                    <Selector
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
                  </AstryxView>
                ) : null}

                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mt-6 text-sm font-semibold"
                >
                  {t("settings.models")}
                </AstryxView>
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mt-3 overflow-hidden rounded-xl border"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex items-center gap-2 border-b bg-muted/30 p-2.5 max-[720px]:flex-wrap"
                  >
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="relative min-w-0 flex-1 max-[720px]:basis-full"
                    >
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={modelSearch}
                        className="h-9 pl-9 pr-9 text-sm"
                        placeholder={t("settings.searchModels")}
                        aria-label={t("settings.searchModels")}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => setModelSearch(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setModelSearch("");
                        }}
                      />
                      {modelSearch ? (
                        <AstryxButton
                          type="button"
                          className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          onClick={() => setModelSearch("")}
                          title={t("settings.clearModelSearch")}
                          aria-label={t("settings.clearModelSearch")}
                        >
                          <X className="h-3.5 w-3.5" />
                        </AstryxButton>
                      ) : null}
                    </AstryxView>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 max-[720px]:h-10 max-[720px]:flex-1"
                      onClick={handleRefresh}
                      disabled={fetchingModels || (isBrowser && !canFetchModels)}
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", fetchingModels && "animate-spin")} />
                      {fetchingModels ? t("settings.fetching") : t("settings.refreshModels")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 max-[720px]:h-10 max-[720px]:flex-1"
                      onClick={() => setAddingModel(true)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t("settings.manualAddModel")}
                    </Button>
                  </AstryxView>

                  {fetchError ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                      {fetchError}
                    </AstryxView>
                  ) : null}

                  {addingModel ? (
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex gap-2 border-b bg-muted/20 p-2.5 max-[720px]:flex-wrap"
                    >
                      <Input
                        autoFocus
                        value={newModelName}
                        className="h-9 text-sm max-[720px]:h-10 max-[720px]:basis-full"
                        placeholder={t("settings.modelName")}
                        onChange={(event) => setNewModelName(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleAddModel();
                          if (event.key === "Escape") setAddingModel(false);
                        }}
                      />
                      <Button size="sm" className="h-9" onClick={handleAddModel}>
                        {t("settings.add")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9"
                        onClick={() => setAddingModel(false)}
                      >
                        {t("settings.cancel")}
                      </Button>
                    </AstryxView>
                  ) : null}

                  <AstryxView layout="block" direction="horizontal" className="divide-y">
                    {visibleModels.length === 0 ? (
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="px-3 py-8 text-center text-xs text-muted-foreground"
                      >
                        {models.length > 0 && modelSearchQuery
                          ? t("settings.noMatchingModels")
                          : baseUrl.trim() && modelFetchCredential
                            ? t("settings.fetchFailed")
                            : t("settings.fetchHint")}
                      </AstryxView>
                    ) : (
                      visibleModels.map((model) => {
                        const isEditingModel = editingModel?.model.id === model.id;
                        return (
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            key={model.id}
                            className="group hover:bg-accent/30"
                          >
                            <AstryxView
                              layout="flex"
                              direction="horizontal"
                              className="flex items-center gap-2 px-3 py-2 max-[720px]:flex-wrap"
                            >
                              <DialogSwitch
                                checked={activeModels.has(model.id)}
                                onCheckedChange={() => toggleModel(model.id)}
                                ariaLabel={model.id}
                              />
                              <AstryxView
                                layout="block"
                                direction="horizontal"
                                className="min-w-0 flex-1 max-[720px]:basis-[calc(100%-3rem)]"
                              >
                                <AstryxView
                                  layout="flex"
                                  direction="horizontal"
                                  className="flex min-w-0 items-center gap-2"
                                >
                                  <AstryxInline className="truncate text-sm font-medium">
                                    {model.id}
                                  </AstryxInline>
                                </AstryxView>
                              </AstryxView>
                              <AstryxView
                                layout="block"
                                direction="horizontal"
                                className="shrink-0 text-[11px] tabular-nums text-muted-foreground max-[720px]:order-3 max-[720px]:ml-12 max-[720px]:basis-full"
                              >
                                {formatTokenCount(model.contextWindow)} ctx ·{" "}
                                {formatTokenCount(model.maxOutputToken)} out
                              </AstryxView>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  "h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground",
                                  isEditingModel && "bg-primary/10 text-primary",
                                )}
                                onClick={() => openModelSettings(model.id)}
                                title={t("settings.modelSettings")}
                                aria-label={t("settings.modelSettings")}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => removeModel(model.id)}
                                title={t("settings.delete")}
                                aria-label={t("settings.delete")}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AstryxView>

                            {isEditingModel && editingModel ? (
                              <AstryxView
                                layout="block"
                                direction="horizontal"
                                className="mx-3 mb-3 rounded-lg border bg-muted/20 p-3"
                              >
                                <AstryxView
                                  layout="grid"
                                  direction="horizontal"
                                  className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1"
                                >
                                  <AstryxView
                                    layout="block"
                                    direction="horizontal"
                                    className="space-y-1.5"
                                  >
                                    <Label>{t("settings.contextWindow")}</Label>
                                    <Input
                                      inputMode="numeric"
                                      aria-invalid={
                                        editingModelContextWindow === null ? true : undefined
                                      }
                                      className={cn(
                                        editingModelContextWindow === null &&
                                          "ring-1 ring-inset ring-destructive focus-visible:ring-destructive",
                                      )}
                                      value={editingModel.contextWindow}
                                      onChange={(event) => {
                                        const value = event.currentTarget.value;
                                        setEditingModel((prev) =>
                                          prev ? { ...prev, contextWindow: value } : prev,
                                        );
                                      }}
                                    />
                                  </AstryxView>
                                  <AstryxView
                                    layout="block"
                                    direction="horizontal"
                                    className="space-y-1.5"
                                  >
                                    <Label>{t("settings.maxOutputToken")}</Label>
                                    <Input
                                      inputMode="numeric"
                                      aria-invalid={
                                        editingModelMaxOutputToken === null ? true : undefined
                                      }
                                      className={cn(
                                        editingModelMaxOutputToken === null &&
                                          "ring-1 ring-inset ring-destructive focus-visible:ring-destructive",
                                      )}
                                      value={editingModel.maxOutputToken}
                                      onChange={(event) => {
                                        const value = event.currentTarget.value;
                                        setEditingModel((prev) =>
                                          prev ? { ...prev, maxOutputToken: value } : prev,
                                        );
                                      }}
                                    />
                                  </AstryxView>
                                </AstryxView>

                                <AstryxView
                                  layout="block"
                                  direction="horizontal"
                                  className="mt-3 text-xs font-medium text-muted-foreground"
                                >
                                  {t("settings.modelCost")}
                                </AstryxView>
                                <AstryxView
                                  layout="block"
                                  direction="horizontal"
                                  className="mt-1 text-[11px] text-muted-foreground/80"
                                >
                                  {t("settings.modelCostHint")}
                                </AstryxView>
                                <AstryxView
                                  layout="grid"
                                  direction="horizontal"
                                  className="mt-2 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1"
                                >
                                  {(
                                    [
                                      ["costInput", "settings.modelCostInput"],
                                      ["costOutput", "settings.modelCostOutput"],
                                      ["costCacheRead", "settings.modelCostCacheRead"],
                                      ["costCacheWrite", "settings.modelCostCacheWrite"],
                                    ] as const
                                  ).map(([field, labelKey]) => (
                                    <AstryxView
                                      layout="block"
                                      direction="horizontal"
                                      key={field}
                                      className="space-y-1.5"
                                    >
                                      <Label>{t(labelKey)}</Label>
                                      <Input
                                        inputMode="decimal"
                                        placeholder="0"
                                        aria-invalid={
                                          parseCostRate(editingModel[field]) === null
                                            ? true
                                            : undefined
                                        }
                                        className={cn(
                                          parseCostRate(editingModel[field]) === null &&
                                            "ring-1 ring-inset ring-destructive focus-visible:ring-destructive",
                                        )}
                                        value={editingModel[field]}
                                        onChange={(event) => {
                                          const value = event.currentTarget.value;
                                          setEditingModel((prev) =>
                                            prev ? { ...prev, [field]: value } : prev,
                                          );
                                        }}
                                      />
                                    </AstryxView>
                                  ))}
                                </AstryxView>

                                {!canSaveEditingModel ? (
                                  <AstryxView
                                    layout="block"
                                    direction="horizontal"
                                    className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                                  >
                                    {t("settings.positiveIntegerRequired")}
                                  </AstryxView>
                                ) : null}

                                <AstryxView
                                  layout="flex"
                                  direction="horizontal"
                                  className="mt-3 flex justify-end gap-2"
                                >
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditingModel(null)}
                                  >
                                    {t("settings.cancel")}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={!canSaveEditingModel}
                                    onClick={saveInlineModelSettings}
                                  >
                                    {t("settings.save")}
                                  </Button>
                                </AstryxView>
                              </AstryxView>
                            ) : null}
                          </AstryxView>
                        );
                      })
                    )}
                  </AstryxView>
                </AstryxView>
              </AstryxView>
            ) : activePanel === "request" ? (
              <AstryxView as="section" key="request" className="provider-panel-enter">
                <AstryxView layout="block" direction="horizontal" className="text-sm font-semibold">
                  {t("settings.providerDialogRequest")}
                </AstryxView>

                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className={cn(
                    "mt-3 flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors",
                    useSystemProxy && "border-primary/35 bg-primary/[0.04]",
                  )}
                >
                  <AstryxView
                    as="span"
                    layout="flex"
                    direction="horizontal"
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                      useSystemProxy && "bg-primary/15 text-primary",
                    )}
                  >
                    <Waypoints className="h-4 w-4" />
                  </AstryxView>
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="min-w-0 flex-1 text-sm font-medium"
                  >
                    {t("settings.providerUseSystemProxy")}
                  </AstryxView>
                  <DialogSwitch
                    checked={useSystemProxy}
                    onCheckedChange={setUseSystemProxy}
                    ariaLabel={t("settings.providerUseSystemProxy")}
                  />
                </AstryxView>

                <Section padding={4} width="100%" dividers={["top", "bottom"]}>
                  <VStack gap={3}>
                    <VStack gap={0.5}>
                      <Heading level={4}>{t("settings.providerStreamRetry")}</Heading>
                      <Text type="supporting" color="secondary">
                        {t("settings.providerStreamRetryDesc")}
                      </Text>
                    </VStack>
                    <Selector
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
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className={cn(
                      "mt-3 rounded-xl border bg-card px-4 py-3 transition-colors",
                      promptCachingEnabled && "border-primary/35 bg-primary/[0.04]",
                    )}
                  >
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex items-center gap-3"
                    >
                      <AstryxView
                        as="span"
                        layout="flex"
                        direction="horizontal"
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
                          promptCachingEnabled && "bg-primary/15 text-primary",
                        )}
                      >
                        <Zap className="h-4 w-4" />
                      </AstryxView>
                      <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="text-sm font-medium"
                        >
                          {t("settings.promptCaching")}
                        </AstryxView>
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="text-xs text-muted-foreground"
                        >
                          {providerType === "claude_code"
                            ? t("settings.promptCachingDescClaude")
                            : t("settings.promptCachingDescCodex")}
                        </AstryxView>
                      </AstryxView>
                      <DialogSwitch
                        checked={promptCachingEnabled}
                        onCheckedChange={setPromptCachingEnabled}
                        ariaLabel={t("settings.promptCaching")}
                      />
                    </AstryxView>
                    {providerType === "claude_code" && promptCachingEnabled ? (
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"
                      >
                        <AstryxInline className="text-xs text-muted-foreground">
                          {t("settings.promptCacheRetention")}
                        </AstryxInline>
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
                            size="sm"
                          >
                            {t(labelKey)}
                          </ToggleButton>
                        ))}
                      </AstryxView>
                    ) : null}
                  </AstryxView>
                ) : null}

                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="mt-6 flex items-center justify-between gap-3"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex min-w-0 items-center gap-2"
                  >
                    <AstryxInline className="text-sm font-semibold">
                      {t("settings.customHeaders")}
                    </AstryxInline>
                    {customHeaders.length > 0 ? (
                      <AstryxInline className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                        {customHeaders.length}
                      </AstryxInline>
                    ) : null}
                  </AstryxView>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 max-[720px]:h-10"
                    onClick={() => addCustomHeader()}
                    disabled={isBrowser}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("settings.addCustomHeader")}
                  </Button>
                </AstryxView>

                {customHeaders.length === 0 ? (
                  <EmptyState
                    isCompact
                    icon={<List className="h-5 w-5" />}
                    title={t("settings.noCustomHeaders")}
                    description={t("settings.noCustomHeadersHint")}
                    actions={
                      <AstryxNativeButton
                        label={t("settings.addCustomHeader")}
                        variant="secondary"
                        size="sm"
                        isDisabled={isBrowser}
                        onClick={() => addCustomHeader()}
                      />
                    }
                  />
                ) : (
                  <AstryxView layout="block" direction="horizontal" className="mt-3 space-y-2">
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="-m-0.5 max-h-[196px] space-y-2 overflow-y-auto p-0.5 max-[720px]:max-h-[360px]"
                      onScroll={() => setHeaderSuggest(null)}
                    >
                      {customHeaders.map((header, index) => {
                        const issue = getCustomHeaderKeyIssue(
                          header.key,
                          headerValidationSubmitted,
                        );
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
                          <AstryxView
                            layout="flex"
                            direction="horizontal"
                            key={index}
                            className={cn(
                              "provider-panel-enter group relative flex items-stretch overflow-hidden rounded-lg border bg-card transition-all focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/10 hover:border-muted-foreground/30 max-[720px]:flex-wrap",
                              issue &&
                                "border-destructive/60 focus-within:border-destructive focus-within:ring-destructive/10",
                            )}
                          >
                            <Input
                              ref={(element) => {
                                headerKeyRefs.current[index] = element;
                              }}
                              value={header.key}
                              disabled={isBrowser}
                              className={cn(
                                "h-10 w-[210px] shrink-0 rounded-none border-0 border-r bg-muted/30 px-3 font-mono text-xs shadow-none focus-visible:ring-0 max-[720px]:w-full max-[720px]:border-b max-[720px]:border-r-0 max-[720px]:bg-muted/40",
                                issue && "text-destructive",
                              )}
                              placeholder={t("settings.customHeaderKeyPlaceholder")}
                              aria-label={t("settings.customHeaderName")}
                              aria-invalid={issue ? true : undefined}
                              role="combobox"
                              aria-expanded={suggestOpen}
                              aria-controls={suggestOpen ? "provider-header-suggest" : undefined}
                              aria-autocomplete="list"
                              title={issueTitle}
                              autoComplete="off"
                              spellCheck={false}
                              onChange={(event) => {
                                updateCustomHeader(index, "key", event.currentTarget.value);
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
                            <AstryxView
                              layout="block"
                              direction="horizontal"
                              className="relative min-w-0 flex-1 max-[720px]:basis-full"
                            >
                              <Input
                                ref={(element) => {
                                  headerValueRefs.current[index] = element;
                                }}
                                type={valueVisible ? "text" : "password"}
                                value={header.value}
                                disabled={isBrowser}
                                className="h-10 w-full rounded-none border-0 bg-transparent pl-3 pr-[4.5rem] font-mono text-xs shadow-none focus-visible:ring-0"
                                placeholder={t("settings.customHeaderValue")}
                                aria-label={t("settings.customHeaderValue")}
                                autoComplete="off"
                                spellCheck={false}
                                onChange={(event) =>
                                  updateCustomHeader(index, "value", event.currentTarget.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  if (index === customHeaders.length - 1) addCustomHeader();
                                  else focusCustomHeader(index + 1, "key");
                                }}
                              />
                              <AstryxView
                                layout="flex"
                                direction="horizontal"
                                className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-[720px]:opacity-100"
                              >
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
                                  onClick={() => toggleCustomHeaderValue(index)}
                                  disabled={isBrowser}
                                  title={
                                    valueVisible
                                      ? t("settings.hideCustomHeaderValue")
                                      : t("settings.showCustomHeaderValue")
                                  }
                                  aria-label={
                                    valueVisible
                                      ? t("settings.hideCustomHeaderValue")
                                      : t("settings.showCustomHeaderValue")
                                  }
                                >
                                  {valueVisible ? (
                                    <EyeOff className="h-3.5 w-3.5" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => removeCustomHeader(index)}
                                  disabled={isBrowser}
                                  title={t("settings.removeCustomHeader")}
                                  aria-label={t("settings.removeCustomHeader")}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AstryxView>
                            </AstryxView>
                          </AstryxView>
                        );
                      })}
                    </AstryxView>
                  </AstryxView>
                )}

                {headerIssueMessage ? (
                  <AstryxParagraph
                    className="mt-2 text-xs leading-relaxed text-destructive"
                    role="alert"
                  >
                    {headerIssueMessage}
                  </AstryxParagraph>
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
                    width="var(--xagent-provider-header-menu-width)"
                    label={t("settings.customHeaderKeyPlaceholder")}
                    role="none"
                    hasAutoFocus={false}
                    hasCloseButton={false}
                    content={
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        id="provider-header-suggest"
                        role="listbox"
                      >
                        {headerSuggestItems.map((preset, itemIndex) => (
                          <AstryxButton
                            key={preset}
                            type="button"
                            role="option"
                            aria-selected={itemIndex === headerSuggestActiveIndex}
                            className={cn(
                              "flex w-full items-center rounded-md px-2.5 py-2 text-left font-mono text-xs text-muted-foreground transition-colors",
                              itemIndex === headerSuggestActiveIndex && "bg-accent text-foreground",
                            )}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setHeaderSuggestActive(itemIndex)}
                            onClick={() => applyHeaderSuggestion(preset)}
                          >
                            {preset}
                          </AstryxButton>
                        ))}
                      </AstryxView>
                    }
                  />
                ) : null}
              </AstryxView>
            ) : (
              <VStack as="section" key="usage" className="provider-panel-enter" gap={4}>
                <HStack gap={3} vAlign="center">
                  <Wallet aria-hidden="true" />
                  <StackItem size="fill">
                    <VStack gap={0.5}>
                      <AstryxParagraph className="text-sm font-semibold">
                        {t("settings.usage.title")}
                      </AstryxParagraph>
                      <AstryxParagraph className="text-xs text-muted-foreground">
                        {t("settings.usage.desc")}
                      </AstryxParagraph>
                    </VStack>
                  </StackItem>
                  <Switch
                    label={t("settings.usage.title")}
                    isLabelHidden
                    size="sm"
                    value={usageQuery.enabled}
                    onChange={(enabled) => patchUsageQuery({ enabled })}
                  />
                </HStack>

                <Selector
                  label={t("settings.usage.mode")}
                  value={usageQuery.mode}
                  onChange={(mode) => patchUsageQuery({ mode: mode as UsageQueryMode })}
                  options={USAGE_QUERY_MODES.map((mode) => ({
                    value: mode,
                    label: t(`settings.usage.mode.${mode}`),
                  }))}
                  width="100%"
                />
                <NumberInput
                  label={t("settings.usage.timeout")}
                  min={2}
                  max={30}
                  value={usageQuery.timeoutSecs ?? 10}
                  isWheelEnabled={false}
                  width="100%"
                  onChange={(value) => patchUsageQuery({ timeoutSecs: value ?? 10 })}
                />
                <TextInput
                  label={t("settings.usage.baseUrl")}
                  value={usageQuery.baseUrl}
                  placeholder={baseUrl}
                  width="100%"
                  onChange={(usageBaseUrl) => patchUsageQuery({ baseUrl: usageBaseUrl })}
                />
                <TextInput
                  label="API Key"
                  type="password"
                  value={usageQuery.apiKey}
                  placeholder={
                    usageQuery.apiKeyConfigured
                      ? t("settings.usage.secretSaved")
                      : t("settings.usage.providerCredential")
                  }
                  width="100%"
                  onChange={(usageApiKey) => patchUsageQuery({ apiKey: usageApiKey })}
                />

                {usageQuery.mode === "newapi" ? (
                  <VStack gap={3}>
                    <TextInput
                      label="Access Token"
                      type="password"
                      value={usageQuery.accessToken}
                      width="100%"
                      onChange={(accessToken) => patchUsageQuery({ accessToken })}
                    />
                    <TextInput
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
                      label="Plan Provider"
                      value={usageQuery.codingPlanProvider}
                      placeholder="auto / zhipu_team / zenmux"
                      width="100%"
                      onChange={(codingPlanProvider) => patchUsageQuery({ codingPlanProvider })}
                    />
                    <TextInput
                      label="Organization ID"
                      value={usageQuery.teamOrganizationId}
                      width="100%"
                      onChange={(teamOrganizationId) => patchUsageQuery({ teamOrganizationId })}
                    />
                    <TextInput
                      label="Project ID"
                      value={usageQuery.teamProjectId}
                      width="100%"
                      onChange={(teamProjectId) => patchUsageQuery({ teamProjectId })}
                    />
                    <TextInput
                      label="Access Key ID"
                      value={usageQuery.accessKeyId}
                      width="100%"
                      onChange={(accessKeyId) => patchUsageQuery({ accessKeyId })}
                    />
                    <TextInput
                      label="Secret Access Key"
                      type="password"
                      value={usageQuery.secretAccessKey}
                      width="100%"
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
                    icon={<RefreshCw />}
                    isLoading={usageTest.loading}
                    isDisabled={!initialData?.id || usageTest.loading}
                    onClick={() => void runUsageQueryTest()}
                  />
                  {!initialData?.id ? (
                    <AstryxParagraph className="text-xs text-muted-foreground">
                      {t("settings.usage.saveBeforeTest")}
                    </AstryxParagraph>
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
          </AstryxView>
        </Stack>
      </StackItem>

      <Toolbar
        label={t("settings.providerDialogNavigation")}
        size="md"
        dividers={["top"]}
        endContent={
          <HStack gap={2} width={isCompact ? "100%" : undefined}>
            <AstryxNativeButton
              label={t("settings.cancel")}
              variant="secondary"
              onClick={onClose}
              width={isCompact ? "100%" : undefined}
            />
            <AstryxNativeButton
              label={t("settings.save")}
              variant="primary"
              onClick={handleSave}
              width={isCompact ? "100%" : undefined}
            />
          </HStack>
        }
      />
    </VStack>
  );
}

function ProviderAdvancedSettingsPanel(
  props: SettingsSectionProps & { providerType: ProviderId; onClose: () => void },
) {
  const { settings, setSettings, providerType, onClose } = props;
  const { t } = useLocale();
  const modelOptions = useMemo(() => buildModelOptions(settings), [settings]);
  const conversationTitleModel = settings.customSettings.conversationTitleModel;
  const commitMessageModel = settings.customSettings.commitMessageModel;
  const selectedValue = conversationTitleModel
    ? toModelValue(conversationTitleModel.customProviderId, conversationTitleModel.model)
    : "";
  // A stored model that is no longer among the active options still shows as
  // selected (same fallback-entry approach as the cron prompt form).
  const titleModelOptions =
    conversationTitleModel && !modelOptions.some((option) => option.value === selectedValue)
      ? [
          ...modelOptions,
          {
            value: selectedValue,
            label: conversationTitleModel.model,
            providerName: conversationTitleModel.customProviderId,
          },
        ]
      : modelOptions;
  const commitSelectedValue = commitMessageModel
    ? toModelValue(commitMessageModel.customProviderId, commitMessageModel.model)
    : "";
  const commitModelOptions =
    commitMessageModel && !modelOptions.some((option) => option.value === commitSelectedValue)
      ? [
          ...modelOptions,
          {
            value: commitSelectedValue,
            label: commitMessageModel.model,
            providerName: commitMessageModel.customProviderId,
          },
        ]
      : modelOptions;

  function handleModelChange(key: "conversationTitleModel" | "commitMessageModel", value: string) {
    // "" comes from the picker's follow-current entry and parses to undefined.
    setSettings((prev) =>
      updateCustomSettings(prev, {
        [key]: parseModelValue(value) ?? undefined,
      }),
    );
  }

  function resetRuntimeConfiguration() {
    setSettings((previous) => ({
      ...previous,
      modelFailover: normalizeModelFailoverSettings({}, previous.customProviders),
      retryErrorSettings: normalizeRetryErrorSettings({}),
      customProviders: updateCustomProviders(
        previous,
        previous.customProviders.map((provider) => ({
          ...provider,
          retryPolicy: undefined,
          usageQuery: getDefaultUsageQueryConfig(),
        })),
      ).customProviders,
    }));
  }

  return (
    <VStack height="100%" minHeight={0} gap={0}>
      <Toolbar
        label={t("settings.customSettings")}
        size="md"
        dividers={["bottom"]}
        startContent={
          <HStack gap={2} vAlign="center">
            <IconButton
              label={t("settings.closeCustomSettings")}
              tooltip={t("settings.closeCustomSettings")}
              variant="ghost"
              icon={<ArrowLeft />}
              onClick={onClose}
            />
            <VStack gap={0.5}>
              <Heading level={3}>{t("settings.customSettings")}</Heading>
              <Text type="supporting" color="secondary">
                {t("settings.conversationTitleModelHint")}
              </Text>
            </VStack>
          </HStack>
        }
      />

      <StackItem size="fill" isScrollable>
        <VStack
          width="100%"
          maxWidth="var(--xagent-settings-content-max-width)"
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

function ccsImportIdentity(provider: Pick<CustomProvider, "type" | "name" | "baseUrl">) {
  const name = provider.name
    .replace(/[（(]ccswitch[）)]/i, "")
    .trim()
    .toLowerCase();
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/, "").toLowerCase();
  return `${provider.type}\n${name}\n${baseUrl}`;
}

function providerFromCcs(item: CcsProviderImportItem, existingIds: Set<string>): CustomProvider {
  const baseId =
    `ccswitch-${item.sourceId}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "ccswitch-provider";
  let id = baseId;
  for (let index = 2; existingIds.has(id); index += 1) id = `${baseId}-${index}`;
  existingIds.add(id);

  const providerType = item.providerType;
  const models = (item.models ?? []).map((model) => createDraftModelConfig(providerType, model));
  return {
    id,
    name: `${item.name.replace(/[（(]ccswitch[）)]/i, "").trim()}（ccswitch）`,
    type: providerType,
    baseUrl: item.baseUrl,
    isFullUrl: item.isFullUrl,
    ...(item.providerType !== "gemini" && item.modelsUrl?.trim()
      ? { modelsUrl: item.modelsUrl.trim() }
      : {}),
    apiKey: item.apiKey,
    apiKeyConfigured: item.apiKey.trim().length > 0,
    models,
    activeModels: models.map((model) => model.id),
    requestFormat:
      providerType === "xai"
        ? "openai-responses"
        : providerType === "codex"
          ? item.requestFormat === "openai-completions"
            ? "openai-completions"
            : "openai-responses"
          : undefined,
    reasoning: "off",
    promptCachingEnabled:
      providerType !== "gemini" && providerType !== "xai" && providerType !== "deepseek",
    nativeWebSearchEnabled: true,
    useSystemProxy: false,
  };
}

function ccsProviderCanSyncModels(item: CcsProviderImportItem) {
  return item.baseUrl.trim().length > 0 && item.apiKey.trim().length > 0;
}

function ccsProviderIsTransferable(item: CcsProviderImportItem) {
  return ccsProviderCanSyncModels(item) || (item.models?.length ?? 0) > 0;
}

function cherryProviderId(item: CherryProviderImportItem) {
  const baseId = `cherry-studio-${item.sourceId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return baseId || "cherry-studio-provider";
}

function cherryProviderName(item: CherryProviderImportItem, allItems: CherryProviderImportItem[]) {
  const duplicateCount = allItems.filter(
    (candidate) =>
      candidate.name.trim().toLowerCase() === item.name.trim().toLowerCase() &&
      candidate.providerType === item.providerType &&
      candidate.baseUrl.trim().replace(/\/+$/, "").toLowerCase() ===
        item.baseUrl.trim().replace(/\/+$/, "").toLowerCase(),
  ).length;
  if (duplicateCount <= 1) return `${item.name.trim()}（Cherry Studio）`;
  const sourceId = item.sourceId.split("::", 1)[0].slice(0, 8);
  return `${item.name.trim()}（Cherry Studio · ${sourceId}）`;
}

// Re-syncing an existing provider must not silently revert an API key the
// user already configured in XAgent; like `name`, the existing key wins.
function cherryEffectiveApiKey(item: CherryProviderImportItem, existing?: CustomProvider) {
  return existing?.apiKey?.trim() ? existing.apiKey : item.apiKey;
}

function providerFromCherry(
  item: CherryProviderImportItem,
  allItems: CherryProviderImportItem[],
  existing?: CustomProvider,
): CustomProvider {
  const providerType = item.providerType;
  const models = existing?.models ?? [];
  const apiKey = cherryEffectiveApiKey(item, existing);
  return {
    ...(existing ?? {}),
    id: cherryProviderId(item),
    name: existing?.name ?? cherryProviderName(item, allItems),
    type: providerType,
    baseUrl: item.baseUrl,
    isFullUrl: existing?.isFullUrl ?? false,
    ...(existing?.modelsUrl ? { modelsUrl: existing.modelsUrl } : {}),
    apiKey,
    apiKeyConfigured: apiKey.trim().length > 0,
    models,
    activeModels: existing?.activeModels ?? [],
    requestFormat:
      providerType === "xai"
        ? "openai-responses"
        : providerType === "codex"
          ? item.requestFormat === "openai-completions"
            ? "openai-completions"
            : "openai-responses"
          : undefined,
    reasoning: existing?.reasoning ?? "off",
    promptCachingEnabled:
      providerType === "deepseek" || providerType === "xai" || providerType === "gemini"
        ? false
        : (existing?.promptCachingEnabled ?? true),
    nativeWebSearchEnabled: existing?.nativeWebSearchEnabled ?? true,
    useSystemProxy: existing?.useSystemProxy ?? false,
  };
}

function isLikelyCherryChatModel(modelId: string) {
  const lower = modelId.toLowerCase();
  return ![
    "embedding",
    "rerank",
    "whisper",
    "realtime",
    "audio-preview",
    "audio-realtime",
    "image",
    "video",
    "banana",
    "dall-e",
    "imagen",
    "sora-",
    "veo-",
    "tts-",
  ].some((needle) => lower.includes(needle));
}

// sourceId alone can collide across ccswitch app_type buckets that map to the
// same provider tab (e.g. "claude" and "claude-code"), so key rows on both.
function ccsItemKey(item: CcsProviderImportItem) {
  return `${item.appType}:${item.sourceId}`;
}

function CcsSourceLogo({ className }: { className?: string }) {
  return (
    <img
      src={ccswitchLogoUrl}
      alt=""
      draggable={false}
      className={cn("shrink-0 select-none rounded-lg object-contain", className)}
    />
  );
}

function CherrySourceLogo({ className }: { className?: string }) {
  return (
    <img
      src={cherryStudioLogoUrl}
      alt=""
      draggable={false}
      className={cn("shrink-0 select-none rounded-lg object-contain", className)}
    />
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
        <DialogHeader
          title="从 CC Switch 导入"
          subtitle="选择要导入的供应商配置；导入后会自动获取并激活模型。"
          startContent={
            <IconButton
              label="返回"
              tooltip="返回供应商配置"
              variant="ghost"
              size="sm"
              icon={<ArrowLeft />}
              isDisabled={submitting}
              onClick={onClose}
            />
          }
          endContent={<CcsSourceLogo className="h-7 w-7" />}
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
                    icon={<RefreshCw />}
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
  const {
    type,
    isActive,
    providers,
    onAdd,
    onEdit,
    onDelete,
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
  const filtered = providers.filter((provider) => provider.type === type);
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
  }, [isActive]);

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
        <AstryxView layout="block" direction="horizontal" className="text-sm text-muted-foreground">
          {filtered.length === 0
            ? t("settings.noProviders")
            : `${filtered.length} ${t("settings.navProviders")}`}
        </AstryxView>
        <HStack gap={2} vAlign="center">
          <AstryxNativeButton
            label={t("settings.addProvider")}
            variant="primary"
            size="sm"
            icon={<Plus />}
            onClick={onAdd}
          />
          {thirdPartyImportEnabled ? (
            <DropdownMenu
              button={{
                label: t("settings.thirdPartySync"),
                variant: "secondary",
                size: "sm",
                icon: <Download />,
                isLoading: thirdPartyImporting,
                isDisabled: thirdPartyImporting,
              }}
              isMenuOpen={syncMenuOpen}
              onOpenChange={handleSyncMenuOpenChange}
              alignment="end"
              menuWidth="var(--xagent-provider-import-menu-width)"
              items={[
                {
                  id: "refresh",
                  label: t("settings.refreshLocalProviderConfigs"),
                  icon: <RefreshCw />,
                  isDisabled: thirdPartyLoading || thirdPartyImporting,
                  onClick: onRefreshThirdPartyProviders,
                },
                { type: "divider" },
                {
                  id: "cc-switch",
                  label: `CC Switch${ccsAll.length > 0 ? ` (${ccsAll.length})` : ""}`,
                  description: ccsSubtitle,
                  icon: <CcsSourceLogo />,
                  isDisabled: ccsLoading || thirdPartyImporting,
                  onClick: onOpenCcsImport,
                },
                {
                  id: "cherry-studio",
                  label: `Cherry Studio${cherryReady > 0 ? ` (${cherryReady})` : ""}`,
                  description: cherrySubtitle,
                  icon: <CherrySourceLogo />,
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
                size="sm"
                icon={<Plus />}
                onClick={onAdd}
              />
            }
          />
        ) : (
          <AstryxList density="compact" hasDividers>
            {filtered.map((provider) => {
              const usageState = props.usage.getState(provider.id);
              const usagePlan = usageState.result?.data[0];
              const usageSummary = usageState.result?.error
                ? usageState.result.error
                : usagePlan
                  ? [
                      usagePlan.planName || usagePlan.extra,
                      typeof usagePlan.remaining === "number"
                        ? `${t("settings.usage.remaining")}: ${usagePlan.remaining.toLocaleString()}${usagePlan.unit ? ` ${usagePlan.unit}` : ""}`
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : undefined;
              return (
                <ListItem
                  key={provider.id}
                  label={provider.name}
                  description={
                    usageSummary ||
                    `${provider.baseUrl || t("settings.noBaseUrl")} · ${provider.activeModels.length} ${t("settings.activeModels")}`
                  }
                  startContent={<ProviderBrandIcon type={type} />}
                  endContent={
                    <HStack gap={1} vAlign="center">
                      {provider.usageQuery?.enabled ? (
                        <IconButton
                          label={t("settings.usage.refresh")}
                          tooltip={t("settings.usage.refresh")}
                          variant="ghost"
                          size="sm"
                          icon={<RefreshCw />}
                          isLoading={usageState.loading}
                          isDisabled={usageState.loading}
                          onClick={(event) => {
                            event.stopPropagation();
                            void props.usage.refresh(provider.id);
                          }}
                        />
                      ) : null}
                      {provider.useSystemProxy ? (
                        <Waypoints title={t("settings.providerUseSystemProxy")} />
                      ) : null}
                      <IconButton
                        label={t("settings.edit")}
                        tooltip={t("settings.edit")}
                        variant="ghost"
                        size="sm"
                        icon={<Pencil />}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit(provider);
                        }}
                      />
                      <ConfirmDeletePopover
                        name={provider.name}
                        onConfirm={() => onDelete(provider.id)}
                      >
                        {(open) => (
                          <IconButton
                            label={t("settings.delete")}
                            tooltip={t("settings.delete")}
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 />}
                            onClick={(event) => {
                              event.stopPropagation();
                              open();
                            }}
                          />
                        )}
                      </ConfirmDeletePopover>
                    </HStack>
                  }
                  onClick={() => onEdit(provider)}
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

  function buildCcsImportedProviders(
    existingProviders: CustomProvider[],
    items: CcsProviderImportItem[],
  ) {
    const existingIds = new Set(existingProviders.map((provider) => provider.id));
    const existingIdentity = new Set(existingProviders.map(ccsImportIdentity));
    const imported: CustomProvider[] = [];

    for (const item of items) {
      if (!ccsProviderIsTransferable(item)) continue;
      const identity = ccsImportIdentity({
        type: item.providerType,
        name: item.name,
        baseUrl: item.baseUrl,
      });
      if (existingIdentity.has(identity)) continue;
      existingIdentity.add(identity);
      imported.push(providerFromCcs(item, existingIds));
    }

    return imported;
  }

  // 后台补拉模型列表：失败只体现在 ccsMessage 里，导入的配置不受影响。
  // 恒带 useSystemProxy —— 反代按应用代理配置出网（未启用=直连）。
  async function syncCcsModelsInBackground(
    transferable: CcsProviderImportItem[],
    importedSummary: string,
  ) {
    const syncable = transferable.filter(ccsProviderCanSyncModels);
    const modelResults = await Promise.all(
      syncable.map(async (item) => {
        const identity = ccsImportIdentity({
          type: item.providerType,
          name: item.name,
          baseUrl: item.baseUrl,
        });
        try {
          const models = await fetchModelsFromApi(item.providerType, item.baseUrl, item.apiKey, {
            useSystemProxy: true,
            isFullUrl: item.isFullUrl,
            modelsUrl: item.modelsUrl,
          });
          return { identity, models, fetched: true };
        } catch {
          return { identity, models: [] as ProviderModelConfig[], fetched: false };
        }
      }),
    );

    const resultsByIdentity = new Map(
      modelResults.map((result) => [result.identity, result] as const),
    );
    setSettings((prev) => {
      let changed = false;
      const providers = prev.customProviders.map((provider) => {
        const result = resultsByIdentity.get(ccsImportIdentity(provider));
        if (!result?.fetched) return provider;
        const models = mergeFetchedModels(result.models, provider.models);
        const activeModels = models.map((model) => model.id);
        if (
          models === provider.models &&
          activeModels.length === provider.activeModels.length &&
          activeModels.every((model, index) => model === provider.activeModels[index])
        ) {
          return provider;
        }
        changed = true;
        return { ...provider, models, activeModels };
      });
      return changed ? updateCustomProviders(prev, providers) : prev;
    });

    const fetchedCount = modelResults.filter((result) => result.fetched).length;
    const failedCount = modelResults.length - fetchedCount;
    const totalModels = modelResults.reduce((total, result) => total + result.models.length, 0);
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
    const modelResults = await Promise.all(
      importable.map(async (item) => {
        const identity = cherryProviderId(item);
        try {
          const fetchedModels = await fetchModelsFromApi(
            item.providerType,
            item.baseUrl,
            cherryEffectiveApiKey(item, existingById.get(identity)),
            {
              isFullUrl: existingById.get(identity)?.isFullUrl,
              modelsUrl: existingById.get(identity)?.modelsUrl,
            },
          );
          const models = fetchedModels.filter((model) => isLikelyCherryChatModel(model.id));
          return { identity, models, fetched: true, failed: false };
        } catch {
          return {
            identity,
            models: [] as ProviderModelConfig[],
            fetched: false,
            failed: true,
          };
        }
      }),
    );

    // Two selected items can normalize to the same provider id; merge their
    // results instead of letting the last one win.
    const resultsByIdentity = new Map<string, (typeof modelResults)[number]>();
    for (const result of modelResults) {
      const merged = resultsByIdentity.get(result.identity);
      if (!merged) {
        resultsByIdentity.set(result.identity, result);
        continue;
      }
      resultsByIdentity.set(result.identity, {
        identity: result.identity,
        models: mergeFetchedModels(result.models, merged.models),
        fetched: merged.fetched || result.fetched,
        failed: merged.failed || result.failed,
      });
    }

    setSettings((prev) => {
      let changed = false;
      const providers = prev.customProviders.map((provider) => {
        const result = resultsByIdentity.get(provider.id);
        if (!result?.fetched) return provider;

        const models = mergeFetchedModels(result.models, provider.models);
        const activeModels = models.map((model) => model.id);
        if (
          models.length === provider.models.length &&
          models.every((model, index) => model.id === provider.models[index]?.id) &&
          activeModels.length === provider.activeModels.length &&
          activeModels.every((model, index) => model === provider.activeModels[index])
        ) {
          return provider;
        }
        changed = true;
        return { ...provider, models, activeModels };
      });
      return changed ? updateCustomProviders(prev, providers) : prev;
    });

    const fetchedCount = modelResults.filter((result) => result.fetched).length;
    const failedCount = modelResults.filter((result) => result.failed).length;
    const refreshedModelCount = modelResults.reduce(
      (total, result) => total + result.models.length,
      0,
    );
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
        <ProviderEditor
          providerType={activeTab}
          initialData={editingProvider ?? undefined}
          onSave={handleSave}
          onClose={closeEditor}
        />
      ) : view === "advanced" ? (
        <ProviderAdvancedSettingsPanel
          settings={settings}
          setSettings={setSettings}
          providerType={activeTab}
          onClose={() => setView("list")}
        />
      ) : (
        <VStack height="100%" minHeight={0} gap={0}>
          <Toolbar
            label={t("settings.navProviders")}
            size="sm"
            dividers={["bottom"]}
            startContent={
              <TabList
                value={activeTab}
                onChange={(value) => setActiveTab(value as ProviderId)}
                size="sm"
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
                size="sm"
                icon={<Settings />}
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
