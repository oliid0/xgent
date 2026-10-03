import { invoke } from "@xgent/runtime";
import { useEffect, useState } from "react";
import { type ProviderId, updateCustomProviders } from "../lib/settings";
import type {
  CherryProviderImportItem,
  CherryProvidersResponse,
} from "../pages/settings/CherryStudioImportModal";
import {
  buildCcsImportedProviders,
  type CcsProviderImportItem,
  type CcsProvidersResponse,
  ccsImportIdentity,
  ccsItemKey,
  ccsProviderIsTransferable,
  cherryProviderId,
  providerFromCherry,
  syncCcsImportModels,
  syncCherryImportModels,
} from "../pages/settings/providerImports";
import type { SettingsSectionProps } from "../pages/settings/types";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

type Source = "ccs" | "cherry";
const pathKey = "xgent.cherryStudioDataPath";
const vendors: { value: ProviderId; label: string }[] = [
  { value: "claude_code", label: "Anthropic" },
  { value: "codex", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "xai", label: "Grok" },
  { value: "deepseek", label: "DeepSeek" },
];
const cherryKey = (item: CherryProviderImportItem) =>
  item.sourceId + "\n" + item.baseUrl + "\n" + item.requestFormat;
function storedPath() {
  try {
    return localStorage.getItem(pathKey);
  } catch {
    return null;
  }
}
function rememberPath(path: string | null) {
  try {
    if (path) localStorage.setItem(pathKey, path);
    else localStorage.removeItem(pathKey);
  } catch {
    /* The current session can still use the selected directory. */
  }
}
type ImportRow = {
  key: string;
  type: ProviderId;
  name: string;
  url: string;
  protocol: string;
  selectable: boolean;
  enabled: boolean;
  exists: boolean;
  status: string;
  warning?: string;
  ccs?: CcsProviderImportItem;
  cherry?: CherryProviderImportItem;
};

