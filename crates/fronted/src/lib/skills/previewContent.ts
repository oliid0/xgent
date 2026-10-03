import type { SkillSummary } from "./index";

function normalizePreviewMetadataText(value: string) {
  return value
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripLeadingBlankLines(lines: string[]) {
  let index = 0;
  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }
  return lines.slice(index);
}

function stripReadmeDuplicateSummary(content: string, skill: SkillSummary) {
  const expectedName = normalizePreviewMetadataText(skill.name);
  const expectedDescription = normalizePreviewMetadataText(skill.description);
  let lines = stripLeadingBlankLines(content.split(/\r?\n/));

  if (lines.length > 0 && normalizePreviewMetadataText(lines[0]) === expectedName) {
    lines = stripLeadingBlankLines(lines.slice(1));
  }

  if (expectedDescription && lines.length > 0) {
    const paragraph: string[] = [];
    let index = 0;
    while (index < lines.length && lines[index].trim()) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (normalizePreviewMetadataText(paragraph.join(" ")) === expectedDescription) {
      lines = stripLeadingBlankLines(lines.slice(index));
    }
  }

  return lines.join("\n").trimStart();
}

const FRONTMATTER_PREVIEW_METADATA_KEYS = new Set(["name", "description"]);

function hasPreviewMetadataFrontmatterField(frontmatterBody: string) {
  return frontmatterBody.split(/\r?\n/).some((line) => {
    if (/^[ \t]/.test(line)) return false;
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:/);
    return match ? FRONTMATTER_PREVIEW_METADATA_KEYS.has(match[1].toLowerCase()) : false;
  });
}

function hasPreviewMetadataInlineFrontmatterField(frontmatterBody: string) {
  return Array.from(frontmatterBody.matchAll(/(?:^|\s)([A-Za-z0-9_-]+)\s*:/g)).some((match) =>
    FRONTMATTER_PREVIEW_METADATA_KEYS.has(match[1].toLowerCase()),
  );
}

function hasDisplayableFrontmatterContent(frontmatterBody: string) {
  return frontmatterBody.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

function stripFrontmatterPreviewMetadataFields(frontmatterBody: string) {
  const lines = frontmatterBody.split(/\r?\n/);
  const nextLines: string[] = [];
  let skippingMetadataField = false;

  for (const line of lines) {
    const isIndented = /^[ \t]/.test(line);
    const trimmed = line.trim();
    const keyMatch = isIndented ? null : line.match(/^([A-Za-z0-9_-]+)\s*:/);

    if (keyMatch) {
      skippingMetadataField = FRONTMATTER_PREVIEW_METADATA_KEYS.has(keyMatch[1].toLowerCase());
      if (skippingMetadataField) continue;
    } else if (skippingMetadataField) {
      if (trimmed === "" || isIndented) continue;
      skippingMetadataField = false;
    }

    nextLines.push(line);
  }

  return nextLines.join("\n").trim();
}

function stripInlineFrontmatterPreviewMetadataFields(frontmatterBody: string) {
  const matches = Array.from(frontmatterBody.matchAll(/(?:^|\s)([A-Za-z0-9_-]+)\s*:/g));
  if (matches.length === 0) return frontmatterBody.trim();

  const fields = matches.map((match, index) => {
    const rawIndex = match.index ?? 0;
    const startsWithSpace = /^\s/.test(match[0]);
    const start = rawIndex + (startsWithSpace ? 1 : 0);
    const end =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? frontmatterBody.length)
        : frontmatterBody.length;
    return {
      key: match[1].toLowerCase(),
      text: frontmatterBody.slice(start, end).trim(),
    };
  });

  return fields
    .filter((field) => !FRONTMATTER_PREVIEW_METADATA_KEYS.has(field.key))
    .map((field) => field.text)
    .join(" ")
    .trim();
}

function stripMarkdownSkillMetadata(content: string, skill: SkillSummary) {
  let next = content.replace(/^\uFEFF/, "");
  const frontmatter = next.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (frontmatter && hasPreviewMetadataFrontmatterField(frontmatter[1])) {
    const frontmatterBody = stripFrontmatterPreviewMetadataFields(frontmatter[1]);
    const rest = next.slice(frontmatter[0].length);
    next = hasDisplayableFrontmatterContent(frontmatterBody)
      ? `---\n${frontmatterBody}\n---\n${rest}`
      : rest;
  } else {
    const inlineFrontmatter = next.match(/^---[ \t]+([\s\S]*?)[ \t]+---[ \t]*/);
    if (inlineFrontmatter && hasPreviewMetadataInlineFrontmatterField(inlineFrontmatter[1])) {
      const frontmatterBody = stripInlineFrontmatterPreviewMetadataFields(inlineFrontmatter[1]);
      const rest = next.slice(inlineFrontmatter[0].length);
      next = frontmatterBody ? `--- ${frontmatterBody} --- ${rest}` : rest;
    }
  }
  return stripReadmeDuplicateSummary(next, skill);
}

function stripJsonSkillMetadata(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return content;
    const next = { ...(parsed as Record<string, unknown>) };
    delete next.name;
    delete next.description;
    return Object.keys(next).length > 0 ? JSON.stringify(next, null, 2) : "";
  } catch {
    return content;
  }
}

export function stripInstalledSkillPreviewMetadata(content: string, skill: SkillSummary) {
  if (/\.(md|mdx|markdown)$/i.test(skill.skillFile)) {
    return stripMarkdownSkillMetadata(content, skill);
  }
  if (/\.json$/i.test(skill.skillFile)) {
    return stripJsonSkillMetadata(content);
  }
  return content;
}
