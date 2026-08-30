import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Thumbnail } from "@astryxdesign/core/Thumbnail";
import { useMemo, useState } from "react";

import { ImagePreview, type ImagePreviewSlide } from "../../../components/chat/ImagePreview";
import { FileText } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  formatUploadedFileSize,
  type PendingUploadedFile,
} from "../../../lib/chat/messages/uploadedFiles";
import {
  copyImagePreviewSource,
  copyUploadedImagePreview,
  openUploadedImageInSystemViewer,
  prepareUploadedImagePreviewCopy,
  saveImagePreviewSource,
  supportsDirectUploadedImageCopy,
  supportsSystemImageOpen,
} from "../../../lib/system/imagePreview";
import { useUploadedImagePreview } from "./uploadedImagePreview";

function UserImageAttachment(props: {
  file: PendingUploadedFile;
  workspaceRoot?: string;
  compact: boolean;
  onRemove?: (relativePath: string) => void;
  previewLabel: string;
  closePreviewLabel: string;
}) {
  const { file, workspaceRoot, compact, onRemove, previewLabel, closePreviewLabel } = props;
  const [previewOpen, setPreviewOpen] = useState(false);
  const shouldLoad = Boolean(file.absolutePath?.trim());
  const { imageSrc, isLoading } = useUploadedImagePreview(
    shouldLoad ? file.absolutePath : undefined,
    workspaceRoot,
  );
  const previewSlides = useMemo<ImagePreviewSlide[]>(() => {
    if (!imageSrc) return [];
    const nativeRequest =
      workspaceRoot?.trim() && file.absolutePath?.trim()
        ? { workdir: workspaceRoot, absolutePath: file.absolutePath }
        : null;
    return [
      {
        src: imageSrc,
        alt: file.fileName,
        title: file.fileName,
        onPrepare:
          nativeRequest && supportsDirectUploadedImageCopy
            ? () => prepareUploadedImagePreviewCopy(nativeRequest)
            : undefined,
        onCopy:
          nativeRequest && supportsDirectUploadedImageCopy
            ? () => copyUploadedImagePreview(nativeRequest)
            : () => copyImagePreviewSource(imageSrc),
        onSave: () => saveImagePreviewSource(imageSrc, file.fileName),
        onOpen:
          nativeRequest && supportsSystemImageOpen
            ? () => openUploadedImageInSystemViewer(nativeRequest)
            : undefined,
      },
    ];
  }, [file.absolutePath, file.fileName, imageSrc, workspaceRoot]);
  const thumbnailWidth = compact ? "min(10rem, 32vw)" : "min(16rem, 70vw)";

  return (
    <VStack gap={0} style={{ width: thumbnailWidth, maxWidth: "100%" }}>
      <Thumbnail
        src={imageSrc || undefined}
        alt={file.fileName}
        label={`${previewLabel}: ${file.fileName}`}
        isLoading={isLoading}
        showRemoveOn="hover"
        onClick={imageSrc ? () => setPreviewOpen(true) : undefined}
        onRemove={onRemove ? () => onRemove(file.relativePath) : undefined}
        style={{ width: "100%" }}
      />
      {previewOpen ? (
        <ImagePreview
          open={previewOpen}
          slides={previewSlides}
          closeLabel={closePreviewLabel}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </VStack>
  );
}

function UserFileAttachment(props: {
  file: PendingUploadedFile;
  onRemove?: (relativePath: string) => void;
  onOpen?: (file: PendingUploadedFile) => void;
  removeLabel?: string;
}) {
  const { file, onRemove, onOpen, removeLabel } = props;
  return (
    <ListItem
      label={file.fileName}
      description={formatUploadedFileSize(file.sizeBytes)}
      startContent={<Icon icon={FileText} size="md" color="secondary" />}
      endContent={
        onRemove ? (
          <IconButton
            label={`${removeLabel ?? file.fileName}: ${file.fileName}`}
            tooltip={removeLabel}
            icon={<Icon icon="close" size="sm" color="inherit" />}
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(file.relativePath);
            }}
          />
        ) : undefined
      }
      onClick={onOpen ? () => onOpen(file) : undefined}
    />
  );
}

export function UserAttachmentCards(props: {
  files: PendingUploadedFile[];
  workspaceRoot?: string;
  onRemove?: (relativePath: string) => void;
  onOpen?: (file: PendingUploadedFile) => void;
}) {
  const { files, workspaceRoot, onRemove, onOpen } = props;
  const { t } = useLocale();
  if (files.length === 0) return null;

  const imageFiles = files.filter(
    (file) => file.kind === "image" && Boolean(file.absolutePath?.trim()),
  );
  const otherFiles = files.filter((file) => !imageFiles.includes(file));
  const removeLabel = onRemove ? t("chat.upload.removeFile") : undefined;

  return (
    <VStack gap={2} width="100%" hAlign="end">
      {imageFiles.length > 0 ? (
        <HStack gap={2} wrap="wrap" width="100%" hAlign="end">
          {imageFiles.map((file) => (
            <UserImageAttachment
              key={`${file.relativePath}-${file.absolutePath ?? file.fileName}`}
              file={file}
              workspaceRoot={workspaceRoot}
              compact={imageFiles.length > 1}
              onRemove={onRemove}
              previewLabel={t("chat.upload.previewImage")}
              closePreviewLabel={t("chat.upload.closePreview")}
            />
          ))}
        </HStack>
      ) : null}
      {otherFiles.length > 0 ? (
        <VStack width="min(24rem, 100%)">
          <List density="compact" hasDividers={otherFiles.length > 1}>
            {otherFiles.map((file) => (
              <UserFileAttachment
                key={`${file.relativePath}-${file.absolutePath ?? file.fileName}`}
                file={file}
                onRemove={onRemove}
                onOpen={onOpen}
                removeLabel={removeLabel}
              />
            ))}
          </List>
        </VStack>
      ) : null}
    </VStack>
  );
}
