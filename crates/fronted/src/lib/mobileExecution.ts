import { invoke } from "@xgent/runtime";

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

export type ExternalMobileWorkspace = {
  id: string;
  name: string;
  path: string;
  writable: boolean;
  active: boolean;
  detail?: string | null;
};

const PLUGIN_COMMAND = "plugin:mobile-execution|";

export function mobileExecutionStatus() {
  return invoke<MobileExecutionStatus>(`${PLUGIN_COMMAND}status`);
}

export function installMobileEnvironment() {
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
