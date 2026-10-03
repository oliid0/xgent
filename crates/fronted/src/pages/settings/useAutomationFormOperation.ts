import { useEffect, useState } from "react";

// Native navigation may retire a form while validation or persistence is
// pending. Persist dispatched changes, but never close a replacement screen.
export function useAutomationFormOperation() {
  const [isSaving, setIsSaving] = useState(false);
  const [scope] = useState(() => ({ active: true, busy: false, revision: 0 }));
  useEffect(() => {
    scope.active = true;
    scope.busy = false;
    setIsSaving(false);
    return () => {
      scope.active = false;
      scope.busy = false;
      scope.revision++;
    };
  }, [scope]);
  function begin() {
    if (!scope.active || scope.busy) return null;
    scope.busy = true;
    const revision = ++scope.revision;
    setIsSaving(true);
    return () => scope.active && scope.revision === revision;
  }
  function finish(current: () => boolean) {
    if (!current()) return;
    scope.busy = false;
    setIsSaving(false);
  }
  return { isSaving, begin, finish };
}
