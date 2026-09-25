import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  acknowledgeApplePresentation,
  publishApplePresentation,
  subscribeApplePresentation,
} from "../runtime/applePresentation";
import { createPresentationActionRegistry } from "./actionRegistry";
import { createPresentationDocumentChannel } from "./documentChannel";
import type { PresentationDocument, PresentationHandler } from "./types";
import { validatePresentationDocument } from "./validateDocument";

const actions = createPresentationActionRegistry();
const sessionChannels = new Map<string, ReturnType<typeof createPresentationDocumentChannel>>();
const sessionRevisions = new Map<string, number>();
const sessionRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
let subscriberCount = 0;
let unsubscribe: (() => void) | undefined;
let pageSession: string | undefined;

function nextSessionRevision(surface: string) {
  const revision = (sessionRevisions.get(surface) ?? 0) + 1;
  sessionRevisions.set(surface, revision);
  return revision;
}

function sessionChannel(surface: string) {
  let channel = sessionChannels.get(surface);
  if (!channel) {
    channel = createPresentationDocumentChannel(publishApplePresentation);
    sessionChannels.set(surface, channel);
  }
  return channel;
}

export function retainNativeSurfaceSession(surface: string) {
  const timer = sessionRemovalTimers.get(surface);
  if (timer) clearTimeout(timer);
  sessionRemovalTimers.delete(surface);
}

export function removeNativeSurfaceSession(surface: string, onError: (error: unknown) => void) {
  retainNativeSurfaceSession(surface);
  // React StrictMode replays effects on mount. Let the next setup cancel removal.
  sessionRemovalTimers.set(
    surface,
    setTimeout(() => {
      sessionRemovalTimers.delete(surface);
      actions.remove(surface);
      const channel = sessionChannels.get(surface);
      if (!channel) return;
      void channel
        .publish({
          version: 1,
          surface,
          revision: nextSessionRevision(surface),
          mode: "root",
          title: "",
          appearance: "system",
          nodes: [],
          removed: true,
        })
        .catch(onError)
        .finally(() => {
          sessionChannels.delete(surface);
          sessionRevisions.delete(surface);
        });
    }, 0),
  );
}

export function NativeSurface(props: {
  document: Omit<PresentationDocument, "surface" | "revision" | "version">;
  handlers: ReadonlyMap<string, PresentationHandler>;
  onError: (error: unknown) => void;
  sessionSurface?: string;
}) {
  const localId = useId();
  const [surface] = useState(() => {
    pageSession ??= crypto.randomUUID();
    return props.sessionSurface ?? `${pageSession}:${localId}`;
  });
  const [channel] = useState(() =>
    props.sessionSurface
      ? sessionChannel(props.sessionSurface)
      : createPresentationDocumentChannel(publishApplePresentation),
  );
  const revision = useRef(0);
  const onError = useRef(props.onError);
  onError.current = props.onError;

  useLayoutEffect(() => {
    if (subscriberCount++ === 0) {
      unsubscribe = subscribeApplePresentation((event) => {
        void actions
          .dispatch(event)
          .then(acknowledgeApplePresentation)
          .catch((error) => console.error("Native UI action acknowledgement failed", error));
      });
    }
    return () => {
      actions.remove(surface);
      if (--subscriberCount === 0) {
        unsubscribe?.();
        unsubscribe = undefined;
      }
    };
  }, [surface]);

  useLayoutEffect(() => {
    actions.register(surface, props.handlers);
    const document: PresentationDocument = {
      ...props.document,
      version: 1,
      surface,
      revision: props.sessionSurface ? nextSessionRevision(surface) : ++revision.current,
    };
    validatePresentationDocument(document, props.handlers);
    void channel.publish(document).catch((error) => onError.current(error));
  }, [surface, props.document, props.handlers, channel]);

  useLayoutEffect(() => {
    if (props.sessionSurface) return;
    return () => {
      void channel
        .publish({
          version: 1,
          surface,
          revision: ++revision.current,
          mode: "root",
          title: "",
          appearance: "system",
          nodes: [],
          removed: true,
        })
        .catch((error) => onError.current(error));
    };
  }, [surface, channel, props.sessionSurface]);

  return null;
}
