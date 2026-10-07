import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  TextLayer,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import {
  PDF_HIGHLIGHT_COLORS,
  type PdfHighlight,
  type PdfHighlightColor,
} from "./workspacePdfHighlights";

import { pdfSelectionRectangles } from "./workspacePdfSelection";

GlobalWorkerOptions.workerSrc = workerUrl;

/** One page at a time bounds canvas memory even for very long documents. */
export function WorkspacePdfPreview({
  bytes,
  title,
  highlights = [],
  editable = false,
  disabled = false,
  onHighlightsChange,
}: {
  bytes: Uint8Array;
  title: string;
  highlights?: PdfHighlight[];
  editable?: boolean;
  disabled?: boolean;
  onHighlightsChange?: (highlights: PdfHighlight[]) => void;
}) {
  const { t } = useLocale();
  const canvas = useRef<HTMLCanvasElement>(null);
  const textContainer = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<ReturnType<PDFPageProxy["getViewport"]> | null>(null);
  const [selectionRects, setSelectionRects] = useState<PdfHighlight["rects"]>([]);
  const [color, setColor] = useState<PdfHighlightColor>("yellow");
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
    setViewport(null);
    setSelectionRects([]);
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
    setSelectionRects([]);
    setText("");
    setAnnotations([]);
    setError("");
    void pdf
      .getPage(page)
      .then(async (documentPage) => {
        const target = canvas.current;
        if (disposed || !target) return;
        const nextViewport = documentPage.getViewport({ scale: zoom });
        const ratio = Math.min(devicePixelRatio || 1, 2);
        target.width = Math.ceil(nextViewport.width * ratio);
        target.height = Math.ceil(nextViewport.height * ratio);
        target.style.width = `${nextViewport.width}px`;
        target.style.height = `${nextViewport.height}px`;
        setViewport(nextViewport);
        const task = documentPage.render({
          canvas: target,
          viewport: nextViewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        cancel = () => task.cancel();
        await task.promise;
        const content = await documentPage.getTextContent();
        if (disposed) return;
        const layer = textContainer.current;
        if (layer) {
          layer.replaceChildren();
          layer.style.setProperty("--total-scale-factor", String(nextViewport.scale));
          const textLayer = new TextLayer({
            textContentSource: content,
            container: layer,
            viewport: nextViewport,
          });
          cancel = () => {
            task.cancel();
            textLayer.cancel();
          };
          await textLayer.render();
        }
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
  useEffect(() => {
    const readSelection = () => {
      const layer = textContainer.current;
      setSelectionRects(
        busy || !viewport || !layer
          ? []
          : pdfSelectionRectangles(layer, viewport, window.getSelection()),
      );
    };
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [viewport, busy]);
  return (
    <div className="workspace-pdf-preview">
      <HStack gap={2} vAlign="center" wrap="wrap" padding={2}>
        <Button
          label={t("workspaceFilePreview.previousPage")}
          variant="ghost"
          size="sm"
          isDisabled={!pdf || page <= 1}
          onClick={() => setPage(page - 1)}
        />
        <span aria-live="polite">
          {page} / {pdf?.numPages ?? "…"}
        </span>
        <Button
          label={t("workspaceFilePreview.nextPage")}
          variant="ghost"
          size="sm"
          isDisabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        />
        <Selector
          label={t("workspaceFilePreview.zoom")}
          isLabelHidden
          value={String(zoom)}
          size="sm"
          variant="ghost"
          width={100}
          options={[0.5, 0.75, 1, 1.5, 2].map((value) => ({
            value: String(value),
            label: `${value * 100}%`,
          }))}
          onChange={(value) => setZoom(Number(value))}
        />
        {editable && onHighlightsChange ? (
          <>
            <Selector
              label={t("workspaceFilePreview.pdfColor")}
              isDisabled={disabled}
              isLabelHidden
              value={color}
              size="sm"
              variant="ghost"
              width={110}
              options={Object.keys(PDF_HIGHLIGHT_COLORS).map((value) => ({
                value,
                label: t(
                  `workspaceFilePreview.pdf${value[0].toUpperCase()}${value.slice(1)}` as "workspaceFilePreview.pdfYellow",
                ),
              }))}
              onChange={(value) => setColor(value as PdfHighlightColor)}
            />
            <Button
              label={t("workspaceFilePreview.pdfHighlight")}
              size="sm"
              variant="ghost"
              isDisabled={disabled || busy || !selectionRects.length || highlights.length >= 512}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                if (disabled || !selectionRects.length || busy) return;
                onHighlightsChange([
                  ...highlights,
                  { id: crypto.randomUUID(), pageIndex: page - 1, rects: selectionRects, color },
                ]);
                window.getSelection()?.removeAllRanges();
                setSelectionRects([]);
              }}
            />
            <Button
              label={t("workspaceEditor.context.undo")}
              size="sm"
              variant="ghost"
              isDisabled={disabled || !highlights.length}
              onClick={() => onHighlightsChange(highlights.slice(0, -1))}
            />
          </>
        ) : null}
        {busy ? <span role="status">…</span> : null}
      </HStack>
      {error ? <p role="alert">{error}</p> : null}
      <div className="workspace-document-pages" aria-busy={busy}>
        <div
          className="workspace-pdf-page"
          style={viewport ? { width: viewport.width, height: viewport.height } : undefined}
        >
          <canvas ref={canvas} role="img" aria-label={`${title}, page ${page}`} />
          <div className="workspace-pdf-highlights" aria-hidden="true">
            {viewport
              ? highlights
                  .filter((entry) => entry.pageIndex === page - 1)
                  .flatMap((entry) =>
                    entry.rects.map(([x, y, width, height], index) => {
                      const bounds = [
                        ...viewport.convertToViewportPoint(x, y),
                        ...viewport.convertToViewportPoint(x + width, y + height),
                      ];
                      return (
                        <span
                          key={`${entry.id}:${index}`}
                          style={{
                            left: Math.min(bounds[0], bounds[2]),
                            top: Math.min(bounds[1], bounds[3]),
                            width: Math.abs(bounds[2] - bounds[0]),
                            height: Math.abs(bounds[3] - bounds[1]),
                            background: `rgb(${PDF_HIGHLIGHT_COLORS[entry.color].map((channel) => channel * 255).join(" ")} / 40%)`,
                          }}
                        />
                      );
                    }),
                  )
              : null}
          </div>
          <div ref={textContainer} className="workspace-pdf-text" />
        </div>
        {annotations.map((note) => (
          <p key={note.id} className="workspace-pdf-note">
            {note.text}
          </p>
        ))}
        {text ? (
          <details>
            <summary>{t("workspaceFilePreview.pageText")}</summary>
            <p>{text}</p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
