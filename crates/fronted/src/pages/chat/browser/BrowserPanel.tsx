import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { isTauriRuntime } from "@xgent/runtime";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowLeft, Globe, Lock, Plus, RefreshCw, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  browserSessionController,
  HIDDEN_BROWSER_VIEWPORT,
  MAX_BROWSER_SESSIONS,
  normalizeBrowserAddress,
} from "../../../lib/browser/browserSessionController";
import { useCompactViewport } from "../../../lib/responsive/compactViewport";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";

function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function BrowserTabs(props: { compact: boolean }) {
  const { t } = useLocale();
  const state = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  const active = state.sessions.find((session) => session.sessionId === state.activeSessionId);
  return (
    <HStack width="100%" gap={2} vAlign="center" padding={2}>
      <IconButton
        label={t("browser.newTab")}
        tooltip={t("browser.newTab")}
        icon={<Icon icon={Plus} size="sm" color="inherit" />}
        variant="ghost"
        size="sm"
        isDisabled={state.sessions.length >= MAX_BROWSER_SESSIONS}
        onClick={() => void browserSessionController.newSession()}
      />
      <StackItem size="fill">
        <TabList
          value={state.activeSessionId ?? ""}
          onChange={(value) => browserSessionController.selectSession(value)}
          role="tablist"
          size="sm"
          overflow="scroll"
        >
          {state.sessions.map((session) => (
            <Tab
              key={session.sessionId}
              value={session.sessionId}
              label={session.title?.trim() || hostname(session.url) || t("browser.untitled")}
              icon={
                state.busySessionIds.includes(session.sessionId) ? (
                  <Spinner size="sm" aria-label={t("browser.agentOperating")} />
                ) : (
                  <Icon icon={Globe} size="sm" color="inherit" />
                )
              }
            />
          ))}
        </TabList>
      </StackItem>
      {!props.compact ? (
        <Badge label={`${state.sessions.length}/${MAX_BROWSER_SESSIONS}`} variant="neutral" />
      ) : null}
      <IconButton
        label={t("browser.closeTab")}
        tooltip={t("browser.closeTab")}
        icon={<Icon icon={X} size="sm" color="inherit" />}
        variant="ghost"
        size="sm"
        isDisabled={!active}
        onClick={() => active && void browserSessionController.closeSession(active.sessionId)}
      />
    </HStack>
  );
}

function BrowserAddressBar(props: { compact: boolean }) {
  const { t } = useLocale();
  const state = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  const active = state.sessions.find((session) => session.sessionId === state.activeSessionId);
  const busy = Boolean(active && state.busySessionIds.includes(active.sessionId));
  const [value, setValue] = useState(active?.url ?? "");
  useEffect(() => setValue(active?.url ?? ""), [active?.url]);

  const run = (action: "navigate" | "reload" | "go_back" | "go_forward") => {
    if (!active) return;
    const input = action === "navigate" ? { url: normalizeBrowserAddress(value) } : {};
    void browserSessionController.action(action, input, { sessionId: active.sessionId });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) run("navigate");
  };

  return (
    <HStack as="form" width="100%" gap={2} vAlign="center" padding={2} onSubmit={submit}>
      <IconButton
        label={t("browser.back")}
        tooltip={t("browser.back")}
        icon={<Icon icon={ArrowLeft} size="sm" color="inherit" />}
        variant="ghost"
        size="sm"
        isDisabled={!active || busy}
        onClick={() => run("go_back")}
      />
      <IconButton
        label={t("browser.forward")}
        tooltip={t("browser.forward")}
        icon={<Icon icon={ArrowLeft} size="sm" color="inherit" className="rotate-180" />}
        variant="ghost"
        size="sm"
        isDisabled={!active || busy}
        onClick={() => run("go_forward")}
      />
      {!props.compact ? <Icon icon={Lock} size="sm" color="secondary" /> : null}
      <StackItem size="fill">
        <TextInput
          label={t("browser.addressPlaceholder")}
          isLabelHidden
          data-edge-swipe-ignore
          value={value}
          onChange={setValue}
          placeholder={t("browser.addressPlaceholder")}
          isDisabled={!active}
        />
      </StackItem>
      <IconButton
        label={t("browser.reload")}
        tooltip={t("browser.reload")}
        icon={
          busy ? (
            <Spinner size="sm" aria-label={t("browser.reload")} />
          ) : (
            <Icon icon={RefreshCw} size="sm" color="inherit" />
          )
        }
        variant="ghost"
        size="sm"
        isDisabled={!active || busy}
        onClick={() => run("reload")}
      />
    </HStack>
  );
}

