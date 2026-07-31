import type { RuntimeInvokeArgs } from "./types";

export const LAN_PC_SESSION_CHANGED_EVENT = "xagent:lan-pc-session-changed";
export const LAN_PC_RELAY_EVENT = "xagent:lan-pc-event";

export type LanPcCommandHostConfig = {
  enabled: boolean;
  baseUrl: string;
  localWorkdir?: string;
  remoteWorkdir?: string;
  remoteHomeDir?: string;
};

type NormalizedLanPcCommandHostConfig = {
  enabled: boolean;
  baseUrl: string;
  localWorkdir: string;
  remoteWorkdir: string;
  remoteHomeDir: string;
};

const DISABLED_CONFIG: NormalizedLanPcCommandHostConfig = {
  enabled: false,
  baseUrl: "",
  localWorkdir: "",
  remoteWorkdir: "",
  remoteHomeDir: "",
};

const DELEGATED_COMMAND_PREFIXES = [
  "fs_",
  "git_",
  "terminal_",
  "ssh_",
  "sftp_",
  "managed_process_",
  "mcp_",
  "automation_",
  "hook_",
] as const;

const DELEGATED_EVENTS = new Set([
  "automation:cron-changed",
  "automation:hooks-changed",
  "managed-process:changed",
  "sftp:event",
  "terminal:event",
  "terminal:stream",
  "workspace:activity",
]);

let commandHostConfig = DISABLED_CONFIG;

function normalizePath(value: string) {
  return value.trim().replace(/[\\/]+$/, "");
}

function isWindowsPath(value: string) {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function pathsEqual(left: string, right: string) {
  if (left === right) return true;
  return isWindowsPath(left) && isWindowsPath(right) && left.toLowerCase() === right.toLowerCase();
}

function normalizeConfig(config?: LanPcCommandHostConfig): NormalizedLanPcCommandHostConfig {
  if (!config?.enabled || !config.baseUrl.trim()) return DISABLED_CONFIG;
  return {
    enabled: true,
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    localWorkdir: normalizePath(config.localWorkdir ?? ""),
    remoteWorkdir: normalizePath(config.remoteWorkdir ?? ""),
    remoteHomeDir: normalizePath(config.remoteHomeDir ?? ""),
  };
}

/**
 * Selects the native command host used by desktop-only capabilities.
 *
 * Mobile-local commands (settings, Soul, memory, mobile execution, browser
 * sessions, cloud execution and the LAN pairing commands themselves) never
 * cross this boundary. This keeps one explicit routing policy for every
 * desktop capability instead of embedding LAN checks in individual tools.
 */
export function configureLanPcCommandHost(config?: LanPcCommandHostConfig) {
  commandHostConfig = normalizeConfig(config);
}

export function getLanPcCommandHostConfig() {
  return { ...commandHostConfig };
}

export function isLanPcCommandHostReady() {
  return (
    commandHostConfig.enabled &&
    Boolean(commandHostConfig.baseUrl) &&
    Boolean(commandHostConfig.remoteWorkdir)
  );
}

export function shouldDelegateCommandToLanPc(command: string, args?: RuntimeInvokeArgs) {
  if (!commandHostConfig.enabled || !commandHostConfig.remoteWorkdir) return false;
  const normalized = command.trim();
  if (!normalized || normalized.startsWith("lan_pc_") || normalized.startsWith("local_access_")) {
    return false;
  }
  if (normalized.startsWith("fs_") && typeof args?.workdir === "string") {
    const requestedRoot = normalizePath(args.workdir);
    const { localWorkdir, remoteWorkdir } = commandHostConfig;
    if (
      requestedRoot &&
      !pathStartsWith(requestedRoot, localWorkdir) &&
      !pathStartsWith(requestedRoot, remoteWorkdir)
    ) {
      // Installed Skills and mounted mobile roots remain device-local.
      return false;
    }
  }
  return DELEGATED_COMMAND_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function shouldDelegateEventToLanPc(event: string) {
  return commandHostConfig.enabled && DELEGATED_EVENTS.has(event.trim());
}

function pathStartsWith(path: string, root: string) {
  if (!path || !root) return false;
  if (pathsEqual(path, root)) return true;
  const comparisonPath = isWindowsPath(path) && isWindowsPath(root) ? path.toLowerCase() : path;
  const comparisonRoot = isWindowsPath(path) && isWindowsPath(root) ? root.toLowerCase() : root;
  return (
    comparisonPath.startsWith(`${comparisonRoot}/`) ||
    comparisonPath.startsWith(`${comparisonRoot}\\`)
  );
}

function joinRemotePath(root: string, suffix: string) {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${separator}${suffix.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator)}`;
}

function mapWorkdir(value: unknown) {
  if (typeof value !== "string") return value;
  const path = normalizePath(value);
  const { localWorkdir, remoteWorkdir } = commandHostConfig;
  if (!path || !remoteWorkdir) return value;
  if (!localWorkdir || !pathStartsWith(path, localWorkdir)) {
    return path === remoteWorkdir ? path : remoteWorkdir;
  }
  if (pathsEqual(path, localWorkdir)) return remoteWorkdir;
  return joinRemotePath(remoteWorkdir, path.slice(localWorkdir.length));
}

export function prepareLanPcInvokeArgs(args?: RuntimeInvokeArgs): RuntimeInvokeArgs {
  const next: RuntimeInvokeArgs = { ...(args ?? {}) };
  for (const key of ["workdir", "cwd", "project_path_key"]) {
    if (Object.hasOwn(next, key)) {
      next[key] = mapWorkdir(next[key]);
    }
  }
  return next;
}
