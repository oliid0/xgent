import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  acknowledgeApplePresentation,
  publishApplePresentation,
  subscribeApplePresentation,
} from "../runtime/applePresentation";
import { createPresentationActionRegistry } from "./actionRegistry";
import { createPresentationDocumentChannel } from "./documentChannel";
import type { PresentationDocument, PresentationHandler } from "./types";

const actions = createPresentationActionRegistry();
let subscriberCount = 0;
let unsubscribe: (() => void) | undefined;
let pageSession: string | undefined;

export function NativeSurface(props: {
  document: Omit<PresentationDocument, "surface" | "revision" | "version">;
  handlers: ReadonlyMap<string, PresentationHandler>;
  onError: (error: unknown) => void;
}) {
  const localId = useId();
  const [surface] = useState(() => {
    pageSession ??= crypto.randomUUID();
    return `${pageSession}:${localId}`;
  });
  const [channel] = useState(() => createPresentationDocumentChannel(publishApplePresentation));
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
      revision: ++revision.current,
    };
    void channel.publish(document).catch((error) => onError.current(error));
  }, [surface, props.document, props.handlers, channel]);

  useLayoutEffect(() => {
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
  }, [surface, channel]);

  return null;
}
