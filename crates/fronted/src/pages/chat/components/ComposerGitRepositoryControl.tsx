import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GitBranch, RefreshCw } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type {
  GitBranch as GitBranchInfo,
  GitClient,
  GitDiscoveredRepository,
  GitRepositoryState,
} from "../../../lib/git/types";
import { emptyGitRepositoryState, gitDiscoveredRepositoryLabel } from "../../../lib/git/types";
import type { WorkspaceActivityClient } from "../../../lib/workspace-activity/types";
import { useWorkspaceInvalidation } from "../../../lib/workspace-activity/useWorkspaceInvalidation";

const WORKSPACE_REPOSITORY_VALUE = "__workspace_repository__";

function repositoryValue(repository: GitDiscoveredRepository) {
  return repository.isWorkspaceRoot ? WORKSPACE_REPOSITORY_VALUE : repository.root;
}

function operationError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function assertGitResult(
  result: { ok: boolean; message?: string; stderr?: string },
  fallback: string,
) {
  if (result.ok) return;
  throw new Error(result.message?.trim() || result.stderr?.trim() || fallback);
}

export function ComposerGitRepositoryControl(props: {
  workdir: string;
  gitClient?: GitClient | null;
  workspaceActivityClient?: WorkspaceActivityClient | null;
  isOpen: boolean;
  isDisabled?: boolean;
  canWrite?: boolean;
  disabledMessage?: string;
}) {
  const { t } = useLocale();
  const [repositories, setRepositories] = useState<GitDiscoveredRepository[]>([]);
  const [selectedRepository, setSelectedRepository] = useState(WORKSPACE_REPOSITORY_VALUE);
  const [repositoryState, setRepositoryState] = useState<GitRepositoryState>(() =>
    emptyGitRepositoryState(props.workdir),
  );
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const selectedRepositoryRef = useRef(selectedRepository);
  selectedRepositoryRef.current = selectedRepository;

  const activeWorkdir =
    selectedRepository === WORKSPACE_REPOSITORY_VALUE
      ? props.workdir
      : selectedRepository || props.workdir;

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!props.gitClient || !props.workdir.trim()) {
      setRepositories([]);
      setBranches([]);
      setRepositoryState(emptyGitRepositoryState(props.workdir));
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const discovered = props.gitClient.discoverRepositories
        ? await props.gitClient.discoverRepositories(props.workdir)
        : { workdir: props.workdir, repositories: [] };
      if (requestIdRef.current !== requestId) return;

      const nextRepositories = discovered.repositories;
      setRepositories(nextRepositories);
      const currentSelection = selectedRepositoryRef.current;
      const selectionStillExists = nextRepositories.some(
        (repository) => repositoryValue(repository) === currentSelection,
      );
      const workspaceRepository = nextRepositories.find((repository) => repository.isWorkspaceRoot);
      const fallbackRepository = workspaceRepository ?? nextRepositories[0];
      const nextSelection = selectionStillExists
        ? currentSelection
        : fallbackRepository
          ? repositoryValue(fallbackRepository)
          : WORKSPACE_REPOSITORY_VALUE;
      selectedRepositoryRef.current = nextSelection;
      setSelectedRepository(nextSelection);

      const targetWorkdir =
        nextSelection === WORKSPACE_REPOSITORY_VALUE ? props.workdir : nextSelection;
      const response = await props.gitClient.branches(targetWorkdir);
      if (requestIdRef.current !== requestId) return;
      setRepositoryState(response.state);
      setBranches(response.branches);
    } catch (loadError) {
      if (requestIdRef.current !== requestId) return;
      setRepositories([]);
      setBranches([]);
      setRepositoryState(emptyGitRepositoryState(props.workdir));
      setError(operationError(loadError, t("git.branchSelector.operationFailed")));
    } finally {
      if (requestIdRef.current === requestId) setIsLoading(false);
    }
  }, [props.gitClient, props.workdir, t]);

  useEffect(() => {
    selectedRepositoryRef.current = WORKSPACE_REPOSITORY_VALUE;
    setSelectedRepository(WORKSPACE_REPOSITORY_VALUE);
    setRepositories([]);
    setBranches([]);
    setRepositoryState(emptyGitRepositoryState(props.workdir));
  }, [props.workdir]);

  useEffect(() => {
    if (props.isOpen) void refresh();
  }, [props.isOpen, refresh]);

  useWorkspaceInvalidation({
    client: props.gitClient ? props.workspaceActivityClient : null,
    workdir: props.workdir,
    active: props.isOpen,
    onInvalidate: (hint) => {
      if (hint.git) void refresh();
    },
  });

  const repositoryOptions = useMemo(
    () =>
      repositories.map((repository) => ({
        value: repositoryValue(repository),
        label: gitDiscoveredRepositoryLabel(repository),
        description: repository.relativePath || repository.root,
      })),
    [repositories],
  );
  const branchOptions = useMemo(
    () =>
      branches.map((branch) => ({
        value: branch.fullName,
        label: branch.name,
        description: branch.kind === "remote" ? t("git.branchSelector.remoteBranches") : undefined,
      })),
    [branches, t],
  );
  const selectedBranch = branches.find((branch) => branch.current)?.fullName ?? "";
  const selectedRepositoryLabel =
    repositories.find((repository) => repositoryValue(repository) === selectedRepository)?.name ??
    activeWorkdir.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ??
    activeWorkdir;
  const noRepository = repositoryState.status !== "ready";
  const isDisabled = props.isDisabled || !props.gitClient || !props.workdir.trim();
  const canWrite = props.canWrite ?? true;

  const switchBranch = async (value: string) => {
    const branch = branches.find((candidate) => candidate.fullName === value);
    if (!branch || branch.current || !props.gitClient || isDisabled || !canWrite) return;
    setIsMutating(true);
    setError("");
    try {
      const result = await props.gitClient.switchBranch(activeWorkdir, branch.name, branch.kind);
      assertGitResult(result, t("git.branchSelector.operationFailed"));
      await refresh();
    } catch (switchError) {
      setError(operationError(switchError, t("git.branchSelector.operationFailed")));
    } finally {
      setIsMutating(false);
    }
  };

  const initializeRepository = async () => {
    if (!props.gitClient || isDisabled || !canWrite) return;
    setIsMutating(true);
    setError("");
    try {
      const result = await props.gitClient.init(props.workdir, { branch: "main" });
      assertGitResult(result, t("git.branchSelector.operationFailed"));
      selectedRepositoryRef.current = WORKSPACE_REPOSITORY_VALUE;
      setSelectedRepository(WORKSPACE_REPOSITORY_VALUE);
      await refresh();
    } catch (initError) {
      setError(operationError(initError, t("git.branchSelector.operationFailed")));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <VStack gap={2} width="100%">
      <HStack gap={2} width="100%" vAlign="center">
        <StatusDot
          variant={error ? "error" : noRepository ? "warning" : "success"}
          label={
            noRepository
              ? t("git.branchSelector.noRepoShort")
              : repositoryState.head || t("git.branchSelector.detached")
          }
        />
        <Text weight="semibold">Git</Text>
        {selectedRepositoryLabel ? <Token label={selectedRepositoryLabel} size="sm" /> : null}
        <IconButton
          label={t("git.branchSelector.refresh")}
          tooltip={t("git.branchSelector.refresh")}
          icon={<RefreshCw />}
          size="sm"
          variant="ghost"
          isLoading={isLoading}
          isDisabled={isDisabled || isMutating}
          onClick={() => void refresh()}
        />
      </HStack>

      {repositoryOptions.length > 1 ? (
        <Selector
          label={t("git.branchSelector.repositoryLabel")}
          options={repositoryOptions}
          value={selectedRepository}
          onChange={(value) => {
            selectedRepositoryRef.current = value;
            setSelectedRepository(value);
            void refresh();
          }}
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

      {noRepository && !error ? (
        <Button
          label={t("git.branchSelector.initRepository")}
          icon={<GitBranch />}
          size="sm"
          variant="secondary"
          width="100%"
          isLoading={isMutating}
          isDisabled={isDisabled || !canWrite}
          onClick={() => void initializeRepository()}
        />
      ) : null}

      {error ? <Banner status="error" title={error} collapsible={false} /> : null}
    </VStack>
  );
}
