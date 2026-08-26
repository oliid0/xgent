import { Badge } from "@astryxdesign/core/Badge";
import { Collapsible, CollapsibleGroup } from "@astryxdesign/core/Collapsible";
import { ComplexSelector } from "@astryxdesign/core/ComplexSelector";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { memo, type ReactNode, useMemo, useState } from "react";

import {
  Check,
  ClaudeIcon,
  GeminiIcon,
  MonitorSmartphone,
  Moon,
  OpenaiChatgptIcon,
  PanelLeft,
  Search,
  Settings,
  Sun,
} from "../../../components/icons";
import { isMacOsTauri } from "../../../components/MacOsTitleBarSpacer";
import { useLocale } from "../../../i18n";
import { groupModelOptionsByProvider } from "../../../lib/chat/page/chatPageHelpers";
import { type ModelOption, parseModelValue } from "../../../lib/providers/llm";
import {
  type AppSettings,
  type ExecutionMode,
  getNextTheme,
  type ProviderId,
  type SelectedModel,
  type Theme,
} from "../../../lib/settings";
import type { SectionId } from "../../settings/types";

function ProviderBrandIcon({ type }: { type: ProviderId }) {
  if (type === "claude_code") return <ClaudeIcon size={16} />;
  if (type === "gemini") return <GeminiIcon size={16} />;
  return <OpenaiChatgptIcon size={16} />;
}

function ThemeToggleIcon(props: { theme: Theme }) {
  if (props.theme === "light") return <Sun size={16} />;
  if (props.theme === "dark") return <Moon size={16} />;
  return <MonitorSmartphone size={16} />;
}

