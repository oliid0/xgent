import { useState } from "react";

/** Visited conversations only; navigation still uses the shared chat controller. */
export function useNativeConversationNavigation(
  conversationId: string,
  available: () => ReadonlyMap<string, unknown>,
  select: (id: string) => void,
) {
  const [history] = useState(() => ({
    ids: [] as string[],
    index: -1,
    observed: "",
    requested: undefined as { id: string; index: number } | undefined,
    revision: 0,
  }));
  const [, publish] = useState(0);
  if (history.observed !== conversationId) {
    if (history.requested?.id === conversationId) {
      history.index = history.requested.index;
    } else {
      history.ids = [...history.ids.slice(0, history.index + 1), conversationId];
      history.index = history.ids.length - 1;
      // Bound window-local navigation without retaining conversation content.
      if (history.ids.length > 100) {
        history.ids.shift();
        history.index--;
      }
    }
    history.observed = conversationId;
    history.requested = undefined;
    history.revision++;
  }
  const revision = history.revision;
  const target = (direction: -1 | 1) => {
    const known = available();
    for (
      let index = history.index + direction;
      index >= 0 && index < history.ids.length;
      index += direction
    ) {
      if (known.has(history.ids[index]) && history.ids[index] !== conversationId)
        return { id: history.ids[index], index };
    }
    return undefined;
  };
  return {
    revision,
    canBack: !!target(-1),
    canForward: !!target(1),
    move(direction: -1 | 1) {
      if (history.revision !== revision || history.observed !== conversationId) return;
      const next = target(direction);
      if (!next) return;
      history.requested = next;
      history.revision++;
      try {
        select(next.id);
      } catch (error) {
        history.requested = undefined;
        throw error;
      } finally {
        publish((value) => value + 1);
      }
    },
  };
}
