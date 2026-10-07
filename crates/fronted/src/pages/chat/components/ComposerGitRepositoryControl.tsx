import { Banner } from "@astryxdesign/core/Banner";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useState } from "react";
import { ArrowLeft, GitBranch, RefreshCw } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { useComposerGitRepository } from "../composer/useComposerGitRepository";

export function ComposerGitRepositoryControl(
  props: Parameters<typeof useComposerGitRepository>[0],
) {
  const { t } = useLocale();
  const [showOperations, setShowOperations] = useState(false);
  useEffect(() => {
    setShowOperations(false);
  }, [props.isOpen, props.workdir]);
  const {
    repositoryOptions,
    branchOptions,
    selectedRepository,
    selectedBranch,
    repositoryMenuLabel,
    repositoryMenuDescription,
    noRepository,
    isDisabled,
    canWrite,
    isLoading,
    isMutating,
    error,
    selectRepository,
    switchBranch,
    initializeRepository,
    refresh,
  } = useComposerGitRepository(props);
  if (!showOperations) {
    return (
      <VStack gap={2} width="100%">
        <List density="compact">
          <ListItem
            label={repositoryMenuLabel}
            description={repositoryMenuDescription}
            startContent={
              <StatusDot
                variant={error ? "error" : noRepository ? "warning" : "success"}
                label={repositoryMenuDescription}
              />
            }
            endContent={
              noRepository ? (
                <Switch
                  label={t("git.branchSelector.initRepository")}
                  isLabelHidden
                  value={false}
                  onChange={(enabled) => {
                    if (enabled) void initializeRepository();
                  }}
                  isDisabled={isDisabled || !canWrite || isLoading || isMutating || !!error}
                />
              ) : undefined
            }
            isDisabled={isDisabled || isLoading || isMutating}
            onClick={noRepository ? undefined : () => setShowOperations(true)}
          />
        </List>
        {error ? (
          <>
            <Banner status="error" title={error} collapsible={false} />
            <IconButton
              label={t("git.branchSelector.refresh")}
              icon={<RefreshCw />}
              variant="ghost"
              isDisabled={isDisabled || isLoading || isMutating}
              onClick={() => void refresh()}
            />
          </>
        ) : null}
      </VStack>
    );
  }

  return (
    <VStack gap={2} width="100%">
      <HStack gap={2} width="100%" vAlign="center">
        <IconButton
          label={t("git.branchSelector.back")}
          tooltip={t("git.branchSelector.back")}
          icon={<ArrowLeft />}
          size="sm"
          variant="ghost"
          onClick={() => setShowOperations(false)}
        />
        <Text weight="semibold">{repositoryMenuLabel}</Text>
      </HStack>

      {repositoryOptions.length > 1 ? (
        <Selector
          label={t("git.branchSelector.repositoryLabel")}
          options={repositoryOptions}
          value={selectedRepository}
          onChange={selectRepository}
          variant="input"
          size="sm"
          width="100%"
          isDisabled={isDisabled || isMutating}
        />
      ) : null}

      {!noRepository && branchOptions.length > 0 ? (
        <Selector
          label={t("git.branchSelector.localBranches")}
          options={branchOptions}
          value={selectedBranch}
          onChange={(value) => void switchBranch(value)}
          hasSearch={branchOptions.length > 8}
          searchPlaceholder={t("git.branchSelector.filterBranches")}
          variant="input"
          size="sm"
          width="100%"
          startIcon={<GitBranch />}
          isLoading={isLoading || isMutating}
          isDisabled={isDisabled || !canWrite}
          disabledMessage={props.disabledMessage}
        />
      ) : null}

      <List density="compact" hasDividers>
        <ListItem
          label={t("git.branchSelector.refresh")}
          description={isLoading ? t("git.branchSelector.loading") : undefined}
          startContent={<RefreshCw />}
          isDisabled={isDisabled || isMutating}
          onClick={() => void refresh()}
        />
        {noRepository ? (
          <ListItem
            label={t("git.branchSelector.initRepository")}
            description={!canWrite ? props.disabledMessage : undefined}
            startContent={<GitBranch />}
            isDisabled={isDisabled || !canWrite || isMutating}
            onClick={() => void initializeRepository()}
          />
        ) : null}
      </List>

      {error ? <Banner status="error" title={error} collapsible={false} /> : null}
    </VStack>
  );
}
