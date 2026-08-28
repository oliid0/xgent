import { Badge } from "@astryxdesign/core/Badge";
import { Button as AstryxNativeButton } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ClaudeIcon,
  FolderOpen,
  GeminiIcon,
  OpenaiChatgptIcon,
  RefreshCw,
  Settings,
} from "../../components/icons";
import type { CodexRequestFormat, ProviderId } from "../../lib/settings";
import { SettingsModalShell } from "./SettingsModalShell";

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
  if (type === "xai") return <RefreshCw height="1em" width="1em" />;
  if (type === "deepseek") return <Settings height="1em" width="1em" />;
  return <OpenaiChatgptIcon height="1em" />;
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

function CherryProviderRow(props: {
  item: CherryProviderImportItem;
  isSelected: boolean;
  isExisting: boolean;
  importing: boolean;
  onChange: () => void;
}) {
  const { item, isSelected, isExisting, importing, onChange } = props;
  const checkboxRef = useRef<HTMLInputElement>(null);
  const statusLabel = !item.importable
    ? item.reason || "配置不可导入"
    : isExisting
      ? "将更新现有配置"
      : item.enabled
        ? "可以同步"
        : "Cherry Studio 中已禁用";
  const statusVariant = !item.importable
    ? "error"
    : isExisting
      ? "accent"
      : item.enabled
        ? "success"
        : "warning";

  return (
    <ListItem
      label={item.name}
      description={
        <VStack gap={1}>
          <Text type="supporting" color="secondary">
            {item.baseUrl || "未配置 Base URL"}
          </Text>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <StatusDot variant={statusVariant} label={statusLabel} />
            <Text type="supporting" color="secondary">
              {statusLabel}
            </Text>
            <Text type="supporting" color="secondary">
              {itemProtocolLabel(item)}
            </Text>
            <Text type="supporting" color="secondary">
              {item.apiKeyCount > 0 ? `${item.apiKeyCount} 个密钥` : "无可迁移密钥"}
            </Text>
          </HStack>
          {item.warning ? (
            <Text type="supporting" color="secondary">
              {item.warning}
            </Text>
          ) : null}
        </VStack>
      }
      startContent={
        <CheckboxInput
          ref={checkboxRef}
          label={item.name}
          isLabelHidden
          value={isSelected}
          isDisabled={!item.importable || importing}
          disabledMessage={!item.importable ? statusLabel : undefined}
          onChange={onChange}
          size="sm"
        />
      }
      interactiveRef={checkboxRef}
      isDisabled={!item.importable || importing}
    />
  );
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
  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );
  const hasSyncableItems = useMemo(
    () => candidates.some((item) => item.enabled && item.importable),
    [candidates],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        candidates.filter((item) => item.enabled && item.importable).map((item) => itemKey(item)),
      ),
  );
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

  useEffect(() => {
    setSelected(
      new Set(
        candidates.filter((item) => item.enabled && item.importable).map((item) => itemKey(item)),
      ),
    );
  }, [candidates]);

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

  if (pathDialogOpen) {
    return (
      <SettingsModalShell
        onClose={() => setPathDialogOpen(false)}
        purpose="form"
        ariaLabel="Cherry Studio 数据目录"
      >
        <DialogHeader
          title="Cherry Studio 数据目录"
          subtitle={
            dataPath
              ? "当前使用手动指定的数据目录"
              : "XAgent 会自动读取 Cherry Studio 的数据目录设置"
          }
          startContent={
            <IconButton
              label="返回"
              tooltip="返回同步设置"
              variant="ghost"
              size="sm"
              icon={<ArrowLeft />}
              onClick={() => setPathDialogOpen(false)}
            />
          }
        />
        <VStack padding={5} gap={4}>
          <HStack gap={2} vAlign="center">
            <StackItem size="fill">
              <TextInput
                label="Cherry Studio 数据目录"
                value={resolvedDataPath}
                placeholder={scanning ? "正在检测…" : "未检测到数据目录"}
                isReadOnly
                width="100%"
              />
            </StackItem>
            <IconButton
              label="选择数据目录"
              tooltip="选择 Cherry Studio 数据目录"
              variant="secondary"
              size="sm"
              icon={<FolderOpen />}
              isLoading={scanning}
              isDisabled={scanning || importing}
              onClick={onChooseDataDirectory}
            />
          </HStack>
          {dataPath ? (
            <HStack gap={2} vAlign="center" hAlign="between">
              <Text type="supporting" color="secondary">
                手动指定
              </Text>
              <AstryxNativeButton
                label="恢复自动检测"
                variant="ghost"
                size="sm"
                isDisabled={scanning || importing}
                onClick={onResetDataDirectory}
              />
            </HStack>
          ) : null}
        </VStack>
      </SettingsModalShell>
    );
  }

  return (
    <SettingsModalShell onClose={onClose} purpose="form" ariaLabel="Cherry Studio 同步">
      <VStack width="100%" height="100%" minHeight={0} gap={0}>
        <DialogHeader
          title="从 Cherry Studio 同步"
          subtitle="仅同步 Base URL 和 API Key；模型由 XAgent 获取并激活。左侧可切换供应商类型。"
          startContent={
            <IconButton
              label="返回"
              tooltip="返回供应商配置"
              variant="ghost"
              size="sm"
              icon={<ArrowLeft />}
              isDisabled={importing}
              onClick={onClose}
            />
          }
          endContent={
            <IconButton
              label="数据目录"
              tooltip="设置 Cherry Studio 数据目录"
              variant="ghost"
              size="sm"
              icon={<Settings />}
              onClick={() => setPathDialogOpen(true)}
              isDisabled={importing}
            />
          }
        />

        <HStack width="100%" padding={3} hAlign="between" vAlign="center" gap={3} wrap="wrap">
          <CheckboxInput
            label="显示禁用或不兼容配置"
            value={showAll}
            onChange={setShowAll}
            isDisabled={importing}
            size="sm"
          />
          <HStack gap={2} vAlign="center">
            <AstryxNativeButton
              label="全选可用项"
              variant="secondary"
              size="sm"
              onClick={selectActive}
              isDisabled={importing}
            />
            <AstryxNativeButton
              label="清空"
              variant="ghost"
              size="sm"
              onClick={clearActive}
              isDisabled={importing}
            />
          </HStack>
        </HStack>

        <StackItem size="fill">
          {groups.length === 0 ? (
            <VStack width="100%" height="100%" hAlign="center" vAlign="center" padding={5}>
              <EmptyState
                title="未发现可同步的 Cherry Studio 供应商"
                description={
                  response.message || "请选择 Cherry Studio 数据目录，然后重新扫描配置。"
                }
                actions={
                  <AstryxNativeButton
                    label="选择数据目录"
                    variant="secondary"
                    size="sm"
                    icon={<FolderOpen />}
                    onClick={() => setPathDialogOpen(true)}
                    isDisabled={importing}
                  />
                }
              />
            </VStack>
          ) : (
            <HStack width="100%" height="100%" minHeight={0} gap={0}>
              {isCompact ? null : (
                <VStack width="30%" minHeight={0} padding={2}>
                  <List density="compact">
                    {groups.map((group) => {
                      const groupSelected = group.items.filter(
                        (item) => item.importable && selected.has(itemKey(item)),
                      ).length;
                      return (
                        <ListItem
                          key={group.type}
                          label={PROVIDER_LABELS[group.type]}
                          description={`${group.items.length} 项配置`}
                          startContent={<ProviderTypeIcon type={group.type} />}
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
                  </List>
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
                        const groupSelected = group.items.filter(
                          (item) => item.importable && selected.has(itemKey(item)),
                        ).length;
                        return (
                          <Tab
                            key={group.type}
                            value={group.type}
                            label={PROVIDER_LABELS[group.type]}
                            panelId="cherry-provider-import-panel"
                            icon={<ProviderTypeIcon type={group.type} />}
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

                  <StackItem size="fill" isScrollable>
                    <List density="balanced" hasDividers>
                      {activeItems.map((item) => (
                        <CherryProviderRow
                          key={itemKey(item)}
                          item={item}
                          isSelected={selected.has(itemKey(item))}
                          isExisting={isExisting(item)}
                          importing={importing}
                          onChange={() => toggleItem(item)}
                        />
                      ))}
                    </List>
                  </StackItem>
                </VStack>
              </StackItem>
            </HStack>
          )}
        </StackItem>

        <HStack width="100%" padding={4} hAlign="between" vAlign="center" gap={3} wrap="wrap">
          <Text type="supporting" color="secondary">
            已选择 {selectedItems.length} 个供应商配置
          </Text>
          <HStack gap={2} vAlign="center">
            <AstryxNativeButton
              label="取消"
              variant="secondary"
              onClick={onClose}
              isDisabled={importing}
            />
            <AstryxNativeButton
              label={importing ? "正在同步…" : `同步 ${selectedItems.length} 个`}
              variant="primary"
              onClick={() => onConfirm(selectedItems)}
              isLoading={importing}
              isDisabled={importing || selectedItems.length === 0}
            />
          </HStack>
        </HStack>
      </VStack>
    </SettingsModalShell>
  );
}
