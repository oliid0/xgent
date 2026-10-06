import { useEffect, useState } from "react";
import { type ProviderUsageResult, queryProviderUsage } from "../lib/providers/usageQuery";
import { type CustomProvider, type ProviderId, updateCustomProviders } from "../lib/settings";
import { providerListDetails } from "../pages/settings/providerListDetails";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

const vendors: { value: ProviderId; label: string }[] = [
  { value: "claude_code", label: "Anthropic" },
  { value: "codex", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "xai", label: "Grok" },
  { value: "deepseek", label: "DeepSeek" },
];
const vendorIcons: Record<ProviderId, string> = {
  claude_code: "sun.max",
  codex: "cpu",
  gemini: "sparkles",
  xai: "bolt",
  deepseek: "arrow.triangle.branch",
};
type Usage = {
  configuration: string;
  loading: boolean;
  request: number;
  result: ProviderUsageResult | null;
};
const usageConfiguration = (provider: CustomProvider) =>
  JSON.stringify([
    provider.type,
    provider.baseUrl,
    provider.apiKey,
    provider.authMode,
    provider.oauthAccountId,
    provider.customHeaders,
    provider.useSystemProxy,
    provider.usageQuery,
  ]);

/** The native list has the same vendor buckets, persisted order and usage service as desktop. */
export function useNativeProviderList(
  props: SettingsSectionProps,
  enabled: boolean,
  onEdit: (id: string) => void,
  t: (key: string) => string,
) {
  const [type, setType] = useState<ProviderId>("claude_code");
  const [scope] = useState(() => ({
    active: enabled,
    revision: 0,
    page: 0,
    settings: props.settings,
    type,
    usage: new Map<string, Usage>(),
    pendingDelete: "",
    deleteVersion: 0,
    error: "",
  }));
  const [, publish] = useState(0);
  scope.settings = props.settings;
  scope.type = type;
  if (scope.active !== enabled) {
    scope.active = enabled;
    scope.revision++;
    scope.pendingDelete = "";
    scope.error = "";
  }
  for (const provider of props.settings.customProviders) {
    const configuration = usageConfiguration(provider);
    if (scope.usage.get(provider.id)?.configuration !== configuration) {
      scope.usage.set(provider.id, { configuration, loading: false, request: 0, result: null });
    }
  }
  for (const id of scope.usage.keys()) {
    if (!props.settings.customProviders.some((provider) => provider.id === id))
      scope.usage.delete(id);
  }
  const revision = scope.revision;
  const current = () => scope.active && scope.revision === revision;
  const page = scope.page;
  const deleteVersion = scope.deleteVersion;
  const currentList = () => current() && scope.type === type && scope.page === page;
  const c = presentationControls();
  const repaint = () => publish((value) => value + 1);
  const notice = (cause: unknown) => {
    if (current()) {
      scope.error = cause instanceof Error ? cause.message : String(cause);
      repaint();
    }
  };
  const loadUsage = async (id: string, refresh: boolean) => {
    const provider = scope.settings.customProviders.find((item) => item.id === id);
    const state = scope.usage.get(id);
    if (!current() || !provider?.usageQuery?.enabled || !state || state.loading) return;
    state.loading = true;
    const request = ++state.request;
    const owns = () => current() && scope.usage.get(id) === state && state.request === request;
    repaint();
    try {
      const result = await queryProviderUsage(id, refresh);
      if (owns()) state.result = result;
    } catch (cause) {
      if (owns())
        state.result = {
          data: [],
          isStale: false,
          error: cause instanceof Error ? cause.message : String(cause),
        };
    } finally {
      if (owns()) {
        state.loading = false;
        repaint();
      }
    }
  };
  const enabledQueries = props.settings.customProviders
    .filter((provider) => provider.usageQuery?.enabled)
    .map((provider) => provider.id + ":" + usageConfiguration(provider))
    .join("\n");
  useEffect(() => {
    scope.active = enabled;
    if (enabled) {
      for (const provider of scope.settings.customProviders)
        if (provider.usageQuery?.enabled) void loadUsage(provider.id, false);
      repaint();
    }
    return () => {
      scope.active = false;
      scope.revision++;
      for (const state of scope.usage.values()) {
        state.request++;
        state.loading = false;
      }
    };
  }, [enabled]);
  useEffect(() => {
    if (enabled)
      for (const provider of scope.settings.customProviders)
        if (provider.usageQuery?.enabled && !scope.usage.get(provider.id)?.result)
          void loadUsage(provider.id, false);
  }, [enabledQueries, enabled, revision]);
  const reorder = (ids: string[]) => {
    if (!currentList()) return;
    props.setSettings((previous) => {
      const byId = new Map(
        previous.customProviders
          .filter((provider) => provider.type === type)
          .map((provider) => [provider.id, provider]),
      );
      const ordered = ids
        .map((id) => byId.get(id))
        .filter((provider): provider is CustomProvider => !!provider);
      for (const provider of byId.values()) if (!ids.includes(provider.id)) ordered.push(provider);
      let index = 0;
      return updateCustomProviders(
        previous,
        previous.customProviders.map((provider) =>
          provider.type === type ? (ordered[index++] ?? provider) : provider,
        ),
      );
    });
  };
  const filtered = props.settings.customProviders.filter((provider) => provider.type === type);
  const ids = filtered.map((provider) => provider.id);
  const parseOrder = (value: unknown) => {
    if (typeof value !== "string") return null;
    try {
      const next: unknown = JSON.parse(value);
      return Array.isArray(next) &&
        next.length === ids.length &&
        new Set(next).size === ids.length &&
        next.every((id) => typeof id === "string" && ids.includes(id))
        ? (next as string[])
        : null;
    } catch {
      return null;
    }
  };
  c.handlers.set("provider-reorder", {
    enabled: enabled && ids.length > 1,
    accepts: (value) => parseOrder(value) !== null,
    run: (value) => {
      const next = parseOrder(value);
      if (next && currentList()) reorder(next);
    },
  });
  const move = (id: string, delta: number) => {
    const order = scope.settings.customProviders
      .filter((provider) => provider.type === type)
      .map((provider) => provider.id);
    const from = order.indexOf(id),
      to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    reorder(order);
  };
  const action = (id: string, label: string, run: () => unknown, allowed = true) =>
    c.action(
      id,
      label,
      () => {
        if (currentList()) return run();
      },
      allowed,
    );
  if (!enabled) return { type, nodes: [], handlers: c.handlers };
  const nodes: PresentationNode[] = [
    {
      ...c.select("provider-vendor", t("settings.navProviders"), type, vendors, (value) => {
        if (current()) {
          scope.type = value as ProviderId;
          scope.page++;
          scope.pendingDelete = "";
          setType(value as ProviderId);
        }
      }),
      variant: "provider-vendor-tabs",
      children: vendors.map(({ value, label }) => ({
        id: `provider-vendor-state:${value}`,
        kind: "Text",
        value,
        label,
        icon: vendorIcons[value],
      })),
    },
    ...(filtered.length
      ? [
          {
            id: "provider-list",
            kind: "ProviderList" as const,
            value: JSON.stringify(ids),
            action: "provider-reorder",
            disabled: false,
            label: t("settings.reorderProvider"),
            children: filtered.map((provider, index): PresentationNode => {
              const usage = scope.usage.get(provider.id);
              const result = usage?.result;
              const details = providerListDetails(provider, result, t);
              return {
                id: "provider-list-row:" + provider.id,
                kind: "VStack",
                variant: "provider-list-row",
                value: provider.id,
                children: [
                  {
                    ...action("provider:" + provider.id, provider.name, () => onEdit(provider.id)),
                    kind: "NavigationRow",
                    icon: vendorIcons[provider.type],
                    text: details.connection,
                  },
                  {
                    id: "provider-list-actions:" + provider.id,
                    kind: "Menu",
                    variant: "compact",
                    label: `${t("settings.reorderProvider")}: ${provider.name}`,
                    icon: "line.3.horizontal",
                    size: "large",
                    disabled: filtered.length < 2,
                    children: [
                      action(
                        "provider-up:" + provider.id,
                        t("settings.failover.moveUp"),
                        () => move(provider.id, -1),
                        index > 0,
                      ),
                      action(
                        "provider-down:" + provider.id,
                        t("settings.failover.moveDown"),
                        () => move(provider.id, 1),
                        index + 1 < filtered.length,
                      ),
                    ],
                  },
                  ...(provider.usageQuery?.enabled
                    ? [
                        {
                          ...action(
                            "provider-usage-refresh:" + provider.id,
                            t("settings.usage.refresh"),
                            () => loadUsage(provider.id, true),
                            !usage?.loading,
                          ),
                          kind: "IconButton" as const,
                          variant: "ghost",
                          icon: "arrow.clockwise",
                          size: "large" as const,
                        },
                      ]
                    : []),
                  {
                    ...action("provider-edit:" + provider.id, t("settings.edit"), () =>
                      onEdit(provider.id),
                    ),
                    kind: "IconButton",
                    variant: "ghost",
                    icon: "pencil",
                    size: "large",
                  },
                  {
                    ...action("provider-list-delete:" + provider.id, t("settings.delete"), () => {
                      scope.deleteVersion++;
                      scope.pendingDelete = provider.id;
                      repaint();
                    }),
                    kind: "IconButton",
                    variant: "ghost",
                    icon: "trash",
                    size: "large",
                  },
                  ...(details.usage
                    ? [
                        {
                          id: "provider-list-usage:" + provider.id,
                          kind: "Text" as const,
                          text: details.usage,
                          secondary: true,
                        },
                      ]
                    : []),
                  ...(usage?.loading
                    ? [
                        {
                          id: "provider-list-loading:" + provider.id,
                          kind: "Progress" as const,
                          label: t("settings.usage.refresh"),
                        },
                      ]
                    : []),
                  ...(result?.isStale
                    ? [
                        {
                          id: "provider-list-stale:" + provider.id,
                          kind: "Badge" as const,
                          label: t("settings.usage.refresh"),
                          status: "paused" as const,
                        },
                      ]
                    : []),
                  ...(provider.useSystemProxy
                    ? [
                        {
                          id: "provider-list-proxy:" + provider.id,
                          kind: "Badge" as const,
                          label: t("settings.providerUseSystemProxy"),
                          icon: "arrow.triangle.branch",
                        },
                      ]
                    : []),
                ],
              };
            }),
          },
        ]
      : [
          {
            id: "providers-empty",
            kind: "EmptyState" as const,
            label: t("settings.noProvidersHint"),
            text: t("settings.noProvidersAdd"),
          },
        ]),
    ...(scope.pendingDelete
      ? [
          {
            id: "provider-list-delete-confirmation",
            kind: "Banner" as const,
            status: "paused" as const,
            label: t("settings.delete"),
            text: props.settings.customProviders.find(
              (provider) => provider.id === scope.pendingDelete,
            )?.name,
            children: [
              {
                ...action("provider-list-delete-confirm", t("settings.delete"), () => {
                  if (scope.deleteVersion !== deleteVersion || !scope.pendingDelete) return;
                  const id = scope.pendingDelete;
                  try {
                    props.setSettings((previous) =>
                      updateCustomProviders(
                        previous,
                        previous.customProviders.filter((provider) => provider.id !== id),
                      ),
                    );
                    scope.pendingDelete = "";
                    scope.deleteVersion++;
                    scope.error = "";
                    repaint();
                  } catch (cause) {
                    notice(cause);
                  }
                }),
                destructive: true,
              },
              action("provider-list-delete-cancel", t("settings.cancel"), () => {
                if (scope.deleteVersion !== deleteVersion) return;
                scope.pendingDelete = "";
                scope.deleteVersion++;
                repaint();
              }),
            ],
          },
        ]
      : []),
    ...(scope.error
      ? [
          {
            id: "provider-list-error",
            kind: "Banner" as const,
            status: "error" as const,
            label: scope.error,
          },
        ]
      : []),
  ];
  return { type, nodes, handlers: c.handlers };
}
