export const DOCUMENT_ANNOTATION_MAX_LENGTH = 12000;
export const DOCUMENT_ANNOTATION_MAX_PAGE = 2147483647;
export type DocumentAnnotationDraft = { text: string; page: number };

export function documentAnnotationFormat(path: string, mimeType: string): "pdf" | "pptx" | null {
  const mime = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (/\.pdf$/i.test(path) && mime === "application/pdf") return "pdf";
  if (
    /\.pptx$/i.test(path) &&
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
    return "pptx";
  return null;
}

export function hasAnnotationDraft(annotation: DocumentAnnotationDraft | undefined) {
  return !!annotation?.text.length;
}

export function validAnnotationPage(page: unknown): page is number {
  return (
    typeof page === "number" &&
    Number.isInteger(page) &&
    page >= 1 &&
    page <= DOCUMENT_ANNOTATION_MAX_PAGE
  );
}

export function boundedAnnotationText(text: string) {
  if (text.length <= DOCUMENT_ANNOTATION_MAX_LENGTH) return text;
  let count = 0;
  for (const character of text) {
    if (count + character.length > DOCUMENT_ANNOTATION_MAX_LENGTH) break;
    count += character.length;
  }
  return text.slice(0, count);
}

export function parseAnnotationDraft(value: unknown): DocumentAnnotationDraft | null {
  if (typeof value !== "string") return null;
  try {
    const draft = JSON.parse(value);
    if (
      !draft ||
      typeof draft.text !== "string" ||
      draft.text.length > DOCUMENT_ANNOTATION_MAX_LENGTH ||
      !validAnnotationPage(draft.page)
    )
      return null;
    return { text: draft.text, page: draft.page };
  } catch {
    return null;
  }
}

/** Only the submitted note is cleared; text/page edits during its write stay drafts. */
export function remainingAnnotationDraft(
  current: DocumentAnnotationDraft | undefined,
  written: DocumentAnnotationDraft | undefined,
) {
  return current && written && current.text === written.text && current.page === written.page
    ? { text: "", page: current.page }
    : current;
}
