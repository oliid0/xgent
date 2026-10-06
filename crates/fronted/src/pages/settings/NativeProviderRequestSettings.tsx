import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import {
  getCustomHeaderKeyPresets,
  isReservedCustomHeaderKey,
  isValidCustomHeaderKey,
  isValidCustomHeaderValue,
} from "../../lib/providers/customHeaders";
import { type ProviderUsageResult, testProviderUsage } from "../../lib/providers/usageQuery";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import {
  type CustomProvider,
  normalizeUsageQueryConfig,
  PROVIDER_RETRY_DEFAULT_MAX_RETRIES,
  PROVIDER_RETRY_MAX_RETRIES_LIMITS,
  type PromptCacheHintMode,
  switchUsageQueryMode,
  type UsageQueryConfig,
  type UsageQueryMode,
  updateCustomProviders,
} from "../../lib/settings";
import { createUuid } from "../../lib/shared/id";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { withNativeSettingsIcons } from "../../presentation/nativeSettingsIcons";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { PROVIDER_CACHE_HINT_OPTIONS } from "./providerCacheSettings";
import type { SettingsSectionProps } from "./types";

type RequestDraft = {
  proxy: boolean;
  retry: "default" | "off" | "custom";
  retries: number;
  caching: boolean;
  cacheHint: PromptCacheHintMode;
  retention: "short" | "long";
  headers: { id: string; key: string; value: string }[];
  usage: UsageQueryConfig;
};
function createDraft(provider?: CustomProvider): RequestDraft {
  return {
    proxy: provider?.useSystemProxy ?? false,
    retry: provider?.retryPolicy?.mode ?? "default",
    retries:
      provider?.retryPolicy?.mode === "custom"
        ? provider.retryPolicy.maxRetries
        : PROVIDER_RETRY_DEFAULT_MAX_RETRIES,
    caching: provider?.promptCachingEnabled ?? true,
    cacheHint: provider?.promptCacheHintMode ?? "auto",
    retention: provider?.promptCacheRetention === "long" ? "long" : "short",
    headers: (provider?.customHeaders ?? []).map((header) => ({ ...header, id: createUuid() })),
    usage: normalizeUsageQueryConfig(provider?.usageQuery),
  };
}

