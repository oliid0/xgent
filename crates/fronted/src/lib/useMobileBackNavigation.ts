import { useEffect } from "react";
import { mobileBackNavigation } from "./mobileBackNavigation";
import { inferRuntimePlatform, isNativeMobileRuntime } from "./runtimePlatform";

export function useMobileBackNavigation(
  enabled: boolean,
  run: () => void,
  priority = 0,
  owner?: () => HTMLElement | null,
) {
  useEffect(() => {
    if (!enabled || !isNativeMobileRuntime() || inferRuntimePlatform() !== "android") return;
    return mobileBackNavigation.register({ run, priority, owner });
  }, [enabled, run, priority, owner]);
}
