import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Inline as AstryxInline, View as AstryxView } from "@xagent/ui/components/ui/view";
import { useMemo, useState } from "react";
import {
  Check,
  ClaudeIcon,
  FolderOpen,
  GeminiIcon,
  OpenaiChatgptIcon,
  RefreshCw,
  Settings,
} from "../../components/icons";
import { AdaptiveDialog } from "../../components/ui/adaptive-dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { CodexRequestFormat, ProviderId } from "../../lib/settings";
import { cn } from "../../lib/shared/utils";

export type CherryProviderImportItem = {
  sourceId: string;
  sourceVersion: string;
  sourceProviderType: string;
  providerType: ProviderId;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeyCount: number;
  requestFormat: CodexRequestFormat;
  enabled: boolean;
  importable: boolean;
  reason: string;
  warning: string;
  excludedModelCount: number;
};

export type CherryProvidersResponse = {
  status: string;
  message: string;
  version: string;
  dataPath: string;
  totalProviderCount: number;
  enabledProviderCount: number;
  providers: CherryProviderImportItem[];
};

type CherryStudioImportModalProps = {
  initialType: ProviderId;
  response: CherryProvidersResponse;
  importing: boolean;
  scanning: boolean;
  dataPath: string | null;
  isExisting: (item: CherryProviderImportItem) => boolean;
  onChooseDataDirectory: () => void;
  onResetDataDirectory: () => void;
  onClose: () => void;
  onConfirm: (items: CherryProviderImportItem[]) => void;
};

const PROVIDER_ORDER: ProviderId[] = ["claude_code", "codex", "gemini", "xai", "deepseek"];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude_code: "Anthropic",
  codex: "OpenAI",
  gemini: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
};

function ProviderTypeIcon({ type }: { type: ProviderId }) {
  if (type === "claude_code") return <ClaudeIcon height="1em" />;
  if (type === "gemini") return <GeminiIcon height="1em" />;
  if (type === "xai") return <RefreshCw className="h-[1em] w-[1em]" />;
  if (type === "deepseek") return <Settings className="h-[1em] w-[1em]" />;
  return <OpenaiChatgptIcon height="1em" className="fill-current dark:text-white" />;
}

function itemKey(item: CherryProviderImportItem) {
  return `${item.sourceId}\n${item.baseUrl}\n${item.requestFormat}`;
}

function itemProtocolLabel(item: CherryProviderImportItem) {
  if (item.providerType === "claude_code") return "Anthropic Messages";
  if (item.providerType === "gemini") return "Gemini Generate Content";
  if (item.providerType === "deepseek") return "DeepSeek Responses";
  if (item.providerType === "xai") return "xAI Responses API";
  return item.requestFormat === "openai-responses" ? "Responses API" : "Chat Completions";
}