/** Per-provider request and usage details share the desktop validators and Rust usage commands. */
export function NativeProviderRequestSettings(
  props: SettingsSectionProps & {
    providerId: string;
    canTestUsage?: boolean;
    onBack: () => void;
  },
) {
  const { settings, setSettings } = props,
    { t } = useLocale();
  const provider = settings.customProviders.find((item) => item.id === props.providerId);
  const [draft, setDraft] = useState(() => createDraft(provider));
  const latest = useRef(draft);
  const [page, setPage] = useState("request");
  const [visibleHeaders, setVisibleHeaders] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [testState, setTestState] = useState<{
    loading: boolean;
    result: ProviderUsageResult | null;
    error: string;
  }>({ loading: false, result: null, error: "" });
  const [scope] = useState(() => ({
    id: props.providerId,
    active: true,
    revision: 0,
    testRevision: 0,
    testing: false,
  }));
  const revision = scope.revision;
  const current = () =>
    scope.active && scope.id === props.providerId && scope.revision === revision;
  useEffect(() => {
    scope.active = true;
    scope.testing = false;
    setTestState({ loading: false, result: null, error: "" });
    return () => {
      scope.active = false;
      scope.testRevision++;
    };
  }, [scope]);
  const patch = (value: Partial<RequestDraft>) => {
    if (!current()) return;
    latest.current = { ...latest.current, ...value };
    setDraft(latest.current);
    // Editing a tested configuration retires its old response.
    scope.testRevision++;
    scope.testing = false;
    setTestState({ loading: false, result: null, error: "" });
    setError("");
  };
  const patchUsage = (value: Partial<UsageQueryConfig>) =>
    patch({ usage: normalizeUsageQueryConfig({ ...latest.current.usage, ...value }) });
  const editHeader = (id: string, field: "key" | "value", value: string) =>
    patch({
      headers: latest.current.headers.map((header) =>
        header.id === id ? { ...header, [field]: value } : header,
      ),
    });
  const c = presentationControls();
  const back = () => {
    if (!current()) return;
    scope.active = false;
    scope.revision++;
    props.onBack();
  };
  const validate = (value: RequestDraft) => {
    for (const header of value.headers) {
      if (!header.key.trim() || !isValidCustomHeaderKey(header.key.trim()))
        return t("settings.invalidCustomHeaderKey");
      if (isReservedCustomHeaderKey(header.key.trim()))
        return t("settings.customHeaderReservedTitle");
      if (!isValidCustomHeaderValue(header.value)) return t("settings.invalidCustomHeaderValue");
    }
    return "";
  };
  const save = () => {
    if (!current() || !provider) return;
    const value = latest.current,
      issue = validate(value);
    if (issue) {
      setError(issue);
      return;
    }
    try {
      setSettings((previous) =>
        updateCustomProviders(
          previous,
          previous.customProviders.map((item) => {
            if (item.id !== props.providerId) return item;
            const supportsCache = item.type === "codex" || item.type === "claude_code";
            return {
              ...item,
              useSystemProxy: value.proxy,
              retryPolicy:
                value.retry === "default"
                  ? undefined
                  : value.retry === "off"
                    ? { mode: "off" }
                    : { mode: "custom", maxRetries: value.retries },
              promptCachingEnabled: supportsCache && value.caching,
              promptCacheHintMode:
                item.type === "codex" ? value.cacheHint : item.promptCacheHintMode,
              promptCacheRetention:
                item.type === "claude_code" && value.caching && value.retention === "long"
                  ? "long"
                  : undefined,
              customHeaders: value.headers
                .map(({ key, value }) => ({ key: key.trim(), value }))
                .filter(
                  (header) =>
                    item.type !== "codex" ||
                    item.authMode === "oauth-token" ||
                    header.key.toLowerCase() !== "chatgpt-account-id",
                ),
              usageQuery: normalizeUsageQueryConfig(value.usage),
            };
          }),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    back();
  };
  const testUsage = async () => {
    if (!current() || scope.testing || !provider || props.canTestUsage === false) return;
    scope.testing = true;
    const requestRevision = ++scope.testRevision;
    const ownsTest = () => current() && requestRevision === scope.testRevision;
    setTestState({ loading: true, result: null, error: "" });
    const configuration = latest.current.usage;
    try {
      const result = await testProviderUsage(provider.id, configuration);
      if (ownsTest()) setTestState({ loading: false, result, error: result?.error ?? "" });
    } catch (cause) {
      if (ownsTest())
        setTestState({
          loading: false,
          result: null,
          error: cause instanceof Error ? cause.message : String(cause),
        });
    } finally {
      if (ownsTest()) scope.testing = false;
    }
  };
  const nodes: PresentationNode[] = [
    c.action("provider-request-back", t("settings.native.back"), back),
    {
      ...c.select(
        "provider-detail-section",
        t("settings.providerDialogNavigation"),
        page,
        [
          { value: "request", label: t("settings.providerDialogRequest") },
          { value: "usage", label: t("settings.navUsage") },
        ],
        (value) => {
          if (current()) setPage(value);
        },
      ),
      kind: "SegmentedControl",
    },
  ];
  if (!provider)
    nodes.push({
      id: "provider-request-missing",
      kind: "Banner",
      status: "error",
      label: t("settings.modelUnavailable"),
    });
  else if (page === "request") {
    nodes.push(
      c.group("provider-request-options", t("settings.providerDialogRequest"), [
        c.toggle(
          "provider-system-proxy",
          t("settings.providerUseSystemProxy"),
          draft.proxy,
          (proxy) => patch({ proxy }),
        ),
        {
          ...c.select(
            "provider-stream-retry",
            t("settings.providerStreamRetry"),
            draft.retry,
            [
              { value: "default", label: t("settings.providerStreamRetryDefault") },
              { value: "off", label: t("settings.providerStreamRetryOff") },
              { value: "custom", label: t("settings.providerStreamRetryCustom") },
            ],
            (retry) => patch({ retry: retry as RequestDraft["retry"] }),
          ),
          text: t("settings.providerStreamRetryDesc"),
        },
        ...(draft.retry === "custom"
          ? [
              {
                ...c.number(
                  "provider-stream-retries",
                  t("settings.providerStreamRetryMaxRetries"),
                  draft.retries,
                  PROVIDER_RETRY_MAX_RETRIES_LIMITS.min,
                  PROVIDER_RETRY_MAX_RETRIES_LIMITS.max,
                  1,
                  (retries) => patch({ retries }),
                  true,
                  Math.round,
                ),
                text: t("settings.providerStreamRetryMaxRetriesDesc"),
              },
            ]
          : []),
        ...(provider.type === "codex" || provider.type === "claude_code"
          ? [
              {
                ...c.toggle(
                  "provider-prompt-cache",
                  t("settings.promptCaching"),
                  draft.caching,
                  (caching) => patch({ caching }),
                ),
                text: t(
                  provider.type === "claude_code"
                    ? "settings.promptCachingDescClaude"
                    : "settings.promptCachingDescCodex",
                ),
              },
              ...(provider.type === "claude_code" && draft.caching
                ? [
                    c.select(
                      "provider-cache-retention",
                      t("settings.promptCacheRetention"),
                      draft.retention,
                      [
                        { value: "short", label: t("settings.promptCacheRetentionShort") },
                        { value: "long", label: t("settings.promptCacheRetentionLong") },
                      ],
                      (retention) => patch({ retention: retention as RequestDraft["retention"] }),
                    ),
                  ]
                : []),
              ...(provider.type === "codex" && draft.caching
                ? [
                    c.select(
                      "provider-cache-hint",
                      t("settings.promptCacheHintMode"),
                      draft.cacheHint,
                      PROVIDER_CACHE_HINT_OPTIONS.map((option) => ({
                        value: option.value,
                        label: t(option.labelKey),
                      })),
                      (value) => patch({ cacheHint: value as PromptCacheHintMode }),
                    ),
                  ]
                : []),
            ]
          : []),
      ]),
    );
    nodes.push(
      c.group("provider-request-headers", t("settings.customHeaders"), [
        c.action("provider-header-add", t("settings.addCustomHeader"), () =>
          patch({ headers: [...latest.current.headers, { id: createUuid(), key: "", value: "" }] }),
        ),
        ...(!draft.headers.length
          ? [
              {
                id: "provider-headers-empty",
                kind: "EmptyState" as const,
                label: t("settings.noCustomHeaders"),
                text: t("settings.noCustomHeadersHint"),
              },
            ]
          : []),
        ...draft.headers.map((header) =>
          c.group(`provider-header:${header.id}`, "", [
            c.input(
              `provider-header-key:${header.id}`,
              t("settings.customHeaderName"),
              header.key,
              (value) => editHeader(header.id, "key", value),
            ),
            {
              id: `provider-header-presets:${header.id}`,
              kind: "Menu",
              label: t("settings.customHeaderKeyPlaceholder"),
              children: getCustomHeaderKeyPresets(provider.type)
                .filter(
                  (key) =>
                    !draft.headers.some(
                      (value) =>
                        value.id !== header.id && value.key.toLowerCase() === key.toLowerCase(),
                    ),
                )
                .map((key, index) =>
                  c.action(`provider-header-preset:${header.id}:${index}`, key, () =>
                    editHeader(header.id, "key", key),
                  ),
                ),
            },
            c.input(
              `provider-header-value:${header.id}`,
              t("settings.customHeaderValue"),
              header.value,
              (value) => editHeader(header.id, "value", value),
              !visibleHeaders.has(header.id),
            ),
            c.action(
              `provider-header-show:${header.id}`,
              t(
                visibleHeaders.has(header.id)
                  ? "settings.hideCustomHeaderValue"
                  : "settings.showCustomHeaderValue",
              ),
              () => {
                if (!current()) return;
                setVisibleHeaders((previous) => {
                  const next = new Set(previous);
                  if (next.has(header.id)) next.delete(header.id);
                  else next.add(header.id);
                  return next;
                });
              },
            ),
            {
              ...c.action(
                `provider-header-remove:${header.id}`,
                t("settings.removeCustomHeader"),
                () =>
                  patch({
                    headers: latest.current.headers.filter((value) => value.id !== header.id),
                  }),
              ),
              destructive: true,
            },
          ]),
        ),
      ]),
    );
  } else {
    const usage = draft.usage;
    const credential = (
      id: string,
      label: string,
      field: "apiKey" | "accessToken" | "secretAccessKey",
      configured?: boolean,
    ) => ({
      ...c.input(id, label, usage[field], (value) => patchUsage({ [field]: value }), true),
      text: configured
        ? t("settings.usage.secretSaved")
        : field === "apiKey"
          ? t("settings.usage.providerCredential")
          : "",
    });
    nodes.push(
      c.group("provider-usage", t("settings.usage.title"), [
        {
          ...c.toggle(
            "provider-usage-enabled",
            t("settings.usage.title"),
            usage.enabled,
            (enabled) => patchUsage({ enabled }),
          ),
          text: t("settings.usage.desc"),
        },
        c.select(
          "provider-usage-mode",
          t("settings.usage.mode"),
          usage.mode,
          (["coding-plan", "balance", "general", "newapi", "custom"] as UsageQueryMode[]).map(
            (value) => ({ value, label: t(`settings.usage.mode.${value}`) }),
          ),
          (value) =>
            patch({ usage: switchUsageQueryMode(latest.current.usage, value as UsageQueryMode) }),
        ),
        c.number(
          "provider-usage-timeout",
          t("settings.usage.timeout"),
          usage.timeoutSecs ?? 10,
          2,
          30,
          1,
          (timeoutSecs) => patchUsage({ timeoutSecs }),
          true,
          Math.round,
        ),
        {
          ...c.input("provider-usage-url", t("settings.usage.baseUrl"), usage.baseUrl, (baseUrl) =>
            patchUsage({ baseUrl }),
          ),
          text: provider.baseUrl,
        },
        credential("provider-usage-key", "API Key", "apiKey", usage.apiKeyConfigured),
        ...(usage.mode === "newapi"
          ? [
              credential(
                "provider-usage-access-token",
                "Access Token",
                "accessToken",
                usage.accessTokenConfigured,
              ),
              c.input("provider-usage-user-id", "User ID", usage.userId, (userId) =>
                patchUsage({ userId }),
              ),
            ]
          : []),
        ...(usage.mode === "coding-plan"
          ? [
              {
                ...c.input(
                  "provider-usage-plan-provider",
                  "Plan Provider",
                  usage.codingPlanProvider,
                  (codingPlanProvider) => patchUsage({ codingPlanProvider }),
                ),
                text: "auto / zhipu_team / zenmux",
              },
              c.input(
                "provider-usage-organization",
                "Organization ID",
                usage.teamOrganizationId,
                (teamOrganizationId) => patchUsage({ teamOrganizationId }),
              ),
              c.input(
                "provider-usage-project",
                "Project ID",
                usage.teamProjectId,
                (teamProjectId) => patchUsage({ teamProjectId }),
              ),
              c.input(
                "provider-usage-access-key-id",
                "Access Key ID",
                usage.accessKeyId,
                (accessKeyId) => patchUsage({ accessKeyId }),
              ),
              credential(
                "provider-usage-secret-access-key",
                "Secret Access Key",
                "secretAccessKey",
                usage.secretAccessKeyConfigured,
              ),
            ]
          : []),
        ...(["general", "newapi", "custom"].includes(usage.mode)
          ? [
              {
                ...c.input(
                  "provider-usage-script",
                  t("settings.usage.script"),
                  usage.script,
                  (script) => patchUsage({ script }),
                ),
                kind: "TextArea" as const,
                language: "javascript",
                minHeight: 240,
              },
              {
                id: "provider-usage-script-hint",
                kind: "Text" as const,
                secondary: true,
                text: t(
                  usage.mode === "custom"
                    ? "settings.usage.scriptRequired"
                    : "settings.usage.scriptPreset",
                ),
              },
            ]
          : []),
        c.action(
          "provider-usage-test",
          t("settings.usage.test"),
          testUsage,
          !testState.loading && props.canTestUsage !== false,
        ),
        ...(props.canTestUsage === false
          ? [
              {
                id: "provider-usage-save-first",
                kind: "Text" as const,
                secondary: true,
                text: t("settings.usage.saveBeforeTest"),
              },
            ]
          : []),
        ...(testState.loading
          ? [
              {
                id: "provider-usage-loading",
                kind: "Progress" as const,
                label: t("settings.usage.test"),
              },
            ]
          : []),
        ...(testState.error
          ? [
              {
                id: "provider-usage-error",
                kind: "Banner" as const,
                status: "error" as const,
                label: testState.error,
              },
            ]
          : testState.result
            ? [
                {
                  id: "provider-usage-success",
                  kind: "Banner" as const,
                  status: "completed" as const,
                  label: t("settings.usage.testSuccess").replace(
                    "{count}",
                    String(testState.result.data.length),
                  ),
                },
              ]
            : []),
      ]),
    );
  }
  if (error)
    nodes.push({ id: "provider-request-error", kind: "Banner", status: "error", label: error });
  if (provider) nodes.push(c.action("provider-request-save", t("settings.save"), save));
  const mobile = isNativeMobileRuntime();
  return (
    <NativeSurface
      sessionSurface={props.nativeSettingsSurfaceId}
      document={{
        mode: "sheet",
        title: provider?.name ?? t("settings.providers"),
        appearance: settings.theme,
        formFactor: mobile ? "mobile" : "desktop",
        theme: createNativePresentationTheme(settings, mobile),
        dismissAction: "provider-request-back",
        nodes: mobile ? nodes.map(withNativeSettingsIcons) : nodes,
      }}
      handlers={c.handlers}
      onError={(cause) => {
        if (current()) setError(cause instanceof Error ? cause.message : String(cause));
      }}
    />
  );
}
