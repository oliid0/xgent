import { useEffect, useState } from "react";
import { moveModelOrder } from "../lib/providers/modelVendor";
import { type CustomProvider, updateCustomProviders } from "../lib/settings";
import {
  createDraftModelConfig,
  fetchModelsFromApi,
  mergeFetchedModels,
  sortModelsBySelection,
} from "../pages/settings/providerUtils";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

type ModelListState = {
  query: string;
  draft: string;
  bulk: boolean;
  selection: Set<string>;
};
const emptyState = (): ModelListState => ({
  query: "",
  draft: "",
  bulk: false,
  selection: new Set(),
});
const tokenCount = (value: number) =>
  value < 1_000 ? String(value) : `${Math.round(value / 1_000)}K`;

/** The provider editor's model operations, with native controls and the shared model rules. */
export function useNativeProviderModels(
  { setSettings }: SettingsSectionProps,
  provider: CustomProvider | undefined,
  enabled: boolean,
  busy: boolean,
  work: (run: () => Promise<unknown>) => Promise<unknown>,
  onEdit: (id: string) => void,
  t: (key: string) => string,
) {
  const key = provider?.id ?? "";
  const configuration = JSON.stringify(
    provider
      ? [
          provider.type,
          provider.baseUrl,
          provider.modelsUrl,
          provider.apiKey,
          provider.authMode,
          provider.oauthAccountId,
          provider.customHeaders,
          provider.useSystemProxy,
          provider.isFullUrl,
        ]
      : null,
  );
  const [scope] = useState(() => ({
    key,
    configuration,
    enabled,
    revision: 0,
    mounted: true,
    fetching: false,
    ui: emptyState(),
  }));
  const [, publish] = useState(0);
  if (scope.key !== key) {
    scope.key = key;
    scope.revision++;
    scope.fetching = false;
    scope.ui = emptyState();
  }
  if (scope.enabled !== enabled) {
    scope.enabled = enabled;
    scope.revision++;
    scope.fetching = false;
  }
  if (scope.configuration !== configuration) {
    scope.configuration = configuration;
    scope.revision++;
    scope.fetching = false;
  }
  const revision = scope.revision;
  const current = () =>
    scope.mounted && scope.enabled && !!key && scope.key === key && scope.revision === revision;
  useEffect(() => {
    scope.mounted = true;
    publish((value) => value + 1);
    return () => {
      scope.mounted = false;
      scope.revision++;
    };
  }, [scope]);
  const c = presentationControls();
  const change = (patch: Partial<ModelListState>) => {
    if (!current()) return;
    scope.ui = { ...scope.ui, ...patch };
    publish((value) => value + 1);
  };
  const update = (run: (item: CustomProvider) => CustomProvider) => {
    if (!current() || busy) return;
    setSettings((previous) =>
      updateCustomProviders(
        previous,
        previous.customProviders.map((item) => (item.id === key ? run(item) : item)),
      ),
    );
  };
  if (!provider || !enabled) return { nodes: [], handlers: c.handlers, fetch: undefined };
  const ui = scope.ui;
  const visible = (item: CustomProvider) => {
    const query = scope.ui.query.trim().toLowerCase();
    return sortModelsBySelection(item.models, new Set(item.activeModels), item.modelOrder).filter(
      (model) => !query || model.id.toLowerCase().includes(query),
    );
  };
  const visibleModels = visible(provider);
  const selection = new Set(
    [...ui.selection].filter((id) => provider.models.some((model) => model.id === id)),
  );
  const toEnable = [...selection].filter((id) => !provider.activeModels.includes(id));
  const toDisable = [...selection].filter((id) => provider.activeModels.includes(id));
  const allVisibleSelected =
    visibleModels.length > 0 && visibleModels.every((model) => selection.has(model.id));
  const credential =
    provider.authMode === "oauth-managed"
      ? provider.oauthAccountId?.trim()
      : provider.apiKey.trim();
  const canFetch = !!(provider.baseUrl.trim() || provider.modelsUrl?.trim()) && !!credential;
  const setBulk = (enabledModels: boolean) => {
    // The selection may have changed since the last document was published.
    const selected = new Set(scope.ui.selection);
    update((item) => ({
      ...item,
      activeModels: enabledModels
        ? [
            ...new Set([
              ...item.activeModels,
              ...item.models.filter((model) => selected.has(model.id)).map((model) => model.id),
            ]),
          ]
        : item.activeModels.filter((id) => !selected.has(id)),
    }));
  };
  const fetch = c.action(
    "fetch-models",
    t("settings.refreshModels"),
    async () => {
      if (!current() || scope.fetching || busy || !canFetch) return;
      scope.fetching = true;
      publish((value) => value + 1);
      try {
        await work(async () => {
          const fetched = await fetchModelsFromApi(
            provider.type,
            provider.baseUrl,
            provider.authMode === "oauth-managed" ? "" : provider.apiKey.trim(),
            { ...provider, providerConfigId: key },
          ).catch((cause) => {
            if (current()) throw cause;
            return [];
          });
          if (!current()) return;
          // Fetching the catalogue must preserve the user's enabled models, just as
          // ProviderEditor.doFetch does on Windows/Linux and Android.
          setSettings((previous) =>
            updateCustomProviders(
              previous,
              previous.customProviders.map((item) =>
                item.id === key
                  ? { ...item, models: mergeFetchedModels(fetched, item.models) }
                  : item,
              ),
            ),
          );
        });
      } finally {
        if (current()) {
          scope.fetching = false;
          publish((value) => value + 1);
        }
      }
    },
    !busy && !scope.fetching && canFetch,
  );
  const controls: PresentationNode[] = [
    c.input("model-search", t("settings.searchModels"), ui.query, (value) =>
      change({ query: value }),
    ),
    ...(ui.query
      ? [
          c.action("model-search-clear", t("settings.clearModelSearch"), () =>
            change({ query: "" }),
          ),
        ]
      : []),
    c.action(
      "model-bulk-mode",
      t(ui.bulk ? "settings.skillsBulkDone" : "settings.skillsBulkSelect"),
      () => change({ bulk: !scope.ui.bulk, selection: new Set() }),
      !busy,
    ),
    ...(provider.modelOrder
      ? [
          c.action(
            "model-order-reset",
            t("settings.resetModelOrder"),
            () => update((item) => ({ ...item, modelOrder: undefined })),
            !busy,
          ),
        ]
      : []),
    ...(ui.bulk
      ? [
          {
            ...c.action(
              "model-select-all",
              t("settings.skillsBulkSelectAll"),
              () => {
                const models = visible(provider);
                const all =
                  models.length > 0 && models.every((model) => scope.ui.selection.has(model.id));
                change({ selection: all ? new Set() : new Set(models.map((model) => model.id)) });
              },
              !busy && visibleModels.length > 0,
            ),
            selected: allVisibleSelected,
            icon: allVisibleSelected ? "checkmark.square.fill" : "square",
          },
          {
            id: "model-selection-count",
            kind: "Text" as const,
            text: t("settings.skillsBulkSelectedCount").replace("{count}", String(selection.size)),
            secondary: true,
          },
          c.action(
            "model-bulk-enable",
            `${t("settings.skillsBulkEnable")} (${toEnable.length})`,
            () => setBulk(true),
            !busy && toEnable.length > 0,
          ),
          c.action(
            "model-bulk-disable",
            `${t("settings.skillsBulkDisable")} (${toDisable.length})`,
            () => setBulk(false),
            !busy && toDisable.length > 0,
          ),
        ]
      : []),
  ];
  const rows: PresentationNode[] = visibleModels.map((model, index) => {
    const id = `${key}:${model.id}`;
    const enabledControl = ui.bulk
      ? {
          ...c.action(
            `model-select:${id}`,
            model.id,
            () => {
              const next = new Set(scope.ui.selection);
              if (next.has(model.id)) next.delete(model.id);
              else next.add(model.id);
              change({ selection: next });
            },
            !busy,
          ),
          selected: selection.has(model.id),
          icon: selection.has(model.id) ? "checkmark.square.fill" : "square",
          variant: "model-selection",
        }
      : c.toggle(
          `model:${id}`,
          model.id,
          provider.activeModels.includes(model.id),
          (active) =>
            update((item) => ({
              ...item,
              activeModels: active
                ? [...new Set([...item.activeModels, model.id])]
                : item.activeModels.filter((value) => value !== model.id),
            })),
          !busy,
        );
    const row: PresentationNode = {
      id: `model-row:${id}`,
      kind: "VStack",
      variant: "provider-model-row",
      children: [
        enabledControl,
        {
          id: `model-limits:${id}`,
          kind: "Text",
          secondary: true,
          size: "small",
          text: `${tokenCount(model.contextWindow)} ctx · ${tokenCount(model.maxOutputToken)} out`,
          accessibilityLabel: `${t("settings.contextWindow")}: ${model.contextWindow}. ${t("settings.maxOutputToken")}: ${model.maxOutputToken}`,
        },
        {
          id: `model-actions:${id}`,
          kind: "Menu",
          label: t("settings.modelSettings"),
          icon: "ellipsis",
          variant: "compact",
          children: [
            ...([-1, 1] as const).map((offset) =>
              c.action(
                `model-move-${offset < 0 ? "up" : "down"}:${id}`,
                t(offset < 0 ? "settings.failover.moveUp" : "settings.failover.moveDown"),
                () => {
                  if (scope.ui.query.trim() || scope.ui.bulk) return;
                  update((item) => {
                    const modelOrder = moveModelOrder(
                      item.models,
                      item.modelOrder,
                      new Set(item.activeModels),
                      model.id,
                      offset,
                    );
                    return modelOrder ? { ...item, modelOrder } : item;
                  });
                },
                !busy &&
                  !ui.query.trim() &&
                  !ui.bulk &&
                  (offset < 0 ? index > 0 : index + 1 < visibleModels.length),
              ),
            ),
            c.action(
              `model-edit:${id}`,
              `${t("settings.modelSettings")} · ${model.id}`,
              () => {
                if (current() && !busy) onEdit(model.id);
              },
              !busy,
            ),
            {
              ...c.action(
                `model-delete:${id}`,
                t("settings.delete"),
                () => {
                  update((item) => ({
                    ...item,
                    models: item.models.filter((value) => value.id !== model.id),
                    activeModels: item.activeModels.filter((value) => value !== model.id),
                  }));
                  change({
                    selection: new Set(
                      [...scope.ui.selection].filter((value) => value !== model.id),
                    ),
                  });
                },
                !busy,
              ),
              destructive: true,
            },
          ],
        },
      ],
    };
    const actions = row.children?.find((child) => child.id === `model-actions:${id}`);
    if (actions) {
      const children = actions.children ?? [];
      row.children = [
        ...(row.children ?? []),
        {
          id: `model-reorder:${id}`,
          kind: "Menu",
          label: `${t("settings.reorderModel")}: ${model.id}`,
          icon: "line.3.horizontal",
          variant: "compact",
          size: "large",
          disabled: busy || !!ui.query.trim() || ui.bulk,
          children: children.filter((child) => child.id.startsWith("model-move-")),
        },
      ];
      actions.children = children.filter((child) => !child.id.startsWith("model-move-"));
      actions.size = "large";
    }
    return row;
  });
  const add = () => {
    const id = scope.ui.draft.trim();
    if (!current() || busy || !id) return;
    setSettings((previous) => {
      const updated = updateCustomProviders(
        previous,
        previous.customProviders.map((item) =>
          item.id === key
            ? {
                ...item,
                models: item.models.some((model) => model.id === id)
                  ? item.models
                  : [...item.models, createDraftModelConfig(item.type, id)],
                activeModels: [...new Set([...item.activeModels, id])],
              }
            : item,
        ),
      );
      return updated.selectedModel
        ? updated
        : { ...updated, selectedModel: { customProviderId: key, model: id } };
    });
    change({ draft: "" });
  };
  const nodes = [
    c.group("model-list-controls", t("settings.models"), controls),
    c.group(
      "models",
      "",
      rows.length
        ? rows
        : [
            {
              id: "models-empty",
              kind: "EmptyState",
              label: t(ui.query.trim() ? "settings.noMatchingModels" : "settings.fetchHint"),
            },
          ],
    ),
    c.group("manual-model", t("settings.manualAddModel"), [
      c.input(
        "model-id",
        t("settings.modelName"),
        ui.draft,
        (value) => change({ draft: value }),
        false,
        !busy,
      ),
      c.action("add-model", t("settings.add"), add, !busy && !!ui.draft.trim()),
    ]),
  ];
  return { nodes, handlers: c.handlers, fetch };
}
