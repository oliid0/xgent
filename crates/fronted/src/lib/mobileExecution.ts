import { invoke } from "@xagent/runtime";

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
