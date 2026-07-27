export type RuntimeToolCapabilities = {
  managedProcess: boolean;
  cron: boolean;
  mcp: boolean;
  ssh: boolean;
  terminal: boolean;
  subagents: boolean;
  customSystemTools: boolean;
};

const DESKTOP_TOOL_CAPABILITIES: RuntimeToolCapabilities = {
  managedProcess: true,
  cron: true,
  mcp: true,
  ssh: true,
  terminal: true,
  subagents: true,
  customSystemTools: true,
};

const NATIVE_MOBILE_TOOL_CAPABILITIES: RuntimeToolCapabilities = {
  managedProcess: false,
  cron: false,
  mcp: false,
  ssh: false,
  terminal: false,
  subagents: false,
  customSystemTools: false,
};

/**
 * Resolves the command-host capabilities for an agent run.
 *
 * Browser Web UI sessions deliberately use the desktop profile even when the
 * browser itself runs on a phone: commands are executed by the paired desktop
 * host. Only a native Android/iOS application uses the restricted profile.
 */
export function resolveRuntimeToolCapabilities(nativeMobileRuntime: boolean) {
  return {
    ...(nativeMobileRuntime ? NATIVE_MOBILE_TOOL_CAPABILITIES : DESKTOP_TOOL_CAPABILITIES),
  };
}
