import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible, CollapsibleGroup } from "@astryxdesign/core/Collapsible";
import { ComplexSelector } from "@astryxdesign/core/ComplexSelector";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { List, ListItem } from "@astryxdesign/core/List";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { memo, useMemo, useState } from "react";

import {
  ArrowDownAZ,
  Check,
  ClaudeIcon,
  GeminiIcon,
  OpenaiChatgptIcon,
  Search,
  Sparkle,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { filterModelPickerGroups } from "../../../lib/chat/modelPickerGroups";
import { groupModelOptionsByProvider } from "../../../lib/chat/page/chatPageHelpers";
import { type ModelOption, parseModelValue } from "../../../lib/providers/llm";
import type {
  ChatRuntimeControls,
  ProviderId,
  ReasoningLevel,
  SelectedModel,
} from "../../../lib/settings";

const REASONING_I18N_KEYS: Record<ReasoningLevel, string> = {
  off: "settings.reasoning.off",
  minimal: "settings.reasoning.minimal",
  low: "settings.reasoning.low",
  medium: "settings.reasoning.medium",
  high: "settings.reasoning.high",
  xhigh: "settings.reasoning.xhigh",
  max: "settings.reasoning.max",
};

const COMPOSER_REASONING_ORDER: ReasoningLevel[] = ["minimal", "low", "medium", "high"];
const COMPOSER_EXTENDED_REASONING_ORDER: ReasoningLevel[] = [
  ...COMPOSER_REASONING_ORDER,
  "xhigh",
  "max",
];

function isReasoningLevel(value: string): value is ReasoningLevel {
  return Object.hasOwn(REASONING_I18N_KEYS, value);
}

function ProviderBrandIcon({ type }: { type: ProviderId }) {
  if (type === "claude_code") return <ClaudeIcon size={16} />;
  if (type === "gemini") return <GeminiIcon size={16} />;
  return <OpenaiChatgptIcon size={16} />;
}

function ModelSelectorContent(props: {
  modelOptions: ModelOption[];
  selectedValue: string;
  chatRuntimeControls: ChatRuntimeControls;
  reasoningOptions: ReasoningLevel[];
  onChatRuntimeControlsChange: (patch: Partial<ChatRuntimeControls>) => void;
  onChange: (value: string) => void;
  close: () => void;
}) {
  const { t, locale } = useLocale();
  const [modelSearch, setModelSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [sortByName, setSortByName] = useState(false);
  const [autoFocusSearch] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia("(hover: none) and (pointer: coarse)").matches,
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const normalizedSearch = modelSearch.trim();
  const groups = useMemo(
    () => groupModelOptionsByProvider(props.modelOptions),
    [props.modelOptions],
  );
  const selectedGroupId = props.modelOptions.find(
    (option) => option.value === props.selectedValue,
  )?.providerId;
  const visibleReasoningOptions = COMPOSER_EXTENDED_REASONING_ORDER.filter((value) =>
    props.reasoningOptions.includes(value),
  );
  const selectedReasoning = visibleReasoningOptions.includes(props.chatRuntimeControls.reasoning)
    ? props.chatRuntimeControls.reasoning
    : (visibleReasoningOptions[0] ?? "minimal");
  const filteredGroups = useMemo(
    () => filterModelPickerGroups(groups, normalizedSearch, providerFilter, sortByName, locale),
    [groups, normalizedSearch, providerFilter, sortByName, locale],
  );
  const activeProviderFilter = groups.some((group) => group.id === providerFilter)
    ? providerFilter
    : "";

  return (
    <VStack className="xgent-model-selector-content" gap={3} width="100%">
      <TextInput
        label={t("chat.searchModel")}
        isLabelHidden
        hasAutoFocus={autoFocusSearch}
        value={modelSearch}
        onChange={setModelSearch}
        placeholder={t("chat.searchModel")}
        startIcon={<Search size={16} />}
        onBeforeInput={(event) => event.stopPropagation()}
        onInput={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      />
      {groups.length > 1 ? (
        <HStack gap={2} width="100%" vAlign="center">
          <Selector
            label={t("chat.filterProviders")}
            isLabelHidden
            value={activeProviderFilter}
            onChange={setProviderFilter}
            options={[
              { value: "", label: t("chat.allProviders") },
              ...groups.map((group) => ({ value: group.id, label: group.name })),
            ]}
            size="sm"
            className="xgent-model-provider-filter"
          />
          <IconButton
            label={t("chat.sortProvidersByName")}
            icon={<ArrowDownAZ size={16} />}
            aria-pressed={sortByName}
            variant={sortByName ? "secondary" : "ghost"}
            onClick={() => setSortByName((current) => !current)}
          />
        </HStack>
      ) : null}
      {visibleReasoningOptions.length > 0 ? (
        <RadioList
          label={t("chat.runtime.reasoning")}
          value={selectedReasoning}
          onChange={(value) => {
            if (!isReasoningLevel(value)) return;
            props.onChatRuntimeControlsChange({
              reasoning: value,
              thinkingEnabled: true,
            });
          }}
          orientation="vertical"
          size="sm"
        >
          {visibleReasoningOptions.map((value) => (
            <RadioListItem key={value} value={value} label={t(REASONING_I18N_KEYS[value])} />
          ))}
        </RadioList>
      ) : null}
      {filteredGroups.length === 0 ? (
        <EmptyState
          isCompact
          icon={<Search size={20} />}
          title={t("chat.noModelFound")}
          description={t("chat.searchModel")}
        />
      ) : (
        <VStack
          className="xgent-model-selector-list"
          gap={1}
          isScrollable
          style={{ maxHeight: "var(--xgent-model-selector-list-height)" }}
        >
          <CollapsibleGroup type="multiple" hasDividers>
            {filteredGroups.map((group) => {
              const isExpanded =
                normalizedSearch.length > 0 ||
                activeProviderFilter === group.id ||
                (expandedGroups[group.id] ?? group.id === selectedGroupId);
              return (
                <Collapsible
                  key={group.id}
                  value={group.id}
                  isOpen={isExpanded}
                  onOpenChange={(next) =>
                    setExpandedGroups((current) => ({ ...current, [group.id]: next }))
                  }
                  trigger={
                    <HStack gap={2} width="100%" vAlign="center">
                      <ProviderBrandIcon type={group.providerType} />
                      <Text type="body" weight="medium" className="xgent-model-option-label">
                        {group.name}
                      </Text>
                      <Badge variant="neutral" label={group.opts.length} />
                    </HStack>
                  }
                >
                  <List density="compact">
                    {group.opts.map((option) => {
                      const isSelected = option.value === props.selectedValue;
                      return (
                        <ListItem
                          key={option.value}
                          label={
                            <Text type="body" className="xgent-model-option-label">
                              {option.model}
                            </Text>
                          }
                          startContent={<ProviderBrandIcon type={option.providerType} />}
                          endContent={isSelected ? <Check size={16} /> : undefined}
                          isSelected={isSelected}
                          onClick={() => {
                            props.onChange(option.value);
                            props.close();
                          }}
                        />
                      );
                    })}
                  </List>
                </Collapsible>
              );
            })}
          </CollapsibleGroup>
        </VStack>
      )}
    </VStack>
  );
}

export const ChatModelSelector = memo(function ChatModelSelector(props: {
  hasModels: boolean;
  currentModelLabel: string;
  modelOptions: ModelOption[];
  selectedValue?: string;
  chatRuntimeControls: ChatRuntimeControls;
  reasoningOptions: ReasoningLevel[];
  isDisabled?: boolean;
  onSelectModel: (selection: SelectedModel) => void;
  onChatRuntimeControlsChange: (patch: Partial<ChatRuntimeControls>) => void;
}) {
  const { t } = useLocale();
  const selectedValue = props.selectedValue ?? "";
  const selectedOption = props.modelOptions.find((option) => option.value === selectedValue);
  const selectedReasoningLabel =
    props.chatRuntimeControls.thinkingEnabled &&
    props.reasoningOptions.includes(props.chatRuntimeControls.reasoning)
      ? t(REASONING_I18N_KEYS[props.chatRuntimeControls.reasoning])
      : "";
  const triggerLabel = [
    selectedOption?.model || props.currentModelLabel || t("chat.model"),
    selectedReasoningLabel,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ComplexSelector<string>
      label={t("chat.selectModel")}
      isLabelHidden
      className="xgent-model-selector"
      value={selectedValue}
      onChange={(value) => {
        const parsed = parseModelValue(value);
        if (parsed) props.onSelectModel(parsed);
      }}
      triggerLabel={
        <span className="xgent-model-trigger" title={triggerLabel}>
          <span className="xgent-model-icon" aria-hidden="true">
            {selectedOption ? (
              <ProviderBrandIcon type={selectedOption.providerType} />
            ) : (
              <Sparkle />
            )}
          </span>
          <span className="xgent-model-name">
            {selectedOption?.model || props.currentModelLabel || t("chat.model")}
          </span>
          {selectedReasoningLabel ? (
            <span className="xgent-model-reasoning">{selectedReasoningLabel}</span>
          ) : null}
        </span>
      }
      isDisabled={props.isDisabled || !props.hasModels}
      variant="ghost"
      size="sm"
      placement="above"
      alignment="end"
    >
      {(value, onChange, close) => (
        <ModelSelectorContent
          modelOptions={props.modelOptions}
          selectedValue={value}
          chatRuntimeControls={props.chatRuntimeControls}
          reasoningOptions={props.reasoningOptions}
          onChatRuntimeControlsChange={props.onChatRuntimeControlsChange}
          onChange={onChange}
          close={close}
        />
      )}
    </ComplexSelector>
  );
});