function BrowserViewportSlot() {
  const { t } = useLocale();
  const slotRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const previousSessionRef = useRef<string | null>(null);
  const state = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  const activeSessionId = state.activeSessionId;
  const localNativeSurface = isTauriRuntime();
  const syncViewport = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const element = slotRef.current;
      const sessionId = browserSessionController.getSnapshot().activeSessionId;
      if (!localNativeSurface || !element || !sessionId) return;
      const rect = element.getBoundingClientRect();
      void browserSessionController
        .setViewport(sessionId, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          visible: rect.width > 1 && rect.height > 1,
          scaleFactor: window.devicePixelRatio || 1,
        })
        .catch(() => undefined);
    });
  }, [localNativeSurface]);

  useLayoutEffect(() => {
    if (!localNativeSurface) return;
    const previous = previousSessionRef.current;
    if (previous && previous !== activeSessionId) {
      void browserSessionController
        .setViewport(previous, HIDDEN_BROWSER_VIEWPORT)
        .catch(() => undefined);
    }
    previousSessionRef.current = activeSessionId;
    syncViewport();
  }, [activeSessionId, localNativeSurface, syncViewport]);

  useEffect(() => {
    const element = slotRef.current;
    if (!localNativeSurface || !element) return;
    const observer = new ResizeObserver(syncViewport);
    observer.observe(element);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("scroll", syncViewport, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("scroll", syncViewport, true);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      const current = previousSessionRef.current;
      if (current) {
        void browserSessionController
          .setViewport(current, HIDDEN_BROWSER_VIEWPORT)
          .catch(() => undefined);
      }
    };
  }, [localNativeSurface, syncViewport]);

  return (
    <VStack
      ref={slotRef}
      width="100%"
      height="100%"
      minHeight={0}
      data-edge-swipe-ignore
      style={{ position: "relative", overflow: "hidden", backgroundColor: "white" }}
    >
      {!localNativeSurface ? (
        <EmptyState
          isCompact
          icon={<Icon icon={Globe} size="lg" color="secondary" />}
          title={t("browser.remoteHostTitle")}
          description={t("browser.remoteHostDescription")}
        />
      ) : !activeSessionId ? (
        <Spinner size="lg" label={t("browser.preparing")} />
      ) : null}
    </VStack>
  );
}

export function BrowserPanel() {
  const { t } = useLocale();
  const compactViewport = useCompactViewport();
  const compact = compactViewport || isNativeMobileRuntime();
  const state = useSyncExternalStore(
    browserSessionController.subscribe,
    browserSessionController.getSnapshot,
    browserSessionController.getSnapshot,
  );
  useEffect(() => {
    if (state.panelOpen) void browserSessionController.initialize();
  }, [state.panelOpen]);
  if (!state.panelOpen) return null;

  return (
    <VStack
      as="section"
      width="100%"
      height="100%"
      minHeight={0}
      data-edge-swipe-ignore
      aria-label={t("browser.title")}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 66,
        paddingBlockStart: "env(safe-area-inset-top, 0px)",
        paddingBlockEnd: "env(safe-area-inset-bottom, 0px)",
        backgroundColor: "var(--color-background-primary)",
      }}
    >
      <Layout
        height="fill"
        padding={0}
        header={
          <LayoutHeader hasDivider padding={0}>
            <VStack width="100%" gap={0}>
              <Toolbar
                label={t("browser.title")}
                size="lg"
                startContent={
                  <HStack gap={2} vAlign="center">
                    <Icon icon={Globe} size="md" color="accent" />
                    <VStack gap={0}>
                      <Heading level={2}>{t("browser.title")}</Heading>
                      <Text type="supporting" color="secondary">
                        {state.busySessionIds.length > 0
                          ? t("browser.agentOperating")
                          : t("browser.sharedSession")}
                      </Text>
                    </VStack>
                  </HStack>
                }
                endContent={
                  <IconButton
                    label={t("browser.close")}
                    tooltip={t("browser.close")}
                    icon={<Icon icon={X} size="md" color="inherit" />}
                    variant="secondary"
                    size="lg"
                    onClick={() => browserSessionController.closePanel()}
                  />
                }
              />
              <BrowserTabs compact={compact} />
              <BrowserAddressBar compact={compact} />
              {state.error ? (
                <HStack width="100%" gap={2} vAlign="center" padding={2}>
                  <StackItem size="fill">
                    <Banner status="error" title={state.error} collapsible={false} />
                  </StackItem>
                  <IconButton
                    label={t("browser.dismissError")}
                    tooltip={t("browser.dismissError")}
                    icon={<Icon icon={X} size="sm" color="inherit" />}
                    variant="ghost"
                    size="sm"
                    onClick={() => browserSessionController.clearError()}
                  />
                </HStack>
              ) : null}
            </VStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={0} isScrollable={false} label={t("browser.title")}>
            <BrowserViewportSlot />
          </LayoutContent>
        }
      />
    </VStack>
  );
}