function ModelSelectorContent(props: {
  executionMode: ExecutionMode;
  modelOptions: ModelOption[];
  selectedValue: string;
  onSelectExecutionMode: (mode: ExecutionMode) => void;
  onChange: (value: string) => void;
  close: () => void;
}) {
  const { t } = useLocale();
  const [modelSearch, setModelSearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const normalizedSearch = modelSearch.trim().toLowerCase();
  const groups = useMemo(
    () => groupModelOptionsByProvider(props.modelOptions),
    [props.modelOptions],
  );
  const selectedGroupId = props.modelOptions.find(
    (option) => option.value === props.selectedValue,
  )?.providerId;
  const filteredGroups = useMemo(
    () =>
      normalizedSearch
        ? groups
            .map((group) => ({
              ...group,
              opts: group.opts.filter(
                (option) =>
                  option.model.toLowerCase().includes(normalizedSearch) ||
                  option.providerName.toLowerCase().includes(normalizedSearch),
              ),
            }))
            .filter((group) => group.opts.length > 0)
        : groups,
    [groups, normalizedSearch],
  );

  return (
    <VStack gap={3} width="var(--xagent-model-selector-width)">
      <VStack gap={1}>
        <Text type="label" color="secondary">
          {t("settings.executionMode")}
        </Text>
        <SegmentedControl
          value={props.executionMode}
          onChange={(value) => props.onSelectExecutionMode(value as ExecutionMode)}
          label={t("settings.executionMode")}
          layout="fill"
          size="sm"
        >
          <SegmentedControlItem value="text" label="Chat" />
          <SegmentedControlItem value="tools" label="Agent" />
          <SegmentedControlItem value="agent-dev" label="Agent dev" />
        </SegmentedControl>
      </VStack>
      <TextInput
        label={t("chat.searchModel")}
        isLabelHidden
        hasAutoFocus
        value={modelSearch}
        onChange={setModelSearch}
        placeholder={t("chat.searchModel")}
        startIcon={<Search size={16} />}
        onKeyDown={(event) => event.stopPropagation()}
      />
      {filteredGroups.length === 0 ? (
        <EmptyState
          isCompact
          icon={<Search size={20} />}
          title={t("chat.noModelFound")}
          description={t("chat.searchModel")}
        />
      ) : (
        <VStack
          gap={1}
          isScrollable
          style={{ maxHeight: "var(--xagent-model-selector-list-height)" }}
        >
          <CollapsibleGroup type="multiple" hasDividers>
            {filteredGroups.map((group) => {
              const isExpanded =
                normalizedSearch.length > 0 ||
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
                      <Text type="body" weight="medium">
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
                          label={option.model}
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

export const ChatHeader = memo(function ChatHeader(props: {
  settings: AppSettings;
  hasModels: boolean;
  currentModelLabel: string;
  modelOptions: ModelOption[];
  selectedValue?: string;
  sidebarOpen: boolean;
  onSelectModel: (selection: SelectedModel) => void;
  onSelectExecutionMode: (mode: ExecutionMode) => void;
  onOpenSettings: (section?: SectionId) => void;
  onToggleTheme: () => void;
  onOpenSidebar: () => void;
  mobileExperience?: boolean;
  preThemeActions?: ReactNode;
  trailingActions?: ReactNode;
}) {
  const {
    settings,
    hasModels,
    currentModelLabel,
    modelOptions,
    selectedValue = "",
    sidebarOpen,
    onSelectModel,
    onSelectExecutionMode,
    onOpenSettings,
    onToggleTheme,
    onOpenSidebar,
    mobileExperience = false,
    preThemeActions,
    trailingActions,
  } = props;
  const { t } = useLocale();
  const nextTheme = getNextTheme(settings.theme);
  const themeToggleTitle =
    nextTheme === "light"
      ? t("tooltip.switchToLight")
      : nextTheme === "dark"
        ? t("tooltip.switchToDark")
        : t("tooltip.switchToAuto");
  const selectedOption = modelOptions.find((option) => option.value === selectedValue);
  const macOsTauri = isMacOsTauri();

  return (
    <HStack
      as="header"
      data-tauri-drag-region
      data-mobile-chat-header={mobileExperience ? "true" : undefined}
      className="chat-header"
      width="100%"
      hAlign="between"
      vAlign="center"
      gap={2}
      style={{
        paddingBlock: mobileExperience ? "var(--spacing-2)" : "var(--spacing-2-5)",
        paddingInlineEnd: "var(--spacing-4)",
        paddingInlineStart:
          !sidebarOpen && macOsTauri ? "var(--xagent-macos-titlebar-inset)" : "var(--spacing-4)",
      }}
    >
      <HStack gap={1.5} vAlign="center" style={{ minWidth: 0 }}>
        {mobileExperience && !sidebarOpen && !macOsTauri ? (
          <IconButton
            label={t("tooltip.openSidebar")}
            tooltip={t("tooltip.openSidebar")}
            icon={<PanelLeft size={20} />}
            variant="ghost"
            size="lg"
            onClick={onOpenSidebar}
          />
        ) : null}
        <ComplexSelector<string>
          label={t("chat.selectModel")}
          value={selectedValue}
          onChange={(value) => {
            const parsed = parseModelValue(value);
            if (parsed) onSelectModel(parsed);
          }}
          triggerLabel={currentModelLabel}
          startIcon={
            selectedOption ? <ProviderBrandIcon type={selectedOption.providerType} /> : undefined
          }
          isDisabled={!hasModels}
          variant="ghost"
          size="md"
          width="var(--xagent-model-selector-trigger-width)"
          placement="below"
          alignment={mobileExperience ? "center" : "start"}
        >
          {(value, onChange, close) => (
            <ModelSelectorContent
              executionMode={settings.system.executionMode}
              modelOptions={modelOptions}
              selectedValue={value}
              onSelectExecutionMode={onSelectExecutionMode}
              onChange={onChange}
              close={close}
            />
          )}
        </ComplexSelector>
      </HStack>

      <HStack gap={1} vAlign="center">
        {!mobileExperience ? preThemeActions : null}
        {!mobileExperience ? (
          <IconButton
            label={themeToggleTitle}
            tooltip={themeToggleTitle}
            icon={<ThemeToggleIcon theme={nextTheme} />}
            variant="ghost"
            size="md"
            onClick={onToggleTheme}
          />
        ) : null}
        {!mobileExperience && !sidebarOpen && !macOsTauri ? (
          <IconButton
            label={t("tooltip.settings")}
            tooltip={t("tooltip.settings")}
            icon={<Settings size={16} />}
            variant="ghost"
            size="md"
            onClick={() => onOpenSettings()}
          />
        ) : null}
        {trailingActions}
      </HStack>
    </HStack>
  );
});