export function CherryStudioImportModal(props: CherryStudioImportModalProps) {
  const {
    initialType,
    response,
    importing,
    scanning,
    dataPath,
    isExisting,
    onChooseDataDirectory,
    onResetDataDirectory,
    onClose,
    onConfirm,
  } = props;
  const candidates = response.providers;
  const resolvedDataPath = dataPath ?? response.dataPath ?? "";
  const [pathDialogOpen, setPathDialogOpen] = useState(false);
  const isCompact = useMediaQuery("(max-width: 640px)");
  const hasSyncableItems = useMemo(
    () => candidates.some((item) => item.enabled && item.importable),
    [candidates],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(!hasSyncableItems);
  const [activeType, setActiveType] = useState<ProviderId>(initialType);

  const visibleItems = showAll
    ? candidates
    : candidates.filter((item) => item.enabled && item.importable);
  // All provider types in one modal, the tab the user came from leading.
  const groupOrder = [initialType, ...PROVIDER_ORDER.filter((type) => type !== initialType)];
  const groups = groupOrder
    .map((type) => ({
      type,
      items: visibleItems.filter((item) => item.providerType === type),
    }))
    .filter((group) => group.items.length > 0);
  // The active tab may lose all its items when the filter toggles — fall back
  // to the first group that still has some.
  const activeGroup = groups.find((group) => group.type === activeType) ?? groups[0];
  const activeItems = activeGroup?.items ?? [];
  const selectedItems = candidates.filter((item) => selected.has(itemKey(item)) && item.importable);

  function toggleItem(item: CherryProviderImportItem) {
    if (!item.importable || importing) return;
    setSelected((current) => {
      const next = new Set(current);
      const key = itemKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectActive() {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of activeItems) {
        if (item.importable) next.add(itemKey(item));
      }
      return next;
    });
  }

  function clearActive() {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of activeItems) next.delete(itemKey(item));
      return next;
    });
  }

  return (
    <>
      <Dialog
        isOpen
        onOpenChange={(isOpen) => {
          if (!isOpen && !importing) onClose();
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
          <DialogHeader
            title="从 Cherry Studio 同步"
            subtitle="仅同步 Base URL 和 API Key；模型由 XAgent 获取并激活。左侧可切换供应商类型。"
            onOpenChange={
              importing
                ? undefined
                : (isOpen) => {
                    if (!isOpen) onClose();
                  }
            }
            endContent={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setPathDialogOpen(true)}
                disabled={importing}
                title="Cherry Studio 数据目录设置"
                aria-label="Cherry Studio 数据目录设置"
              >
                <Settings className="h-4 w-4" />
              </Button>
            }
          />

          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-6 py-3"
          >
            <CheckboxInput
              label="显示禁用或不兼容配置"
              value={showAll}
              onChange={setShowAll}
              isDisabled={importing}
              size="sm"
            />
            <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-lg px-2.5 text-xs"
                onClick={selectActive}
                disabled={importing}
              >
                全选可用项
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-lg px-2.5 text-xs text-muted-foreground"
                onClick={clearActive}
                disabled={importing}
              >
                清空
              </Button>
            </AstryxView>
          </AstryxView>

          <AstryxView layout="flex" direction="horizontal" className="flex min-h-0 flex-1">
            {groups.length === 0 ? (
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground"
              >
                没有可同步的 Cherry Studio 聊天供应商
              </AstryxView>
            ) : (
              <>
                <AstryxView
                  layout="flex"
                  direction="vertical"
                  className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-muted/30 p-2"
                >
                  {groups.map((group) => {
                    const groupSelected = group.items.filter(
                      (item) => item.importable && selected.has(itemKey(item)),
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
                          <ProviderTypeIcon type={group.type} />
                        </AstryxView>
                        <AstryxInline className="min-w-0 flex-1">
                          <AstryxInline className="block truncate text-sm font-medium">
                            {PROVIDER_LABELS[group.type]}
                          </AstryxInline>
                          <AstryxInline className="block text-[11px] text-muted-foreground">
                            {group.items.length} 项配置
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
                  layout="block"
                  direction="horizontal"
                  className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
                >
                  <AstryxView layout="block" direction="horizontal" className="space-y-2">
                    {activeItems.map((item) => {
                      const checked = selected.has(itemKey(item));
                      const existing = isExisting(item);
                      return (
                        <AstryxButton
                          key={itemKey(item)}
                          type="button"
                          className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                            item.importable
                              ? checked
                                ? "border-primary/45 bg-primary/[0.06]"
                                : "hover:bg-accent/40"
                              : "cursor-not-allowed bg-muted/25 opacity-65"
                          }`}
                          onClick={() => toggleItem(item)}
                          disabled={!item.importable || importing}
                        >
                          <AstryxInline
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              checked && item.importable
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-muted-foreground/40"
                            }`}
                          >
                            {checked && item.importable ? <Check className="h-3 w-3" /> : null}
                          </AstryxInline>
                          <AstryxInline className="min-w-0 flex-1">
                            <AstryxView
                              as="span"
                              layout="flex"
                              direction="horizontal"
                              className="flex flex-wrap items-center gap-2"
                            >
                              <strong className="text-sm font-medium">{item.name}</strong>
                              <AstryxInline className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {itemProtocolLabel(item)}
                              </AstryxInline>
                              {existing ? (
                                <AstryxInline className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-300">
                                  将更新
                                </AstryxInline>
                              ) : null}
                              {!item.enabled ? (
                                <AstryxInline className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                  Cherry 中已禁用
                                </AstryxInline>
                              ) : null}
                            </AstryxView>
                            <AstryxInline className="mt-1 block truncate text-xs text-muted-foreground">
                              {item.baseUrl || "未配置 Base URL"}
                            </AstryxInline>
                            <AstryxInline className="mt-1 block text-xs text-muted-foreground">
                              {item.apiKeyCount > 0 ? "密钥已配置" : "无可迁移密钥"}
                              {item.excludedModelCount > 0
                                ? ` · Cherry 中识别到 ${item.excludedModelCount} 个非聊天模型`
                                : ""}
                            </AstryxInline>
                            {item.reason ? (
                              <AstryxInline className="mt-1.5 block text-xs text-destructive">
                                {item.reason}
                              </AstryxInline>
                            ) : item.warning ? (
                              <AstryxInline className="mt-1.5 block text-xs text-amber-700 dark:text-amber-300">
                                {item.warning}
                              </AstryxInline>
                            ) : null}
                          </AstryxInline>
                        </AstryxButton>
                      );
                    })}
                  </AstryxView>
                </AstryxView>
              </>
            )}
          </AstryxView>

          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex shrink-0 items-center justify-between gap-3 border-t bg-background px-6 py-4"
          >
            <AstryxView
              layout="block"
              direction="horizontal"
              className="text-xs text-muted-foreground"
            >
              已选择 {selectedItems.length} 个供应商配置
            </AstryxView>
            <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose} disabled={importing}>
                取消
              </Button>
              <Button
                className="min-w-32 gap-2"
                onClick={() => onConfirm(selectedItems)}
                disabled={importing || selectedItems.length === 0}
              >
                {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                {importing ? "正在同步…" : `同步 ${selectedItems.length} 个`}
              </Button>
            </AstryxView>
          </AstryxView>
        </AstryxView>
      </Dialog>

      <AdaptiveDialog
        isOpen={pathDialogOpen}
        onOpenChange={setPathDialogOpen}
        title="Cherry Studio 数据目录"
        subtitle={
          dataPath ? "正在使用手动指定的目录" : "XAgent 会自动读取 Cherry Studio 的数据目录设置"
        }
        purpose="form"
        width="var(--xagent-dialog-width-sm)"
        touchPresentation="bottom-sheet"
        bottomSheetHeight="hug"
      >
        <VStack gap={4}>
          <HStack gap={2} vAlign="center">
            <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
              <Input
                readOnly
                value={resolvedDataPath}
                placeholder={scanning ? "正在检测…" : "未检测到数据目录"}
                title={resolvedDataPath}
              />
            </AstryxView>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={scanning || importing}
              onClick={onChooseDataDirectory}
              title="选择数据目录"
              aria-label="选择 Cherry Studio 数据目录"
            >
              {scanning ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <FolderOpen className="h-4 w-4" />
              )}
            </Button>
          </HStack>
          {dataPath ? (
            <HStack gap={2} vAlign="center" hAlign="between">
              <Text type="supporting" color="secondary">
                手动指定
              </Text>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={scanning || importing}
                onClick={onResetDataDirectory}
              >
                恢复自动检测
              </Button>
            </HStack>
          ) : null}
        </VStack>
      </AdaptiveDialog>
    </>
  );
}
