import { Badge } from "@astryxdesign/core/Badge";
import { Button as AstryxNativeButton } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List as AstryxList, ListItem } from "@astryxdesign/core/List";
import { Popover } from "@astryxdesign/core/Popover";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
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
  CheckCircle2,
  ClaudeIcon,
  Download,
  Eye,
  EyeOff,
  GeminiIcon,
  Globe,
  Key,
  List,
  Loader2,
  OpenaiChatgptIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Waypoints,
  X,
  Zap,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
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
  CODEX_REQUEST_FORMAT_LABELS,
  type CodexRequestFormat,
  type CustomProvider,
  type ProviderAuthMode,
  type ProviderId,
  type ProviderModelConfig,
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
import { ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

type ModalProps = {
  providerType: ProviderId;
  initialData?: CustomProvider;
  onSave: (data: Omit<CustomProvider, "id">) => void;
  onClose: () => void;
};

type ProviderDialogPanel = "general" | "request";

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
  return String(Math.round(value / 1_000)) + "K";
}
function ProviderModal({ providerType, initialData, onSave, onClose }: ModalProps) {
  const { t } = useLocale();
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
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);

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
  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      purpose="form"
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "var(--xagent-provider-dialog-width)"}
      maxHeight={
        isCompact ? "var(--xagent-viewport-height)" : "var(--xagent-provider-dialog-height)"
      }
      padding={0}
    >
      <AstryxView
        layout="flex"
        direction="vertical"
        className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4 max-[720px]:px-3.5 max-[720px]:py-3"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex min-w-0 items-center gap-3"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex h-9 w-9 shrink-0 items-center justify-center text-xl text-foreground"
            >
              <ProviderBrandIcon type={providerType} />
            </AstryxView>
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex min-w-0 flex-wrap items-center gap-2"
            >
              <AstryxView layout="block" direction="horizontal" className="text-sm font-semibold">
                {isEditing ? t("settings.editProvider") : t("settings.addProvider")}
              </AstryxView>
              <AstryxInline className="rounded-full border bg-muted/60 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                {typeLabel} {t("settings.compatible")}
              </AstryxInline>
            </AstryxView>
          </AstryxView>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title={t("settings.close")}
            aria-label={t("settings.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex min-h-0 flex-1 max-[720px]:flex-col"
        >
          {isCompact ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="shrink-0 border-b bg-muted/30 px-3 pt-2"
            >
              <TabList
                value={activePanel}
                onChange={(value) => setActivePanel(value as "general" | "request")}
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
                    <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                      <Label htmlFor="modal-apikey">
                        {authMode === "oauth-token" ? t("settings.providerOAuthToken") : "API Key"}
                      </Label>
                      <AstryxView layout="block" direction="horizontal" className="relative">
                        <Input
                          id="modal-apikey"
                          type={showApiKey ? "text" : "password"}
                          value={apiKey}
                          disabled={isBrowser}
                          className="pr-10"
                          onChange={(event) => setApiKey(event.currentTarget.value)}
                          onFocus={(event) => {
                            if (apiKeyIsRedactedDisplay) event.currentTarget.select();
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-10 w-10 text-muted-foreground hover:bg-transparent hover:text-foreground"
                          onClick={() => setShowApiKey((prev) => !prev)}
                          disabled={isBrowser}
                          title={showApiKey ? t("settings.hideApiKey") : t("settings.showApiKey")}
                          aria-label={
                            showApiKey ? t("settings.hideApiKey") : t("settings.showApiKey")
                          }
                        >
                          {showApiKey ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </AstryxView>
                    </AstryxView>
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
            ) : (
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
            )}
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/20 px-5 py-3.5 max-[720px]:px-3.5 max-[720px]:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-[720px]:pt-3"
        >
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
        </AstryxView>
      </AstryxView>
    </Dialog>
  );
}

function CustomSettingsDrawer(props: SettingsSectionProps & { onClose: () => void }) {
  const { settings, setSettings, onClose } = props;
  const { t } = useLocale();
  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );
  const modelOptions = useMemo(() => buildModelOptions(settings), [settings]);
  const conversationTitleModel = settings.customSettings.conversationTitleModel;
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

  function handleTitleModelChange(value: string) {
    // "" comes from the picker's follow-current entry and parses to undefined.
    setSettings((prev) =>
      updateCustomSettings(prev, {
        conversationTitleModel: parseModelValue(value) ?? undefined,
      }),
    );
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      aria-labelledby="provider-custom-settings-title"
      purpose="form"
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "var(--xagent-drawer-width-compact)"}
      maxHeight="var(--xagent-viewport-height)"
      padding={0}
      style={{
        marginInlineStart: "auto",
        marginInlineEnd: 0,
        blockSize: "var(--xagent-viewport-height)",
        ...(isCompact
          ? {}
          : { borderRadius: "var(--radius-container) 0 0 var(--radius-container)" }),
      }}
    >
      <AstryxView as="aside" className="relative flex h-full w-full flex-col overflow-hidden">
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="relative flex items-start gap-3 px-6 pb-4 pt-[22px]"
        >
          <AstryxView
            layout="block"
            direction="horizontal"
            className="min-w-0 flex-1 max-[720px]:basis-[calc(100%-3rem)]"
          >
            <AstryxView
              layout="block"
              direction="horizontal"
              id="provider-custom-settings-title"
              className="text-[17px] font-semibold leading-tight tracking-tight text-foreground/95"
            >
              {t("settings.customSettings")}
            </AstryxView>
            <AstryxView
              layout="block"
              direction="horizontal"
              className="mt-1 text-[12px] leading-relaxed text-muted-foreground/90"
            >
              {t("settings.conversationTitleModelHint")}
            </AstryxView>
          </AstryxView>
          <AstryxButton
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-muted-foreground/80 transition-colors hover:bg-foreground/[0.12] hover:text-foreground"
            title={t("settings.closeCustomSettings")}
            aria-label={t("settings.closeCustomSettings")}
          >
            <X className="h-3.5 w-3.5" />
          </AstryxButton>
        </AstryxView>

        <AstryxView
          layout="block"
          direction="horizontal"
          aria-hidden="true"
          className="relative mx-6 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent"
        />

        <AstryxView
          layout="block"
          direction="horizontal"
          className="relative min-h-0 flex-1 overflow-y-auto px-6 py-5"
        >
          <AstryxView as="section" className="space-y-3">
            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-xl border border-border bg-muted/25 p-4"
            >
              <AstryxView layout="block" direction="horizontal" className="space-y-2">
                <Label className="text-[12.5px] font-medium text-foreground/85">
                  {t("settings.conversationTitleModel")}
                </Label>
                <ModelPicker
                  options={titleModelOptions}
                  value={selectedValue}
                  onChange={handleTitleModelChange}
                  placeholder={t("settings.conversationTitleModelFollowCurrent")}
                  noneLabel={t("settings.conversationTitleModelFollowCurrent")}
                  ariaLabel={t("settings.conversationTitleModel")}
                />
                {modelOptions.length === 0 ? (
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="mt-1 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300"
                  >
                    {t("settings.customSettingsModelEmpty")}
                  </AstryxView>
                ) : null}
              </AstryxView>
            </AstryxView>
          </AstryxView>
        </AstryxView>
      </AstryxView>
    </Dialog>
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

function CcsImportModal(props: {
  initialType: ProviderId;
  items: CcsProviderImportItem[];
  existingProviders: CustomProvider[];
  onImport: (items: CcsProviderImportItem[]) => Promise<string>;
  onClose: () => void;
}) {
  const { initialType, items, existingProviders, onImport, onClose } = props;
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

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [result, setResult] = useState<string | null>(null);
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
      setResult(summary);
      setSelected(new Set());
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen && !submitting) onClose();
      }}
      purpose="form"
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "var(--xagent-dialog-width-lg)"}
      maxHeight={isCompact ? "var(--xagent-viewport-height)" : "var(--xagent-dialog-height-md)"}
      padding={0}
    >
      <AstryxView
        layout="flex"
        direction="vertical"
        className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center gap-3 border-b px-6 py-4"
        >
          <CcsSourceLogo className="h-9 w-9" />
          <AstryxView
            layout="block"
            direction="horizontal"
            className="min-w-0 flex-1 max-[720px]:basis-[calc(100%-3rem)]"
          >
            <AstryxView layout="block" direction="horizontal" className="text-sm font-semibold">
              从 CC Switch 导入
            </AstryxView>
            <AstryxView
              layout="block"
              direction="horizontal"
              className="mt-0.5 text-xs text-muted-foreground"
            >
              左侧选择供应商类型，右侧勾选要导入的配置，导入后自动获取并激活模型
            </AstryxView>
          </AstryxView>
          <AstryxButton
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={onClose}
            disabled={submitting}
            title={t("settings.cancel")}
            aria-label={t("settings.cancel")}
          >
            <X className="h-3.5 w-3.5" />
          </AstryxButton>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex min-h-0 flex-1 max-[720px]:flex-col"
        >
          {groups.length === 0 ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex flex-1 items-center justify-center px-6 py-10 text-sm text-muted-foreground"
            >
              未发现可导入的供应商
            </AstryxView>
          ) : (
            <>
              <AstryxView
                layout="flex"
                direction="vertical"
                className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted/30 p-2"
              >
                {groups.map((group) => {
                  const groupSelectable = group.rows.filter((row) => row.selectable);
                  const groupSelected = groupSelectable.filter((row) =>
                    selected.has(row.key),
                  ).length;
                  const active = group.type === activeGroup?.type;
                  return (
                    <AstryxButton
                      key={group.type}
                      type="button"
                      onClick={() => setActiveType(group.type)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                        active
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <AstryxView
                        as="span"
                        layout="flex"
                        direction="horizontal"
                        className="flex w-5 shrink-0 items-center justify-center text-base"
                      >
                        <ProviderBrandIcon type={group.type} />
                      </AstryxView>
                      <AstryxInline className="min-w-0 flex-1 max-[720px]:basis-[calc(100%-3rem)]">
                        <AstryxInline className="block truncate text-sm font-medium">
                          {getProviderLabel(group.type)}
                        </AstryxInline>
                        <AstryxInline className="block text-[11px] text-muted-foreground">
                          {group.rows.length} 项配置
                        </AstryxInline>
                      </AstryxInline>
                      {groupSelected > 0 ? (
                        <AstryxInline className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          {groupSelected}
                        </AstryxInline>
                      ) : null}
                    </AstryxButton>
                  );
                })}
              </AstryxView>

              <AstryxView
                layout="flex"
                direction="vertical"
                className="flex min-w-0 flex-1 flex-col"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-center justify-between gap-2 border-b bg-muted/20 px-5 py-2"
                >
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="text-xs text-muted-foreground"
                  >
                    已选 {activeSelectedCount} / {activeSelectableKeys.length} 个可导入
                  </AstryxView>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={toggleAllActive}
                    disabled={!activeSelectableKeys.length || submitting}
                  >
                    {activeAllSelected ? t("settings.deselectAll") : t("settings.selectAll")}
                  </Button>
                </AstryxView>

                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="min-h-0 flex-1 divide-y overflow-y-auto"
                >
                  {activeRows.map(({ item, key, exists, transferable, selectable }) => {
                    return (
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        key={key}
                        className={cn(
                          "flex items-center gap-3 px-5 py-3 transition-colors",
                          selectable ? "cursor-pointer hover:bg-accent/40" : "opacity-55",
                        )}
                      >
                        <CheckboxInput
                          label={item.name}
                          isLabelHidden
                          value={selectable && selected.has(key)}
                          isDisabled={!selectable || submitting}
                          onChange={() => toggleRow(key)}
                          size="sm"
                        />
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="min-w-0 flex-1 max-[720px]:basis-[calc(100%-3rem)]"
                        >
                          <AstryxView
                            layout="flex"
                            direction="horizontal"
                            className="flex items-center gap-2"
                          >
                            <AstryxInline className="truncate text-sm font-medium">
                              {item.name}
                            </AstryxInline>
                            {exists ? (
                              <AstryxInline className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                已导入
                              </AstryxInline>
                            ) : !transferable ? (
                              <AstryxInline className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                无 API 配置
                              </AstryxInline>
                            ) : null}
                          </AstryxView>
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            className="mt-0.5 truncate text-xs text-muted-foreground"
                          >
                            {item.baseUrl || "未配置 Base URL"}
                          </AstryxView>
                        </AstryxView>
                        {item.apiKey.trim() ? (
                          <AstryxInline
                            className="shrink-0 text-muted-foreground"
                            title="已包含 API Key"
                          >
                            <Key className="h-3 w-3" />
                          </AstryxInline>
                        ) : null}
                      </AstryxView>
                    );
                  })}
                </AstryxView>
              </AstryxView>
            </>
          )}
        </AstryxView>

        {result ? (
          <AstryxView layout="block" direction="horizontal" className="border-t px-6 py-3">
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <AstryxInline>{result}</AstryxInline>
            </AstryxView>
          </AstryxView>
        ) : null}

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center justify-between gap-2 border-t px-6 py-4"
        >
          <AstryxView
            layout="block"
            direction="horizontal"
            className="text-xs text-muted-foreground"
          >
            共已选 {selectedCount} / {selectableKeys.length} 个可导入
          </AstryxView>
          <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={submitting}
              className="max-[720px]:h-10 max-[720px]:flex-1"
            >
              {result ? "关闭" : t("settings.cancel")}
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => void handleImport()}
              disabled={submitting || selectedCount === 0}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在导入…
                </>
              ) : (
                `导入 ${selectedCount} 个供应商`
              )}
            </Button>
          </AstryxView>
        </AstryxView>
      </AstryxView>
    </Dialog>
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
                  isDisabled: ccsLoading || !ccsAll.length,
                  onClick: onOpenCcsImport,
                },
                {
                  id: "cherry-studio",
                  label: `Cherry Studio${cherryReady > 0 ? ` (${cherryReady})` : ""}`,
                  description: cherrySubtitle,
                  icon: <CherrySourceLogo />,
                  isDisabled: cherryLoading || cherryImporting || !cherryAll.length,
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
            {filtered.map((provider) => (
              <ListItem
                key={provider.id}
                label={provider.name}
                description={`${provider.baseUrl || t("settings.noBaseUrl")} · ${provider.activeModels.length} ${t("settings.activeModels")}`}
                startContent={<ProviderBrandIcon type={type} />}
                endContent={
                  <HStack gap={1} vAlign="center">
                    {provider.useSystemProxy ? (
                      <Waypoints title={t("settings.providerUseSystemProxy")} />
                    ) : null}
                    <IconButton
                      label={t("settings.edit")}
                      tooltip={t("settings.edit")}
                      variant="ghost"
                      size="sm"
                      icon={<Pencil />}
                      onClick={() => onEdit(provider)}
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
                          onClick={open}
                        />
                      )}
                    </ConfirmDeletePopover>
                  </HStack>
                }
                onClick={() => onEdit(provider)}
              />
            ))}
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
  const [modalOpen, setModalOpen] = useState(false);
  const [customSettingsOpen, setCustomSettingsOpen] = useState(false);
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
    const selected = await invoke<string | null>("system_pick_folder", {
      initial_workdir: cherryDataPath ?? cherryProviders?.dataPath ?? undefined,
    });
    if (!selected) return;

    setCherryLoading(true);
    setCherryMessage("正在扫描选择的 Cherry Studio 数据目录…");
    try {
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

  async function importCherryProviders(items: CherryProviderImportItem[]) {
    const importable = items.filter((item) => item.importable);
    if (!importable.length) {
      const message = "所选 Cherry Studio 配置没有可导入的 API 配置";
      setCherryMessage(message);
      return;
    }

    setCherryImporting(true);
    setCherryMessage("正在同步供应商、获取并激活全部模型…");

    const allItems = cherryProviders?.providers ?? importable;
    const existingById = new Map(
      settings.customProviders.map((provider) => [provider.id, provider] as const),
    );

    try {
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
      const importedByType = PROVIDER_TABS.map((type) => ({
        type,
        count: importable.filter((item) => item.providerType === type).length,
      })).filter((entry) => entry.count > 0);
      const details = [
        `已同步 ${importedByType
          .map((entry) => `${entry.count} 个 ${getProviderLabel(entry.type)}`)
          .join("、")} 供应商`,
        fetchedCount > 0 && refreshedModelCount > 0
          ? `XAgent 获取并激活 ${refreshedModelCount} 个模型`
          : "XAgent API 未返回可用模型",
        failedCount > 0 ? `${failedCount} 个供应商模型获取失败` : "",
      ].filter(Boolean);
      setCherryMessage(details.join("，"));
      setCherryImportType(null);
    } finally {
      setCherryImporting(false);
    }
  }

  function openAdd() {
    setEditingProvider(null);
    setModalOpen(true);
  }

  function openEdit(provider: CustomProvider) {
    setEditingProvider(provider);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
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
    closeModal();
  }

  function handleDelete(id: string) {
    setSettings((prev) =>
      updateCustomProviders(
        prev,
        prev.customProviders.filter((provider) => provider.id !== id),
      ),
    );
  }

  return (
    <>
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
              onClick={() => setCustomSettingsOpen(true)}
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
            />
          </VStack>
        </StackItem>
      </VStack>

      {modalOpen ? (
        <ProviderModal
          providerType={activeTab}
          initialData={editingProvider ?? undefined}
          onSave={handleSave}
          onClose={closeModal}
        />
      ) : null}
      {thirdPartyImportEnabled && ccsImportType ? (
        <CcsImportModal
          initialType={ccsImportType}
          items={ccsProviders?.providers ?? []}
          existingProviders={settings.customProviders}
          onImport={importCcsProviders}
          onClose={() => setCcsImportType(null)}
        />
      ) : null}
      {thirdPartyImportEnabled && cherryImportType && cherryProviders ? (
        <CherryStudioImportModal
          initialType={cherryImportType}
          response={cherryProviders}
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
      ) : null}
      {customSettingsOpen ? (
        <CustomSettingsDrawer
          settings={settings}
          setSettings={setSettings}
          onClose={() => setCustomSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}
