import { Button } from "@astryxdesign/core/Button";
import { Code } from "@astryxdesign/core/Code";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";

import { useChangedFilesActions } from "../../../../components/chat/ChangedFilesCard";
import { useLocale } from "../../../../i18n";
import type {
  FileToolFieldPreview,
  FileToolPreview,
} from "../../../../lib/chat/messages/toolPreview";
import { EditDiffView } from "./EditDiffView";
import { MetaTags } from "./ToolResultDisplay";

// Streaming args display for the file-writing tools (Write / Edit /
// NotebookEdit): live-updating path, true char/line counts and a bounded
// content preview, all derived once by deriveFileToolPreview.

function StreamingArgPlaceholder({ label }: { label: string }) {
  return (
    <Section variant="transparent" paddingBlock={0.5} paddingInline={0}>
      <Text type="supporting" color="secondary">
        {label}
      </Text>
    </Section>
  );
}

function StreamingTextPreviewSurface({
  label,
  emptyLabel,
  preview,
}: {
  label: string;
  emptyLabel: string;
  preview: FileToolFieldPreview;
}) {
  return (
    <Section variant="muted" padding={2}>
      <VStack gap={1}>
        <Text type="supporting" color="secondary" weight="medium">
          {label}
        </Text>
        {preview.has ? (
          preview.text ? (
            <CodeBlock
              code={preview.text}
              language="text"
              size="sm"
              width="100%"
              maxHeight="var(--xgent-tool-preview-max-height)"
              container="section"
              isWrapped
            />
          ) : (
            <Text type="supporting" color="secondary">
              {emptyLabel}
            </Text>
          )
        ) : (
          <Text type="supporting" color="secondary">
            Waiting for {label}...
          </Text>
        )}
      </VStack>
    </Section>
  );
}

function PathSurface({ path }: { path: string }) {
  const { t } = useLocale();
  const onOpenFile = useChangedFilesActions()?.onOpenFile;
  const openLabel = `${t("chat.changedFiles.open")}: ${path}`;

  return (
    <Section variant="transparent" paddingBlock={0.5} paddingInline={0}>
      <VStack gap={1}>
        <Text type="supporting" color="secondary" weight="medium">
          path
        </Text>
        {onOpenFile ? (
          <Button
            label={path}
            tooltip={openLabel}
            variant="ghost"
            size="sm"
            width="100%"
            onClick={() => onOpenFile(path)}
          />
        ) : (
          <Code color="secondary">{path}</Code>
        )}
      </VStack>
    </Section>
  );
}

export function FileToolArgsDisplay({ preview }: { preview: FileToolPreview }) {
  if (preview.kind === "write") {
    if (!preview.path && !preview.content.has) {
      return <StreamingArgPlaceholder label="Waiting for file content..." />;
    }
    const fieldLabel = preview.field === "new_source" ? "new source" : "content";
    return (
      <VStack gap={2} className="tool-expand">
        {preview.path ? <PathSurface path={preview.path} /> : null}
        {preview.content.has ? (
          <MetaTags
            tags={[
              ...(preview.name === "Write" ? [{ label: "mode", value: "rewrite" }] : []),
              { label: "chars", value: String(preview.content.chars) },
              { label: "lines", value: String(preview.content.lines) },
              ...(preview.content.truncated ? [{ label: "preview", value: "partial" }] : []),
            ]}
          />
        ) : null}
        <StreamingTextPreviewSurface
          label={fieldLabel}
          emptyLabel={`(empty ${fieldLabel})`}
          preview={preview.content}
        />
      </VStack>
    );
  }

  if (!preview.path && !preview.oldString.has && !preview.newString.has) {
    return <StreamingArgPlaceholder label="Waiting for replacement strings..." />;
  }
  return (
    <VStack gap={2} className="tool-expand">
      {preview.path ? <PathSurface path={preview.path} /> : null}
      <MetaTags
        tags={[
          ...(typeof preview.expectedReplacements === "number"
            ? [{ label: "expected", value: String(preview.expectedReplacements) }]
            : []),
          ...(preview.replaceAll ? [{ label: "all", value: "true" }] : []),
          ...(preview.oldString.has
            ? [
                { label: "old", value: `${preview.oldString.chars} chars` },
                { label: "old lines", value: String(preview.oldString.lines) },
              ]
            : []),
          ...(preview.newString.has
            ? [
                { label: "new", value: `${preview.newString.chars} chars` },
                { label: "new lines", value: String(preview.newString.lines) },
              ]
            : []),
        ]}
      />
      {preview.oldString.has && preview.newString.has ? (
        <EditDiffView
          beforeText={preview.oldString.text}
          afterText={preview.newString.text}
          filePath={preview.path}
        />
      ) : (
        <>
          <StreamingTextPreviewSurface
            label="old string"
            emptyLabel="(empty old string)"
            preview={preview.oldString}
          />
          <StreamingTextPreviewSurface
            label="new string"
            emptyLabel="(empty replacement)"
            preview={preview.newString}
          />
        </>
      )}
    </VStack>
  );
}
