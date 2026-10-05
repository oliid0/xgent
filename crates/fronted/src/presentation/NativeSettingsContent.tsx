import { useLayoutEffect, useRef } from "react";
import type { NativeSettingsContentSink } from "./nativeOtherContent";
import type { PresentationDocument, PresentationHandler } from "./types";

/** A section's primary content, owned by the surrounding Other page. */
export function NativeSettingsContent(props: {
  document: Omit<PresentationDocument, "surface" | "revision" | "version">;
  handlers: ReadonlyMap<string, PresentationHandler>;
  onError: (error: unknown) => void;
  sink?: NativeSettingsContentSink;
  detail?: boolean;
  sessionSurface?: string;
}) {
  const owner = useRef(Symbol("other-settings-content"));
  useLayoutEffect(() => {
    props.sink?.update(owner.current, {
      document: props.document,
      handlers: props.handlers,
      onError: props.onError,
      detail: props.detail === true,
    });
  }, [props.sink, props.document, props.handlers, props.onError, props.detail]);
  useLayoutEffect(() => {
    const sink = props.sink,
      token = owner.current;
    return () => sink?.remove(token);
  }, [props.sink]);
  return null;
}
