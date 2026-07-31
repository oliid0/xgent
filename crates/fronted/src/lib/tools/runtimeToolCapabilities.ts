export type RuntimeToolCapabilities = {
  managedProcess: boolean;
  cron: boolean;
  mcp: boolean;
  localMcpStdio: boolean;
  ssh: boolean;
  terminal: boolean;
  subagents: boolean;
  customSystemTools: boolean;
};

export type RuntimeToolHost = "desktop" | "native-mobile" | "lan-desktop";

const DESKTOP_TOOL_CAPABILITIES: RuntimeToolCapabilities = {
  managedProcess: true,
  cron: true,
  mcp: true,
  localMcpStdio: true,
  ssh: true,
  terminal: true,
  subagents: true,
  customSystemTools: true,
};

const NATIVE_MOBILE_TOOL_CAPABILITIES: RuntimeToolCapabilities = {
  managedProcess: false,
  cron: false,
  // Native mobile can use network MCP transports directly. Local stdio MCP
  // needs a persistent child-process protocol bridge, which neither iOS nor
  // the current Android PRoot runner exposes.
  mcp: true,
  localMcpStdio: false,
  ssh: false,
  terminal: false,
  subagents: false,
  customSystemTools: false,
};

/**
 * Resolves the command-host capabilities for an agent run.
 *
 * Browser Web UI and paired native clients use a desktop capability profile:
 * their commands execute on the authenticated desktop host. A native mobile
 * client uses the restricted profile only while it is executing locally.
 */
export function resolveRuntimeToolCapabilities(host: RuntimeToolHost) {
  return {
    ...(host === "native-mobile" ? NATIVE_MOBILE_TOOL_CAPABILITIES : DESKTOP_TOOL_CAPABILITIES),
  };
}

export function resolveRuntimeToolHost(
  nativeMobileRuntime: boolean,
  lanPcCommandHostReady: boolean,
): RuntimeToolHost {
  if (!nativeMobileRuntime) return "desktop";
  return lanPcCommandHostReady ? "lan-desktop" : "native-mobile";
}
