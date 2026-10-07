import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function remoteRepositoryName(remote: string) {
  if (!remote) return "";
  let path = "";
  try {
    const url = new URL(remote);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return "";
    path = url.pathname;
  } catch {
    path = /^[^@/:\s]+@[^/:\s]+:(.+)$/.exec(remote)?.[1] ?? "";
  }
  return path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
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

export function useComposerGitRepository(props: {
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
  const lifetime = useRef({ props, mounted: true });
  lifetime.current.props = props;
  const loadingRef = useRef(false);
  const mutationRef = useRef<object | null>(null);
  const current = () =>
    lifetime.current.mounted &&
    lifetime.current.props.isOpen &&
    lifetime.current.props.workdir === props.workdir &&
    lifetime.current.props.gitClient === props.gitClient;
  const writable = () =>
    current() && !lifetime.current.props.isDisabled && lifetime.current.props.canWrite !== false;
  useEffect(() => {
    lifetime.current.mounted = true;
    return () => {
      lifetime.current.mounted = false;
      requestIdRef.current++;
    };
  }, []);
  const selectedRepositoryRef = useRef(selectedRepository);
  selectedRepositoryRef.current = selectedRepository;

  const activeWorkdir =
    selectedRepository === WORKSPACE_REPOSITORY_VALUE
      ? props.workdir
      : selectedRepository || props.workdir;

  const refresh = useCallback(async () => {
    if (!current()) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!props.gitClient || !props.workdir.trim()) {
      setRepositories([]);
      setBranches([]);
      setRepositoryState(emptyGitRepositoryState(props.workdir));
      loadingRef.current = false;
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    loadingRef.current = true;
    setError("");
    try {
      const discovered = props.gitClient.discoverRepositories
        ? await props.gitClient.discoverRepositories(props.workdir)
        : { workdir: props.workdir, repositories: [] };
      if (!current() || requestIdRef.current !== requestId) return;

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
      if (!current() || requestIdRef.current !== requestId) return;
      if (response.state.status === "error")
        throw new Error(response.state.error || t("git.branchSelector.operationFailed"));
      setRepositoryState(response.state);
      setBranches(response.branches);
    } catch (loadError) {
      if (!current() || requestIdRef.current !== requestId) return;
      setRepositories([]);
      setBranches([]);
      setRepositoryState(emptyGitRepositoryState(props.workdir));
      setError(operationError(loadError, t("git.branchSelector.operationFailed")));
    } finally {
      if (current() && requestIdRef.current === requestId) {
        loadingRef.current = false;
        setIsLoading(false);
      }
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
  const selectRepository = (value: string) => {
    if (!current() || mutationRef.current || loadingRef.current) return;
    if (!repositoryOptions.some((option) => option.value === value)) return;
    selectedRepositoryRef.current = value;
    setSelectedRepository(value);
    void refresh();
  };
  const selectedBranch = branches.find((branch) => branch.current)?.fullName ?? "";
  const selectedRepositoryLabel =
    remoteRepositoryName(repositoryState.remoteUrl) ||
    (repositories.find((repository) => repositoryValue(repository) === selectedRepository)?.name ??
      activeWorkdir.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ??
      activeWorkdir);
  const noRepository = repositoryState.status === "not_repo";
  const isDisabled = props.isDisabled || !props.gitClient || !props.workdir.trim();
  const canWrite = props.canWrite ?? true;
  const repositoryMenuLabel = isLoading
    ? t("git.branchSelector.loading")
    : noRepository
      ? t("git.branchSelector.initRepository")
      : `${repositoryState.head || t("git.branchSelector.detached")}: ${selectedRepositoryLabel}`;
  const repositoryMenuDescription = noRepository
    ? t("git.branchSelector.initRepository")
    : repositoryState.head || t("git.branchSelector.detached");

  const switchBranch = async (value: string) => {
    const branch = branches.find((candidate) => candidate.fullName === value);
    if (
      !branch ||
      branch.current ||
      !props.gitClient ||
      isDisabled ||
      !canWrite ||
      !writable() ||
      mutationRef.current ||
      loadingRef.current ||
      selectedRepositoryRef.current !== selectedRepository
    )
      return;
    const operation = {};
    mutationRef.current = operation;
    setIsMutating(true);
    setError("");
    try {
      const result = await props.gitClient.switchBranch(activeWorkdir, branch.name, branch.kind);
      assertGitResult(result, t("git.branchSelector.operationFailed"));
      if (!current()) return;
      await refresh();
    } catch (switchError) {
      if (current()) setError(operationError(switchError, t("git.branchSelector.operationFailed")));
    } finally {
      if (mutationRef.current === operation) {
        mutationRef.current = null;
        if (lifetime.current.mounted) setIsMutating(false);
      }
    }
  };

  const initializeRepository = async () => {
    if (
      !props.gitClient ||
      isDisabled ||
      !canWrite ||
      !noRepository ||
      !writable() ||
      mutationRef.current ||
      loadingRef.current ||
      error
    )
      return;
    const operation = {};
    mutationRef.current = operation;
    setIsMutating(true);
    setError("");
    try {
      const result = await props.gitClient.init(props.workdir, { branch: "main" });
      assertGitResult(result, t("git.branchSelector.operationFailed"));
      if (!current()) return;
      selectedRepositoryRef.current = WORKSPACE_REPOSITORY_VALUE;
      setSelectedRepository(WORKSPACE_REPOSITORY_VALUE);
      await refresh();
    } catch (initError) {
      if (current()) setError(operationError(initError, t("git.branchSelector.operationFailed")));
    } finally {
      if (mutationRef.current === operation) {
        mutationRef.current = null;
        if (lifetime.current.mounted) setIsMutating(false);
      }
    }
  };

  return {
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
  };
}
