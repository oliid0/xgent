import { init } from "pptx-preview";
import { useEffect, useRef, useState } from "react";

export function WorkspacePresentationPreview({ bytes }: { bytes: Uint8Array }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    // Each load owns its DOM so late completion cannot overwrite the next file.
    const surface = document.createElement("div");
    container.replaceChildren(surface);
    const fit = () => {
      surface.style.zoom = String(Math.min(1, Math.max(0.1, container.clientWidth / 960)));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    fit();
    const previewer = init(surface, { width: 960, height: 540, mode: "slide" });
    setBusy(true);
    setError("");
    void previewer
      .preview(bytes.slice().buffer)
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      })
      .finally(() => {
        if (!disposed) setBusy(false);
        else previewer.destroy();
      });
    return () => {
      disposed = true;
      observer.disconnect();
      previewer.destroy();
      surface.remove();
    };
  }, [bytes]);
  return (
    <div className="workspace-document-pages" aria-busy={busy}>
      {busy ? <p role="status">…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div ref={host} />
    </div>
  );
}
