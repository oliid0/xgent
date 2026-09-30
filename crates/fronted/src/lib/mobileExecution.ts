import { invoke, listenNativePlugin } from "@xgent/runtime";

export type MobileExecutionBackend = "android-proot" | "ios-a-shell" | "unavailable";

export type MobileExecutionCapabilities = {
  shell: boolean;
  wasi: boolean;
  network: boolean;
  childProcesses: boolean;
  userSelectedWorkspaces: boolean;
  packageManagement: boolean;
};

export type MobileToolchainStatus = {
  id: string;
  label: string;
  installed: boolean;
  installable: boolean;
  version?: string | null;
  detail?: string | null;
};

export type MobileExecutionStatus = {
  backend: MobileExecutionBackend;
  available: boolean;
  installed: boolean;
  detail?: string | null;
  capabilities: MobileExecutionCapabilities;
  toolchains: MobileToolchainStatus[];
  environmentVersion?: string | null;
  diskUsageBytes?: number | null;
};

export type MobileToolchainInstallResult = {
  backend: MobileExecutionBackend;
  succeeded: boolean;
  exitCode: number;
  installed: string[];
  status: MobileToolchainStatus[];
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
};

export type MobileEnvironmentInstallProgress = {
  phase: "preparing" | "copying" | "extracting" | "finalizing" | "verifying" | "ready";
  percent?: number | null;
};

export type MobileExecutionOutput = {
  runId: string;
  stream: "stdout" | "stderr";
  data: string;
};

export function listenMobileExecutionOutput(handler: (output: MobileExecutionOutput) => void) {
  return listenNativePlugin<MobileExecutionOutput>("mobile-execution", "output", handler);
}

export function listenMobileEnvironmentInstallProgress(
  handler: (progress: MobileEnvironmentInstallProgress) => void,
) {
  return listenNativePlugin<MobileEnvironmentInstallProgress>(
    "mobile-execution",
    "install-progress",
    handler,
  );
}

export function mobileEnvironmentInstallLabel(
  progress: MobileEnvironmentInstallProgress | null,
  t: (key: string) => string,
) {
  if (!progress) return t("settings.native.shellInstalling");
  const phase = ["preparing", "copying", "extracting", "finalizing", "verifying", "ready"].includes(
    progress.phase,
  )
    ? progress.phase
    : "preparing";
  const key = `settings.native.shellInstall.${phase}`;
  const percent = progress.percent;
  return `${t(key)}${typeof percent === "number" && percent >= 0 && percent <= 100 ? ` ${Math.round(percent)}%` : ""}`;
}

export type ExternalMobileWorkspace = {
  id: string;
  name: string;
  path: string;
  writable: boolean;
  active: boolean;
  detail?: string | null;
};

const PLUGIN_COMMAND = "plugin:mobile-execution|";
let verifiedShellAvailable = false;
let statusRevision = 0;

/** Read synchronously when preparing a turn; optional Shell must never delay model traffic. */
export function isMobileShellAvailable() {
  return verifiedShellAvailable;
}

export async function mobileExecutionStatus() {
  const revision = ++statusRevision;
  try {
    const status = await invoke<MobileExecutionStatus>(`${PLUGIN_COMMAND}status`);
    if (revision === statusRevision) {
      verifiedShellAvailable =
        status.available === true &&
        status.installed === true &&
        status.capabilities.shell === true;
    }
    return status;
  } catch (error) {
    if (revision === statusRevision) verifiedShellAvailable = false;
    throw error;
  }
}

export function installMobileEnvironment() {
  // A response from a probe started before reinstall must not revive stale capabilities.
  ++statusRevision;
  verifiedShellAvailable = false;
  return invoke<{ backend: MobileExecutionBackend; installed: boolean; detail?: string | null }>(
    `${PLUGIN_COMMAND}install`,
    { request: {} },
  );
}

export function installMobileToolchains(toolchains: string[], runId: string) {
  return invoke<MobileToolchainInstallResult>(`${PLUGIN_COMMAND}install_toolchains`, {
    request: {
      runId,
      toolchains,
      timeoutMs: 30 * 60 * 1_000,
    },
  });
}

export function cancelMobileExecution(runId: string) {
  return invoke<{ cancelled: boolean }>(`${PLUGIN_COMMAND}cancel`, {
    request: { runId },
  });
}

export function listExternalMobileWorkspaces() {
  return invoke<ExternalMobileWorkspace[]>(`${PLUGIN_COMMAND}list_external_workspaces`);
}

export function pickExternalMobileWorkspace(allowWrite = true) {
  return invoke<ExternalMobileWorkspace>(`${PLUGIN_COMMAND}pick_external_workspace`, {
    request: { allowWrite },
  });
}

export function removeExternalMobileWorkspace(id: string) {
  return invoke<{ removed: boolean }>(`${PLUGIN_COMMAND}remove_external_workspace`, {
    request: { id },
  });
}
