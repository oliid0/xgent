import type { Message, UserMessage } from "@earendil-works/pi-ai";

import { createUuid } from "../../shared/id";
import { normalizeLogicalLineEndings } from "./composerText";

export type UploadedReadableFileKind =
  | "text"
  | "image"
  | "pdf"
  | "notebook"
  | "word"
  | "spreadsheet"
  | "archive";

const UPLOADED_READABLE_FILE_KINDS = new Set<string>([
  "text",
  "image",
  "pdf",
  "notebook",
  "word",
  "spreadsheet",
  "archive",
]);

const DISPLAY_CONTENT_FIELD = "xgentDisplayContent";
const ATTACHMENTS_FIELD = "xgentAttachments";
const TIME_ZONE_FIELD = "xgentTimeZone";

function createUserMessageId() {
  return `user-${createUuid()}`;
}

export type PendingUploadedFile = {
  relativePath: string;
  absolutePath?: string;
  fileName: string;
  kind: UploadedReadableFileKind;
  sizeBytes: number;
  localSource?: LocalAttachmentSource | null;
  displayMode?: "largePaste";
  displayLabel?: string;
  displayCharCount?: number;
  displayLineCount?: number;
};

export type LocalAttachmentSource = {
  version: 1;
  workdir: string;
  path: string;
  bytes: number;
  contentHash: string;
};

function readLocalAttachmentSource(value: unknown): LocalAttachmentSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as LocalAttachmentSource;
  if (
    source.version !== 1 ||
    [source.workdir, source.path].some(
      (path) =>
        typeof path !== "string" || !path.trim() || new TextEncoder().encode(path).length > 4096,
    ) ||
    !Number.isSafeInteger(source.bytes) ||
    source.bytes < 0 ||
    source.bytes > 8 * 1024 * 1024 ||
    typeof source.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.contentHash)
  )
    return null;
  return {
    version: 1,
    workdir: source.workdir,
    path: source.path,
    bytes: source.bytes,
    contentHash: source.contentHash,
  };
}

export type PastedTextDisplayReference = {
  raw: string;
  label: string;
  relativePath: string;
  start: number;
  end: number;
};

const PASTED_TEXT_DISPLAY_REFERENCE_RE = /\[(Pasted text \d+):\s*([^\]\r\n]+)]/g;

export type UploadedUserMessage = UserMessage & {
  id: string;
  [DISPLAY_CONTENT_FIELD]?: string;
  [ATTACHMENTS_FIELD]?: PendingUploadedFile[];
  [TIME_ZONE_FIELD]?: string;
};

export function mergePendingUploadedFiles(
  current: PendingUploadedFile[],
  incoming: PendingUploadedFile[],
) {
  const merged = new Map<string, PendingUploadedFile>();
  for (const file of current) {
    merged.set(file.relativePath, file);
  }
  for (const file of incoming) {
    merged.set(file.relativePath, file);
  }
  return Array.from(merged.values());
}

function clonePendingUploadedFiles(files: PendingUploadedFile[]) {
  return files.map((file) => ({ ...file }));
}

export function withPastedTextDisplayMetadata(
  file: PendingUploadedFile,
  paste: { label: string; charCount: number; lineCount: number },
): PendingUploadedFile {
  return {
    ...file,
    displayMode: "largePaste",
    displayLabel: paste.label,
    displayCharCount: paste.charCount,
    displayLineCount: paste.lineCount,
  };
}

export function isPastedTextDisplayFile(file: PendingUploadedFile) {
  return file.displayMode === "largePaste";
}

export function parsePastedTextDisplayReferences(text: string): PastedTextDisplayReference[] {
  if (!text.trim()) return [];

  const references: PastedTextDisplayReference[] = [];
  for (const match of text.matchAll(PASTED_TEXT_DISPLAY_REFERENCE_RE)) {
    const raw = match[0] ?? "";
    const label = (match[1] ?? "").trim();
    const relativePath = (match[2] ?? "").trim();
    const start = match.index ?? -1;
    if (!raw || !label || !relativePath || start < 0) continue;
    references.push({
      raw,
      label,
      relativePath,
      start,
      end: start + raw.length,
    });
  }
  return references;
}

export function buildUploadedFilesInstruction(files: PendingUploadedFile[]) {
  const lines = files
    .filter((file) => typeof file.absolutePath === "string" && file.absolutePath.trim())
    .map((file) => `- ${file.absolutePath} (${file.kind})`);
  if (lines.length === 0) return "";
  return [
    "The user attached the files below to this message.",
    "Use Read with these exact paths before analyzing or modifying them:",
    ...lines,
  ].join("\n");
}

export function buildUserMessageContentWithUploads(userText: string, files: PendingUploadedFile[]) {
  const normalizedText = normalizeLogicalLineEndings(userText);
  if (files.length === 0) return normalizedText;

  const instruction = buildUploadedFilesInstruction(files);
  if (!instruction) return normalizedText;
  if (!normalizedText.trim()) {
    return `Please inspect the selected files first.\n\n${instruction}`;
  }
  return `${normalizedText}\n\n${instruction}`;
}

export function createUserMessageWithUploads(
  userText: string,
  files: PendingUploadedFile[],
  timestamp = Date.now(),
): UploadedUserMessage | null {
  const content = buildUserMessageContentWithUploads(userText, files);
  if (!content.trim()) return null;

  const message: UploadedUserMessage = {
    role: "user",
    id: createUserMessageId(),
    content,
    timestamp,
  };
  try {
    message[TIME_ZONE_FIELD] = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Missing zone stays unknown; a later executor must not supply its own.
  }
  if (files.length > 0) {
    message[DISPLAY_CONTENT_FIELD] = normalizeLogicalLineEndings(userText);
    message[ATTACHMENTS_FIELD] = clonePendingUploadedFiles(files);
  }
  return message;
}

