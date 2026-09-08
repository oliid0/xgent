import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

GlobalWorkerOptions.workerSrc = workerUrl;

/** One page at a time bounds canvas memory even for very long documents. */
export function WorkspacePdfPreview({ bytes, title }: { bytes: Uint8Array; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [text, setText] = useState("");
  const [annotations, setAnnotations] = useState<Array<{ id: string; text: string }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let disposed = false;
    setPdf(null);
    setPage(1);
    setError("");
    setBusy(true);
    const resources = new URL(
      import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : `${import.meta.env.BASE_URL}pdfjs/`,
      window.location.href,
    ).href;
    const task = getDocument({
      data: bytes.slice(),
      cMapUrl: `${resources}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${resources}standard_fonts/`,
      wasmUrl: `${resources}wasm/`,
      iccUrl: `${resources}iccs/`,
    });
    void task.promise
      .then((document) => {
        if (!disposed) setPdf(document);
      })
      .catch((reason) => {
        if (!disposed) {
          setError(String(reason));
          setBusy(false);
        }
      });
    return () => {
      disposed = true;
      void task.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    if (!pdf) return;
    let disposed = false;
    let cancel = () => {};
    setBusy(true);
    setText("");
    setAnnotations([]);
    setError("");
    void pdf
      .getPage(page)
      .then(async (documentPage) => {
        const target = canvas.current;
        if (disposed || !target) return;
        const viewport = documentPage.getViewport({
          scale: zoom * Math.min(devicePixelRatio || 1, 2),
        });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        target.style.width = `${viewport.width / Math.min(devicePixelRatio || 1, 2)}px`;
        const task = documentPage.render({ canvas: target, viewport });
        cancel = () => task.cancel();
        await task.promise;
        const content = await documentPage.getTextContent();
        const notes = await documentPage.getAnnotations();
        if (!disposed)
          setAnnotations(
            notes
              .filter((note) => note.contentsObj?.str)
              .map((note) => ({ id: note.id, text: note.contentsObj.str })),
          );
        if (!disposed)
          setText(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
      cancel();
    };
  }, [pdf, page, zoom]);
  return (
    <div className="workspace-pdf-preview">
      <div className="workspace-document-toolbar">
        <button
          type="button"
          disabled={!pdf || page <= 1}
          onClick={() => setPage(page - 1)}
          aria-label="Previous page"
        >
          ←
        </button>
        <span aria-live="polite">
          {page} / {pdf?.numPages ?? "…"}
        </span>
        <button
          type="button"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
          aria-label="Next page"
        >
          →
        </button>
        <select
          aria-label="Zoom"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        >
          {[0.5, 0.75, 1, 1.5, 2].map((value) => (
            <option key={value} value={value}>
              {value * 100}%
            </option>
          ))}
        </select>
        {busy ? <span role="status">…</span> : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="workspace-document-pages" aria-busy={busy}>
        <canvas ref={canvas} role="img" aria-label={`${title}, page ${page}`} />
        {annotations.map((note) => (
          <p key={note.id} className="workspace-pdf-note">
            {note.text}
          </p>
        ))}
        {text ? (
          <details>
            <summary>Page text</summary>
            <p>{text}</p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
