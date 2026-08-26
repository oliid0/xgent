import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import iconSimpleUrl from "../../src-tauri/icons/icon-simple.png";
import { useLocale } from "../i18n";
import { Maximize2, Minimize2, Minus, X } from "./icons";

type TauriRuntimeWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

type AppWindow = ReturnType<typeof getCurrentWindow>;

function isWindowsTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  const runtimeWindow = window as TauriRuntimeWindow;
  const hasTauriRuntime =
    runtimeWindow.__TAURI__ !== undefined || runtimeWindow.__TAURI_INTERNALS__ !== undefined;
  const platformText = `${navigator.userAgent} ${navigator.platform}`;
  return hasTauriRuntime && /\bWindows\b|Win32|Win64|WOW64/i.test(platformText);
}

function reportWindowChromeError(action: string, error: unknown) {
  console.error(`failed to ${action} XAgent window`, error);
}

export function WindowsTitleBar() {
  const { t } = useLocale();
  const [isVisible, setIsVisible] = useState(() => isWindowsTauriRuntime());
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const appWindowRef = useRef<AppWindow | null>(null);

  const getAppWindow = useCallback(() => {
    if (!appWindowRef.current) {
      appWindowRef.current = getCurrentWindow();
    }
    return appWindowRef.current;
  }, []);

  const syncMaximized = useCallback(() => {
    if (!isVisible) {
      return;
    }
    void getAppWindow()
      .isMaximized()
      .then(setIsMaximized)
      .catch((error) => reportWindowChromeError("read maximized state for", error));
  }, [getAppWindow, isVisible]);

  useEffect(() => {
    setIsVisible(isWindowsTauriRuntime());
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    const appWindow = getAppWindow();
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    void appWindow
      .isMaximized()
      .then((maximized) => {
        if (!disposed) {
          setIsMaximized(maximized);
        }
      })
      .catch((error) => reportWindowChromeError("read maximized state for", error));

    void appWindow
      .isFocused()
      .then((focused) => {
        if (!disposed) {
          setIsFocused(focused);
        }
      })
      .catch((error) => reportWindowChromeError("read focus state for", error));

    void appWindow
      .onResized(() => {
        if (!disposed) {
          syncMaximized();
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenResize = unlisten;
        }
      })
      .catch((error) => reportWindowChromeError("subscribe resize events for", error));

    void appWindow
      .onFocusChanged(({ payload }) => {
        if (!disposed) {
          setIsFocused(payload);
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenFocus = unlisten;
        }
      })
      .catch((error) => reportWindowChromeError("subscribe focus events for", error));

    return () => {
      disposed = true;
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, [getAppWindow, isVisible, syncMaximized]);

  const startDragging = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || event.detail !== 1) {
        return;
      }
      void getAppWindow()
        .startDragging()
        .catch((error) => reportWindowChromeError("drag", error));
    },
    [getAppWindow],
  );

  const toggleMaximize = useCallback(() => {
    const appWindow = getAppWindow();
    void appWindow
      .toggleMaximize()
      .then(() => appWindow.isMaximized())
      .then(setIsMaximized)
      .catch((error) => reportWindowChromeError("toggle maximized state for", error));
  }, [getAppWindow]);

  const handleTitleDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      toggleMaximize();
    },
    [toggleMaximize],
  );

  const minimizeWindow = useCallback(() => {
    void getAppWindow()
      .minimize()
      .catch((error) => reportWindowChromeError("minimize", error));
  }, [getAppWindow]);

  const closeWindow = useCallback(() => {
    void getAppWindow()
      .close()
      .catch((error) => reportWindowChromeError("close", error));
  }, [getAppWindow]);

  if (!isVisible) {
    return null;
  }

  const maximizeLabel = isMaximized ? t("window.restore") : t("window.maximize");

  return (
    <HStack
      as="header"
      width="100%"
      height="var(--xagent-windows-titlebar-height)"
      vAlign="center"
      style={
        {
          position: "relative",
          zIndex: "var(--xagent-z-window-chrome)",
          flexShrink: 0,
          userSelect: "none",
          color: "var(--color-text-primary)",
          opacity: isFocused ? 1 : "var(--xagent-window-chrome-opacity-inactive)",
          backgroundColor: "var(--xagent-window-chrome-background)",
          borderBlockEnd: "var(--border-width) solid var(--color-border)",
          boxShadow: "var(--shadow-low)",
          backdropFilter:
            "blur(var(--xagent-window-chrome-blur)) saturate(var(--xagent-window-chrome-saturation))",
          transitionProperty: "opacity, background-color",
          transitionDuration: "var(--duration-fast)",
          transitionTimingFunction: "var(--ease-standard)",
        } as CSSProperties
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Native titlebar dragging and double-click maximize are pointer gestures; the adjacent controls remain keyboard accessible. */}
      <StackItem size="fill">
        <HStack
          gap={1.5}
          vAlign="center"
          height="100%"
          paddingInlineStart={3}
          paddingInlineEnd={3}
          onDoubleClick={handleTitleDoubleClick}
          onMouseDown={startDragging}
        >
          <img
            src={iconSimpleUrl}
            alt=""
            style={{
              width: "var(--xagent-window-app-icon-size)",
              height: "var(--xagent-window-app-icon-size)",
              flexShrink: 0,
              borderRadius: "var(--radius-element)",
            }}
            draggable={false}
          />
          <Text type="label" maxLines={1} color="primary">
            {t("app.name")}
          </Text>
        </HStack>
      </StackItem>

      <HStack height="100%" vAlign="stretch" role="toolbar" aria-label={t("window.controls")}>
        <IconButton
          label={t("window.minimize")}
          tooltip={t("window.minimize")}
          icon={<Icon icon={Minus} size="sm" color="inherit" />}
          size="sm"
          variant="ghost"
          onClick={minimizeWindow}
          style={{
            width: "var(--xagent-window-control-width)",
            height: "100%",
          }}
        />
        <IconButton
          label={maximizeLabel}
          tooltip={maximizeLabel}
          icon={<Icon icon={isMaximized ? Minimize2 : Maximize2} size="sm" color="inherit" />}
          size="sm"
          variant="ghost"
          onClick={toggleMaximize}
          style={{
            width: "var(--xagent-window-control-width)",
            height: "100%",
          }}
        />
        <IconButton
          label={t("window.close")}
          tooltip={t("window.close")}
          icon={<Icon icon={X} size="sm" color="inherit" />}
          size="sm"
          variant="destructive"
          onClick={closeWindow}
          style={{
            width: "var(--xagent-window-close-control-width)",
            height: "100%",
          }}
        />
      </HStack>
    </HStack>
  );
}