/** Desktop-only discovery uses the same Rust commands and import rules as the Astryx desktop editor. */
export function useNativeProviderImports(
  props: SettingsSectionProps,
  enabled: boolean,
  initialType: ProviderId,
  t: (key: string) => string,
) {
  const [scope] = useState(() => ({
    active: enabled,
    revision: 0,
    page: 0,
    scan: 0,
    scanning: false,
    importing: false,
    source: null as Source | null,
    type: initialType,
    showAll: false,
    path: storedPath(),
    ccs: null as CcsProvidersResponse | null,
    cherry: null as CherryProvidersResponse | null,
    ccsMessage: "",
    cherryMessage: "",
    selection: new Set<string>(),
    message: "",
    error: "",
  }));
  const [, publish] = useState(0);
  const refreshView = () => publish((value) => value + 1);
  const settingsRef = useState(() => ({ current: props.settings }))[0];
  settingsRef.current = props.settings;
  if (scope.active !== enabled) {
    scope.active = enabled;
    scope.revision++;
    scope.scan++;
    scope.scanning = false;
    scope.importing = false;
    scope.source = null;
    scope.error = "";
  }
  const revision = scope.revision;
  const current = () => scope.active && scope.revision === revision;
  const page = scope.page;
  const currentPage = () => current() && scope.page === page;
  useEffect(() => {
    scope.active = enabled;
    refreshView();
    return () => {
      scope.active = false;
      scope.revision++;
      scope.scan++;
    };
  }, [enabled]);
  const c = presentationControls();
  const action = (
    id: string,
    label: string,
    run: () => unknown,
    allowed = true,
  ): PresentationNode =>
    c.action(
      id,
      label,
      () => {
        if (currentPage()) return run();
      },
      allowed,
    );
  const notice = (cause: unknown) => {
    if (!current()) return;
    scope.error = cause instanceof Error ? cause.message : String(cause);
    refreshView();
  };
  const close = () => {
    if (!currentPage()) return;
    scope.revision++;
    scope.page++;
    scope.scan++;
    scope.scanning = false;
    scope.importing = false;
    scope.source = null;
    scope.selection = new Set();
    scope.error = "";
    refreshView();
  };
  const rows = (): ImportRow[] => {
    if (scope.source === "ccs")
      return (scope.ccs?.providers ?? []).map((item) => {
        const exists = settingsRef.current.customProviders.some(
          (provider) =>
            ccsImportIdentity(provider) ===
            ccsImportIdentity({ type: item.providerType, name: item.name, baseUrl: item.baseUrl }),
        );
        const transferable = ccsProviderIsTransferable(item);
        return {
          key: ccsItemKey(item),
          type: item.providerType,
          name: item.name,
          url: item.baseUrl,
          protocol:
            item.providerType === "claude_code"
              ? "Anthropic Messages"
              : item.providerType === "gemini"
                ? "Gemini Generate Content"
                : item.requestFormat === "openai-completions"
                  ? "Chat Completions"
                  : "Responses API",
          selectable: transferable && !exists,
          enabled: true,
          exists,
          ccs: item,
          status: exists ? "已导入" : transferable ? "可导入" : "没有可迁移的 API 配置",
        };
      });
    return (scope.cherry?.providers ?? []).map((item) => {
      const exists = settingsRef.current.customProviders.some(
        (provider) => provider.id === cherryProviderId(item),
      );
      return {
        key: cherryKey(item),
        type: item.providerType,
        name: item.name,
        url: item.baseUrl,
        protocol:
          item.providerType === "claude_code"
            ? "Anthropic Messages"
            : item.providerType === "gemini"
              ? "Gemini Generate Content"
              : item.requestFormat === "openai-completions"
                ? "Chat Completions"
                : "Responses API",
        selectable: item.importable,
        enabled: item.enabled,
        exists,
        cherry: item,
        status: !item.importable
          ? item.reason || "配置不可导入"
          : exists
            ? "将更新现有配置"
            : item.enabled
              ? "可以同步"
              : "Cherry Studio 中已禁用",
        warning: [
          item.warning,
          item.excludedModelCount > 0 ? "已排除 " + item.excludedModelCount + " 个非聊天模型" : "",
          item.apiKeyCount > 0 ? item.apiKeyCount + " 个密钥" : "无可迁移密钥",
        ]
          .filter(Boolean)
          .join(" · "),
      };
    });
  };
  const resetSelection = () => {
    const available = rows();
    scope.selection = new Set(
      available
        .filter((row) => row.selectable && (scope.source === "ccs" || row.enabled))
        .map((row) => row.key),
    );
    scope.showAll =
      scope.source === "cherry" && !available.some((row) => row.selectable && row.enabled);
  };
  const scan = async (source?: Source, path = scope.path, choose = false) => {
    if (!current() || scope.scanning || scope.importing) return;
    const request = ++scope.scan;
    const owns = () => current() && request === scope.scan;
    scope.scanning = true;
    scope.error = "";
    refreshView();
    try {
      if (choose) {
        const selected = await invoke<string | null>("system_pick_folder", {
          initial_workdir: path || scope.cherry?.dataPath || undefined,
        });
        if (!owns() || !selected) return;
        path = selected;
      }
      const tasks = source ? [source] : (["ccs", "cherry"] as Source[]);
      const results = await Promise.allSettled(
        tasks.map((kind) =>
          kind === "ccs"
            ? invoke<CcsProvidersResponse>("settings_list_ccswitch_providers")
            : path
              ? invoke<CherryProvidersResponse>("settings_list_cherry_studio_providers_from_path", {
                  dataPath: path,
                })
              : invoke<CherryProvidersResponse>("settings_list_cherry_studio_providers"),
        ),
      );
      if (!owns()) return;
      results.forEach((result, index) => {
        if (tasks[index] === "ccs") {
          scope.ccs = result.status === "fulfilled" ? (result.value as CcsProvidersResponse) : null;
          scope.ccsMessage =
            result.status === "fulfilled"
              ? result.value.message
              : result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
        } else {
          if (result.status === "fulfilled") {
            scope.cherry = result.value as CherryProvidersResponse;
            scope.path = choose ? scope.cherry.dataPath || path : path;
            rememberPath(scope.path);
          }
          scope.cherryMessage =
            result.status === "fulfilled"
              ? result.value.message
              : result.reason instanceof Error
                ? result.reason.message
                : String(result.reason);
        }
      });
      if (scope.source) resetSelection();
    } catch (cause) {
      if (owns()) notice(cause);
    } finally {
      if (owns()) {
        scope.scanning = false;
        refreshView();
      }
    }
  };
  const open = (source: Source) => {
    if (!current() || scope.importing) return;
    if (scope.scanning && scope.source !== source) {
      scope.scan++;
      scope.scanning = false;
    }
    scope.source = source;
    scope.page++;
    scope.type = initialType;
    scope.message = "";
    scope.error = "";
    resetSelection();
    refreshView();
    if (source === "ccs" ? !scope.ccs : !scope.cherry) void scan(source);
  };
  const importSelected = () => {
    if (!current() || scope.importing || scope.scanning || !scope.source) return;
    const selected = rows().filter((row) => row.selectable && scope.selection.has(row.key));
    if (!selected.length) return;
    const source = scope.source;
    scope.importing = true;
    scope.error = "";
    refreshView();
    try {
      const before = new Map(
        settingsRef.current.customProviders.map((provider) => [provider.id, provider]),
      );
      if (source === "ccs") {
        const items = selected.map((row) => row.ccs as CcsProviderImportItem);
        props.setSettings((previous) => {
          const imported = buildCcsImportedProviders(previous.customProviders, items);
          return imported.length
            ? updateCustomProviders(previous, [...previous.customProviders, ...imported])
            : previous;
        });
      } else {
        const items = selected.map((row) => row.cherry as CherryProviderImportItem);
        props.setSettings((previous) => {
          const providers = [...previous.customProviders];
          for (const item of items) {
            const index = providers.findIndex((provider) => provider.id === cherryProviderId(item));
            const next = providerFromCherry(
              item,
              scope.cherry?.providers ?? items,
              index >= 0 ? providers[index] : undefined,
            );
            if (index >= 0) providers[index] = next;
            else providers.push(next);
          }
          return updateCustomProviders(previous, providers);
        });
      }
      // Local persistence is the completion boundary. Keep the network work in
      // the shared service while the user continues using settings.
      const summary = "已导入 " + selected.length + " 个供应商配置";
      scope.message = summary + "，正在后台获取模型列表…";
      scope.selection = new Set();
      if (source === "cherry") {
        scope.source = null;
        scope.page++;
      }
      const background =
        source === "ccs"
          ? syncCcsImportModels(
              selected.map((row) => row.ccs as CcsProviderImportItem),
              props.setSettings,
            )
          : syncCherryImportModels(
              selected.map((row) => row.cherry as CherryProviderImportItem),
              before,
              props.setSettings,
            );
      void background
        .then((result) => {
          if (!current()) return;
          scope.message = [
            summary,
            result.totalModels > 0
              ? "已在后台获取并激活 " + result.totalModels + " 个模型"
              : "API 未返回可用模型",
            result.failedCount > 0
              ? result.failedCount + " 个供应商模型获取失败（配置已成功导入）"
              : "",
          ]
            .filter(Boolean)
            .join("，");
          refreshView();
        })
        .catch((cause) => {
          if (current()) notice(cause);
        });
    } catch (cause) {
      notice(cause);
    } finally {
      if (current()) {
        scope.importing = false;
        refreshView();
      }
    }
  };
  if (!enabled)
    return {
      opened: false,
      source: scope.source,
      listNodes: [],
      formNodes: [],
      handlers: c.handlers,
      close,
      notice,
    };
  const locked = scope.scanning || scope.importing;
  const listNodes = [
    ...(scope.error
      ? [
          {
            id: "provider-import-list-error",
            kind: "Banner" as const,
            label: scope.error,
            status: "error" as const,
          },
        ]
      : []),
    {
      id: "provider-import-menu",
      kind: "Menu" as const,
      label: t("settings.thirdPartySync"),
      children: [
        action(
          "provider-import-rescan",
          t("settings.refreshLocalProviderConfigs"),
          () => scan(),
          !locked,
        ),
        action("provider-import-ccs", "CC Switch", () => open("ccs"), !scope.importing),
        action("provider-import-cherry", "Cherry Studio", () => open("cherry"), !scope.importing),
      ],
    },
    ...(scope.message
      ? [
          {
            id: "provider-import-message",
            kind: "Banner" as const,
            label: scope.message,
            status: "completed" as const,
          },
        ]
      : []),
  ];
  const candidates = rows();
  const visible = candidates.filter(
    (row) => scope.source !== "cherry" || scope.showAll || (row.enabled && row.selectable),
  );
  const groups = vendors.filter((vendor) => visible.some((row) => row.type === vendor.value));
  const active = groups.some((group) => group.value === scope.type)
    ? scope.type
    : (groups[0]?.value ?? initialType);
  const activeRows = visible.filter((row) => row.type === active);
  const selectedCount = candidates.filter(
    (row) => row.selectable && scope.selection.has(row.key),
  ).length;
  const allSelected =
    activeRows.some((row) => row.selectable) &&
    activeRows.filter((row) => row.selectable).every((row) => scope.selection.has(row.key));
  const formNodes: PresentationNode[] = [
    action("provider-import-back", t("settings.native.back"), close),
    action(
      "provider-import-refresh",
      t("settings.refreshLocalProviderConfigs"),
      () => scan(scope.source ?? undefined),
      !locked,
    ),
    ...(scope.source === "cherry"
      ? [
          {
            id: "provider-import-directory",
            kind: "Text" as const,
            text: scope.path ?? scope.cherry?.dataPath ?? "未检测到数据目录",
            secondary: true,
          },
          action(
            "provider-import-choose-directory",
            "选择数据目录",
            () => scan("cherry", scope.path, true),
            !locked,
          ),
          ...(scope.path
            ? [
                action(
                  "provider-import-auto-directory",
                  "恢复自动检测",
                  () => scan("cherry", null),
                  !locked,
                ),
              ]
            : []),
          c.toggle(
            "provider-import-show-all",
            "显示全部供应商",
            scope.showAll,
            (value) => {
              if (currentPage()) {
                scope.showAll = value;
                refreshView();
              }
            },
            !locked,
          ),
        ]
      : []),
    ...(groups.length
      ? [
          c.select(
            "provider-import-vendor",
            t("settings.native.api"),
            active,
            groups,
            (value) => {
              if (currentPage()) {
                scope.type = value as ProviderId;
                refreshView();
              }
            },
            !scope.importing,
          ),
        ]
      : []),
    {
      id: "provider-import-selected-count",
      kind: "Text",
      text:
        "共已选 " +
        selectedCount +
        " / " +
        candidates.filter((row) => row.selectable).length +
        " 个可导入",
      secondary: true,
    },
    action(
      "provider-import-select-all",
      t(allSelected ? "settings.deselectAll" : "settings.selectAll"),
      () => {
        const keys = activeRows.filter((row) => row.selectable).map((row) => row.key);
        const all = keys.length > 0 && keys.every((key) => scope.selection.has(key));
        const next = new Set(scope.selection);
        keys.forEach((key) => {
          if (all) next.delete(key);
          else next.add(key);
        });
        scope.selection = next;
        refreshView();
      },
      !locked && activeRows.some((row) => row.selectable),
    ),
    c.group(
      "provider-import-candidates",
      scope.source === "ccs" ? "CC Switch" : "Cherry Studio",
      activeRows.length
        ? activeRows.map((row) => ({
            id: "provider-import-row:" + row.key,
            kind: "VStack",
            variant: "provider-import-row",
            children: [
              {
                ...action(
                  "provider-import-select:" + row.key,
                  row.name,
                  () => {
                    const next = new Set(scope.selection);
                    if (next.has(row.key)) next.delete(row.key);
                    else next.add(row.key);
                    scope.selection = next;
                    refreshView();
                  },
                  !locked && row.selectable,
                ),
                selected: scope.selection.has(row.key),
              },
              {
                id: "provider-import-url:" + row.key,
                kind: "Text",
                text: row.url || "未配置 Base URL",
                secondary: true,
              },
              {
                id: "provider-import-protocol:" + row.key,
                kind: "Text",
                text: row.protocol,
                secondary: true,
              },
              {
                id: "provider-import-status:" + row.key,
                kind: "Badge",
                label: row.status,
                status: row.selectable
                  ? row.enabled
                    ? "completed"
                    : "paused"
                  : row.exists
                    ? "completed"
                    : "error",
              },
              ...(row.warning
                ? [
                    {
                      id: "provider-import-warning:" + row.key,
                      kind: "Text" as const,
                      text: row.warning,
                      secondary: true,
                    },
                  ]
                : []),
            ],
          }))
        : [
            {
              id: "provider-import-empty",
              kind: "EmptyState",
              label:
                scope.source === "ccs"
                  ? "未发现可导入的 CC Switch 供应商"
                  : "未发现可同步的 Cherry Studio 供应商",
              text: scope.source === "ccs" ? scope.ccsMessage : scope.cherryMessage,
            },
          ],
    ),
    action("provider-import-confirm", "导入所选配置", importSelected, !locked && selectedCount > 0),
    ...(scope.scanning
      ? [
          {
            id: "provider-import-scanning",
            kind: "Progress" as const,
            label: t("settings.refreshLocalProviderConfigs"),
          },
        ]
      : []),
    ...(scope.message
      ? [
          {
            id: "provider-import-result",
            kind: "Banner" as const,
            label: scope.message,
            status: "completed" as const,
          },
        ]
      : []),
    ...(scope.error
      ? [
          {
            id: "provider-import-error",
            kind: "Banner" as const,
            label: scope.error,
            status: "error" as const,
          },
        ]
      : []),
  ];
  return {
    opened: !!scope.source,
    source: scope.source,
    listNodes,
    formNodes,
    handlers: c.handlers,
    close,
    notice,
  };
}
