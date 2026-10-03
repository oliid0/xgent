import { useEffect, useState } from "react";
import type { SttSettings } from "../../lib/settings";
import { desktopSttSettingsService } from "../../lib/stt/desktopSttSettingsService";

// A response belongs to the exact provider configuration that started it.
// Editing credentials or closing Settings retires that feedback immediately.
export function useSttConnectionTest(configuration: SttSettings, t: (key: string) => string) {
  const [scope] = useState(() => ({
    configuration,
    active: true,
    busy: false,
    revision: 0,
    flight: 0,
  }));
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{
    configuration: SttSettings;
    ok: boolean;
    message: string;
  } | null>(null);
  if (scope.configuration !== configuration) {
    scope.configuration = configuration;
    scope.revision++;
  }
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.revision++;
      scope.flight++;
      scope.busy = false;
    };
  }, [scope]);

  async function testConnection() {
    if (!scope.active || scope.busy || scope.configuration !== configuration) return;
    scope.busy = true;
    const flight = ++scope.flight;
    const revision = ++scope.revision;
    const current = () =>
      scope.active && scope.revision === revision && scope.configuration === configuration;
    setTesting(true);
    setFeedback(null);
    try {
      await desktopSttSettingsService.update(configuration);
      if (!current()) return;
      const result = await desktopSttSettingsService.test(configuration.provider);
      if (current())
        setFeedback({
          configuration,
          ok: result.result === "connected" || result.result === "connected_no_speech",
          message: result.message || t(`settings.stt.test.${result.result}`),
        });
    } catch (cause) {
      if (current())
        setFeedback({
          configuration,
          ok: false,
          message: cause instanceof Error ? cause.message : String(cause),
        });
    } finally {
      // A retired operation still releases its lock, without touching a closed UI.
      if (scope.flight === flight) {
        scope.busy = false;
        if (scope.active) setTesting(false);
      }
    }
  }

  return {
    testing,
    testResult: feedback?.configuration === configuration ? feedback : null,
    testConnection,
    clearFeedback: () => {
      scope.revision++;
      setFeedback(null);
    },
  };
}
