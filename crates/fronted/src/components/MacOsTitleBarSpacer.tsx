import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Layout";
import { invoke } from "@xagent/runtime";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useLocale } from "../i18n";
import type { AppUpdateController } from "../lib/appUpdates";
import { AppUpdateButton } from "./AppUpdateButton";
import { PanelLeft, PanelLeftClose, Settings } from "./icons";

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

type MacOsTrafficLightMetrics = {
  top: number;
  left: number;
  width: number;
  height: number;
};

// Fallback values match tauri.conf.json; runtime AppKit metrics replace them on macOS.
const MAC_OS_TRAFFIC_LIGHT_TOP = 26;
const MAC_OS_TRAFFIC_LIGHT_LEFT = 18;
const MAC_OS_TRAFFIC_LIGHT_GROUP_WIDTH = 52;
const MAC_OS_TRAFFIC_LIGHT_GROUP_HEIGHT = 12;
const MAC_OS_TITLEBAR_TOGGLE_BUTTON_SIZE = 28;
const MAC_OS_TITLEBAR_TOGGLE_GAP = 22;
const MAC_OS_SIDEBAR_WIDTH = 272;
const MAC_OS_SIDEBAR_TOGGLE_RIGHT_INSET = 8;

function isValidMetrics(
  metrics: MacOsTrafficLightMetrics | null,
): metrics is MacOsTrafficLightMetrics {
  return Boolean(
    metrics &&
      Number.isFinite(metrics.top) &&
      Number.isFinite(metrics.left) &&
      Number.isFinite(metrics.width) &&
      Number.isFinite(metrics.height) &&
      metrics.width > 0 &&
      metrics.height > 0,
  );
}

function useMacOsTrafficLightMetrics(enabled: boolean) {
  const [metrics, setMetrics] = useState<MacOsTrafficLightMetrics | null>(null);

  useEffect(() => {
    if (!enabled) {
      setMetrics(null);
      return undefined;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const next = await invoke<MacOsTrafficLightMetrics | null>(
          "app_macos_traffic_light_metrics",
        );
        if (!cancelled && isValidMetrics(next)) {
          setMetrics(next);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("failed to read macOS traffic light metrics", error);
          setMetrics(null);
        }
      }
    };

    void refresh();
    window.addEventListener("resize", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", refresh);
    };
  }, [enabled]);

  return metrics;
}

export function isMacOsTauri(): boolean {
  if (typeof window === "undefined") return false;
  const hasTauri = !!(window as TauriWindow).__TAURI_INTERNALS__;
  return hasTauri && /Mac/i.test(navigator.platform);
}

/** Vertical spacer at the top of a sidebar column — clears the macOS traffic lights. */
export function MacOsTitleBarSpacer({ className }: { className?: string }) {
  const [show] = useState(isMacOsTauri);
  if (!show) return null;
  return (
    <HStack
      data-tauri-drag-region
      height="var(--xagent-macos-titlebar-spacer-height)"
      className={className}
    />
  );
}

/**
 * Fixed-position sidebar toggle for macOS overlay titlebar.
 * When the sidebar is open it sits at the sidebar's far-right edge; when closed it
 * returns to the titlebar controls next to the traffic lights.
 */
export function MacOsTitleBarToggle({
  sidebarOpen,
  onToggle,
  onOpenSettings,
  appUpdate,
}: {
  sidebarOpen: boolean;
  onToggle: () => void;
  onOpenSettings?: () => void;
  appUpdate?: AppUpdateController;
}) {
  const { t } = useLocale();
  const [show] = useState(isMacOsTauri);
  const trafficLightMetrics = useMacOsTrafficLightMetrics(show);
  if (!show) return null;
  const trafficLightTop = trafficLightMetrics?.top ?? MAC_OS_TRAFFIC_LIGHT_TOP;
  const trafficLightLeft = trafficLightMetrics?.left ?? MAC_OS_TRAFFIC_LIGHT_LEFT;
  const trafficLightWidth = trafficLightMetrics?.width ?? MAC_OS_TRAFFIC_LIGHT_GROUP_WIDTH;
  const trafficLightHeight = trafficLightMetrics?.height ?? MAC_OS_TRAFFIC_LIGHT_GROUP_HEIGHT;
  const toggleTop = trafficLightTop - (MAC_OS_TITLEBAR_TOGGLE_BUTTON_SIZE - trafficLightHeight) / 2;
  const toggleLeft = sidebarOpen
    ? MAC_OS_SIDEBAR_WIDTH - MAC_OS_TITLEBAR_TOGGLE_BUTTON_SIZE - MAC_OS_SIDEBAR_TOGGLE_RIGHT_INSET
    : trafficLightLeft + trafficLightWidth + MAC_OS_TITLEBAR_TOGGLE_GAP;
  return (
    <HStack
      gap={0.5}
      vAlign="center"
      style={
        {
          position: "fixed",
          zIndex: "var(--xagent-z-titlebar-actions)",
          top: toggleTop,
          left: toggleLeft,
          height: MAC_OS_TITLEBAR_TOGGLE_BUTTON_SIZE,
          transitionProperty: "left",
          transitionDuration: "var(--duration-medium)",
          transitionTimingFunction: "var(--ease-standard)",
          WebkitAppRegion: "no-drag",
        } as CSSProperties
      }
    >
      <IconButton
        label={t(sidebarOpen ? "tooltip.closeSidebar" : "tooltip.openSidebar")}
        tooltip={t(sidebarOpen ? "tooltip.closeSidebar" : "tooltip.openSidebar")}
        icon={<Icon icon={sidebarOpen ? PanelLeftClose : PanelLeft} size="sm" color="inherit" />}
        size="sm"
        variant="ghost"
        onClick={onToggle}
        style={
          {
            height: MAC_OS_TITLEBAR_TOGGLE_BUTTON_SIZE,
            width: MAC_OS_TITLEBAR_TOGGLE_BUTTON_SIZE,
            WebkitAppRegion: "no-drag",
          } as CSSProperties
        }
      />
      {!sidebarOpen && onOpenSettings && (
        <IconButton
          label={t("tooltip.settings")}
          tooltip={t("tooltip.settings")}
          icon={<Icon icon={Settings} size="sm" color="inherit" />}
          size="sm"
          variant="ghost"
          onClick={onOpenSettings}
          style={
            {
              height: MAC_OS_TITLEBAR_TOGGLE_BUTTON_SIZE,
              width: MAC_OS_TITLEBAR_TOGGLE_BUTTON_SIZE,
              WebkitAppRegion: "no-drag",
            } as CSSProperties
          }
        />
      )}
      {!sidebarOpen && onOpenSettings && appUpdate ? (
        <AppUpdateButton appUpdate={appUpdate} />
      ) : null}
    </HStack>
  );
}

/**
 * Horizontal spacer on the left of a header row — used in ChatHeader when sidebar is
 * closed on macOS to clear the traffic lights + fixed toggle button zone.
 */
export function MacOsTitleBarLeadingInset({ className }: { className?: string }) {
  const [show] = useState(isMacOsTauri);
  if (!show) return null;
  return (
    <HStack
      data-tauri-drag-region
      width="var(--xagent-macos-titlebar-leading-inset)"
      className={className}
    />
  );
}
