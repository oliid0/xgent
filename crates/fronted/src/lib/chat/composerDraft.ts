import type {
  MentionComposerCommitMention,
  MentionComposerDraft,
  MentionComposerGitFileMention,
  MentionComposerLargePaste,
} from "../../components/chat/MentionComposer";
import {
  escapeMarkdownReferenceLabel,
  formatCodeMentionToken,
  formatFileMentionToken,
  formatMarkdownReferenceDestination,
} from "./messages/mentionReferences";
import {
  type PendingUploadedFile,
  withPastedTextDisplayMetadata,
} from "./messages/uploadedFiles";

export function buildPastedTextFileName(paste: MentionComposerLargePaste, index: number) {
  const baseName = paste.label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${baseName || `pasted-text-${index + 1}`}.txt`;
}

function formatCommitMention(commit: MentionComposerCommitMention) {
  const shortSha = commit.shortSha || commit.sha.slice(0, 7);
  const subject = commit.subject.trim() || shortSha;
  const label = `commit ${shortSha}: ${subject}`;
  return commit.githubUrl?.trim()
    ? `[${escapeMarkdownReferenceLabel(label)}](${formatMarkdownReferenceDestination(commit.githubUrl.trim())})`
    : `${label} (${commit.sha})`;
}

function formatGitFileMention(file: MentionComposerGitFileMention) {
  const refLabel = file.refName || file.shortSha || file.commitSha.slice(0, 7);
  const label = `git file ${refLabel}: ${file.path}`;
  return file.githubUrl?.trim()
    ? `[${escapeMarkdownReferenceLabel(label)}](${formatMarkdownReferenceDestination(file.githubUrl.trim())})`
    : `${label} (${file.commitSha})`;
}

export function buildTextFromComposerDraft(
  draft: MentionComposerDraft,
  pastedFileById?: Map<string, PendingUploadedFile>,
) {
  return draft.segments
    .map((segment) => {
      switch (segment.type) {
        case "text":
          return segment.text;
        case "fileMention":
          return formatFileMentionToken(segment.reference);
        case "skillMention":
          return `$${segment.skill.name}`;
        case "commitMention":
          return formatCommitMention(segment.commit);
        case "gitFileMention":
          return formatGitFileMention(segment.file);
        case "codeMention":
          return formatCodeMentionToken(segment.reference);
        case "largePaste": {
          const file = pastedFileById?.get(segment.paste.id);
          return file ? `[${segment.paste.label}: ${file.relativePath}]` : segment.paste.text;
        }
      }
    })
    .join("")
    .replace(/\u00A0/g, " ");
}

export function createTextComposerDraft(text: string): MentionComposerDraft {
  return {
    segments: text ? [{ type: "text", text }] : [],
    text,
    textWithoutLargePastes: text,
    largePastes: [],
    skillMentions: [],
    commitMentions: [],
    gitFileMentions: [],
    codeMentions: [],
    isEmpty: !text.trim(),
  };
}

export function validateImportedPastedTextFiles(
  pastes: MentionComposerLargePaste[],
  importedFiles: PendingUploadedFile[],
  skipped: string[],
) {
  if (importedFiles.length !== pastes.length) {
    const skippedDetails = skipped.length > 0 ? `\n${skipped.join("\n")}` : "";
    throw new Error(`部分大段粘贴内容未能导入工作区。${skippedDetails}`);
  }
  const files = importedFiles.map((file, index) => {
    const paste = pastes[index];
    return paste ? withPastedTextDisplayMetadata(file, paste) : file;
  });
  const fileByPasteId = new Map<string, PendingUploadedFile>();
  files.forEach((file, index) => {
    const paste = pastes[index];
    if (paste) fileByPasteId.set(paste.id, file);
  });
  return { files, fileByPasteId };
}
