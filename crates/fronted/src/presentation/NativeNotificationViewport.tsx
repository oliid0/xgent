import {
  Children,
  isValidElement,
  type ReactNode,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { type AppNotification, appNotifications } from "../components/astryx/appNotifications";
import { createNotificationLifetime } from "../components/astryx/notificationLifetime";
import { useLocale } from "../i18n";
import type { AppSettings } from "../lib/settings";
import { isApplePresentationRuntime } from "../runtime/applePresentation";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";

export function notificationText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value == null || typeof value === "boolean") return "";
  if (isValidElement<{ children?: ReactNode }>(value))
    return notificationText(value.props.children);
  return Children.toArray(value).map(notificationText).filter(Boolean).join("\n");
}

function NativeNotificationEntry(props: {
  entry: AppNotification;
  settings: AppSettings;
  nativeMobile: boolean;
}) {
  const { entry, settings, nativeMobile } = props,
    { t } = useLocale();
  const alive = useRef(true);
  const lifetime = useRef<ReturnType<typeof createNotificationLifetime> | null>(null);
  useEffect(() => {
    alive.current = true;
    const automatic = entry.options.isAutoHide ?? entry.options.type !== "error";
    const duration = entry.options.autoHideDuration ?? 5000;
    lifetime.current = automatic
      ? createNotificationLifetime(duration, () => {
          if (alive.current) appNotifications.dismiss(entry.id, "auto");
        })
      : null;
    return () => {
      alive.current = false;
      lifetime.current?.retire();
      lifetime.current = null;
    };
  }, [entry]);
  const c = presentationControls();
  c.handlers.set("notification:reading", {
    enabled: true,
    accepts: (value) => typeof value === "boolean",
    run: (value) => {
      if (alive.current) lifetime.current?.pause(value as boolean);
    },
  });
  const close = c.action("notification:dismiss", t("settings.close"), () => {
    if (alive.current) appNotifications.dismiss(entry.id);
  });
  return (
    <NativeSurface
      document={{
        mode: "toast",
        title: "",
        appearance: settings.theme,
        formFactor: nativeMobile ? "mobile" : "desktop",
        theme: createNativePresentationTheme(settings, nativeMobile),
        dismissAction: "notification:dismiss",
        readingAction: "notification:reading",
        nodes: [
          {
            id: "notification:message",
            kind: "Banner",
            variant: "toast",
            text: notificationText(entry.options.body),
            status: entry.options.type === "error" ? "error" : "completed",
            icon: entry.options.type === "error" ? "exclamationmark.circle" : "info.circle",
            children: [close],
          },
        ],
      }}
      handlers={c.handlers}
      onError={(error) => console.error("Native notification could not be displayed", error)}
    />
  );
}

export function NativeNotificationViewport(props: {
  settings: AppSettings;
  nativeMobile: boolean;
}) {
  const entries = useSyncExternalStore(
    appNotifications.subscribe,
    appNotifications.getSnapshot,
    appNotifications.getSnapshot,
  );
  if (!isApplePresentationRuntime()) return null;
  // Hidden notifications stay queued; their timer starts when they become visible.
  return (
    <>
      {entries.slice(-4).map((entry) => (
        <NativeNotificationEntry key={entry.id} entry={entry} {...props} />
      ))}
    </>
  );
}