function flattenUserContent(content: Message["content"] | undefined) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  let text = "";
  for (const block of content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

export function getUserMessageDisplayText(
  message: Pick<Message, "role" | "content"> & Record<string, unknown>,
) {
  const displayContent = message[DISPLAY_CONTENT_FIELD];
  if (typeof displayContent === "string") {
    return displayContent;
  }
  return flattenUserContent(message.content);
}

export function getUserMessageAttachments(
  message: Pick<Message, "role"> & Record<string, unknown>,
) {
  const raw = message[ATTACHMENTS_FIELD];
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const file = item as Record<string, unknown>;
    if (
      typeof file.relativePath !== "string" ||
      typeof file.fileName !== "string" ||
      typeof file.kind !== "string" ||
      typeof file.sizeBytes !== "number"
    ) {
      return [];
    }
    const pendingFile: PendingUploadedFile = {
      relativePath: file.relativePath,
      fileName: file.fileName,
      kind: UPLOADED_READABLE_FILE_KINDS.has(file.kind)
        ? (file.kind as UploadedReadableFileKind)
        : "text",
      sizeBytes: file.sizeBytes,
    };
    if (typeof file.absolutePath === "string" && file.absolutePath.trim()) {
      pendingFile.absolutePath = file.absolutePath;
    }
    if (Object.hasOwn(file, "localSource")) {
      // Preserve invalid provenance as an explicit failure sentinel. Never
      // silently replace a claimed local copy with a coincident remote path.
      pendingFile.localSource = readLocalAttachmentSource(file.localSource);
    }
    if (file.displayMode === "largePaste") {
      pendingFile.displayMode = "largePaste";
    }
    if (typeof file.displayLabel === "string" && file.displayLabel.trim()) {
      pendingFile.displayLabel = file.displayLabel;
    }
    if (typeof file.displayCharCount === "number" && Number.isFinite(file.displayCharCount)) {
      pendingFile.displayCharCount = file.displayCharCount;
    }
    if (typeof file.displayLineCount === "number" && Number.isFinite(file.displayLineCount)) {
      pendingFile.displayLineCount = file.displayLineCount;
    }
    return [pendingFile];
  });
}

export function stripUploadedFilesMessageMetadata(message: Message): Message {
  if (message.role !== "user") return message;
  const userMessage = message as Message & Record<string, unknown>;
  if (
    !(DISPLAY_CONTENT_FIELD in userMessage) &&
    !(ATTACHMENTS_FIELD in userMessage) &&
    !(TIME_ZONE_FIELD in userMessage)
  ) {
    return message;
  }

  const next = { ...userMessage };
  delete next[DISPLAY_CONTENT_FIELD];
  delete next[ATTACHMENTS_FIELD];
  delete next[TIME_ZONE_FIELD];
  return next as Message;
}

/** Execution-only attachment mapping; never rewrite saved history or image blocks. */
export function remapUploadedFilesMessage(
  message: Message,
  resolve: (file: PendingUploadedFile) => PendingUploadedFile,
): Message {
  if (message.role !== "user") return message;
  const files = getUserMessageAttachments(message as Message & Record<string, unknown>);
  if (!files.length) return message;
  const mapped = files.map(resolve);
  const previousInstruction = buildUploadedFilesInstruction(files);
  const instruction = buildUploadedFilesInstruction(mapped);
  const displayText = (message as Message & Record<string, unknown>)[DISPLAY_CONTENT_FIELD];
  const generatedContent =
    typeof displayText === "string"
      ? buildUserMessageContentWithUploads(displayText, files)
      : undefined;
  let replacements = 0;
  const mapText = (text: string) => {
    // Memory/skill updates can follow the generated content. Locate the
    // original body by its persisted display text, leaving injected text intact.
    const prefixLength =
      generatedContent !== undefined
        ? text.startsWith(generatedContent) &&
          (text.length === generatedContent.length ||
            text.slice(generatedContent.length).startsWith("\n\n"))
          ? generatedContent.length
          : -1
        : previousInstruction && text.endsWith(previousInstruction)
          ? text.length
          : -1;
    if (prefixLength < 0) return text;
    let next = text.slice(0, prefixLength);
    const suffix = text.slice(prefixLength);
    if (previousInstruction) {
      next = next.slice(0, -previousInstruction.length) + instruction;
      replacements++;
    }
    // Rewrite only generated paste references matched by persisted metadata.
    for (const reference of parsePastedTextDisplayReferences(next).reverse()) {
      const index = files.findIndex(
        (file) => file.displayMode === "largePaste" && file.relativePath === reference.relativePath,
      );
      if (index >= 0)
        next = `${next.slice(0, reference.start)}[${reference.label}: ${mapped[index].relativePath}]${next.slice(reference.end)}`;
    }
    return next + suffix;
  };
  let content =
    typeof message.content === "string"
      ? mapText(message.content)
      : message.content.map((block) =>
          block.type === "text" ? { ...block, text: mapText(block.text) } : block,
        );
  if (previousInstruction && replacements !== 1)
    throw new Error("Attachment instructions could not be mapped without changing message content");
  if (!previousInstruction && instruction) {
    content =
      typeof content === "string"
        ? `${content}\n\n${instruction}`
        : [...content, { type: "text", text: instruction }];
  }
  return { ...message, content, [ATTACHMENTS_FIELD]: mapped } as Message;
}

export function formatUploadedFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  if (sizeBytes >= 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${sizeBytes} B`;
}
