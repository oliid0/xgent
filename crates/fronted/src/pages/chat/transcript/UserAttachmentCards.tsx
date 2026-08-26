import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Inline as AstryxInline, View as AstryxView } from "@xagent/ui/components/ui/view";
import { useMemo, useState } from "react";
import { ImagePreview, type ImagePreviewSlide } from "../../../components/chat/ImagePreview";
import { File, FileText, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  formatUploadedFileSize,
  type PendingUploadedFile,
} from "../../../lib/chat/messages/uploadedFiles";
import { cn } from "../../../lib/shared/utils";
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

function UserImageAttachmentCard({
  file,
  workspaceRoot,
  imageSrc,
  isLoading,
  compact,
  onRemove,
  removeLabel,
  previewLabel,
  closePreviewLabel,
}: {
  file: PendingUploadedFile;
  workspaceRoot?: string;
  imageSrc: string | null;
  isLoading: boolean;
  compact: boolean;
  onRemove?: ((relativePath: string) => void) | undefined;
  removeLabel?: string;
  previewLabel: string;
  closePreviewLabel: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const labeledPreview = `${previewLabel}: ${file.fileName}`;
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
  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      title={file.relativePath}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-white/60 bg-white/75 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:border-white/[0.12] dark:bg-white/[0.06]",
        compact ? "min-w-0 basis-[calc(33.333%-5.33px)] grow" : "w-full max-w-[280px]",
      )}
    >
      {onRemove ? (
        <AstryxButton
          type="button"
          onClick={() => onRemove(file.relativePath)}
          className="absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/30 text-white/90 opacity-0 backdrop-blur-sm transition-all hover:bg-black/45 group-hover:opacity-100"
          aria-label={removeLabel ?? file.fileName}
          title={removeLabel}
        >
          <X className="h-3 w-3" />
        </AstryxButton>
      ) : null}
      {imageSrc ? (
        <>
          <AstryxButton
            type="button"
            className="block w-full cursor-zoom-in overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            aria-label={labeledPreview}
            title={labeledPreview}
            onClick={() => setPreviewOpen(true)}
          >
            <img
              src={imageSrc}
              alt={file.fileName}
              className={cn(
                "w-full bg-black/[0.02] transition-transform hover:scale-[1.01] dark:bg-white/5",
                compact ? "h-28 object-cover" : "max-h-56 object-contain",
              )}
            />
          </AstryxButton>
          {previewOpen ? (
            <ImagePreview
              open={previewOpen}
              slides={previewSlides}
              closeLabel={closePreviewLabel}
              onClose={() => setPreviewOpen(false)}
            />
          ) : null}
        </>
      ) : (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className={cn(
            "flex w-full items-center justify-center bg-black/[0.02] dark:bg-white/5",
            compact ? "h-28" : "h-36",
          )}
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className={
              isLoading
                ? "h-16 w-16 animate-pulse rounded-xl bg-black/5 dark:bg-white/10"
                : "flex h-10 w-10 items-center justify-center rounded-xl bg-black/[0.03] dark:bg-white/10"
            }
          >
            {isLoading ? null : <File className="h-5 w-5 opacity-40" />}
          </AstryxView>
        </AstryxView>
      )}
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex items-center gap-1.5 px-2.5 py-1.5"
      >
        <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
          <AstryxView
            layout="block"
            direction="horizontal"
            className="truncate text-xs font-medium leading-tight text-primary/85"
          >
            {file.fileName}
          </AstryxView>
        </AstryxView>
        <AstryxInline className="shrink-0 text-2xs tabular-nums text-primary/40">
          {formatUploadedFileSize(file.sizeBytes)}
        </AstryxInline>
      </AstryxView>
    </AstryxView>
  );
}

function UserFileAttachmentCard({
  file,
  onRemove,
  removeLabel,
  compact,
}: {
  file: PendingUploadedFile;
  onRemove?: ((relativePath: string) => void) | undefined;
  removeLabel?: string;
  compact: boolean;
}) {
  return (
    <AstryxView
      layout="flex"
      direction="horizontal"
      title={file.relativePath}
      className={cn(
        "group relative flex items-center gap-2 rounded-xl border border-white/60 bg-white/75 px-2.5 py-2 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)] dark:border-white/[0.12] dark:bg-white/[0.06]",
        compact ? "min-w-0 basis-[calc(33.333%-5.33px)] grow" : "w-full",
      )}
    >
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-black/[0.03] to-black/[0.06] dark:from-white/[0.06] dark:to-white/[0.1]"
      >
        <FileText className="h-4 w-4 text-primary/45" />
      </AstryxView>
      <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
        <AstryxView
          layout="block"
          direction="horizontal"
          className="truncate text-xs font-medium leading-tight text-primary/85"
        >
          {file.fileName}
        </AstryxView>
        <AstryxView
          layout="block"
          direction="horizontal"
          className="mt-0.5 text-2xs tabular-nums leading-tight text-primary/40"
        >
          {formatUploadedFileSize(file.sizeBytes)}
        </AstryxView>
      </AstryxView>
      {onRemove ? (
        <AstryxButton
          type="button"
          onClick={() => onRemove(file.relativePath)}
          className="absolute top-1/2 right-1.5 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-primary/30 opacity-0 transition-all hover:bg-overlay-hover hover:text-primary/60 group-hover:opacity-100"
          aria-label={removeLabel ?? file.fileName}
          title={removeLabel}
        >
          <X className="h-3 w-3" />
        </AstryxButton>
      ) : null}
    </AstryxView>
  );
}

function UserAttachmentCard({
  file,
  workspaceRoot,
  compactImageLayout,
  compactFileLayout,
  onRemove,
  removeLabel,
  previewLabel,
  closePreviewLabel,
}: {
  file: PendingUploadedFile;
  workspaceRoot?: string;
  compactImageLayout: boolean;
  compactFileLayout: boolean;
  onRemove?: ((relativePath: string) => void) | undefined;
  removeLabel?: string;
  previewLabel: string;
  closePreviewLabel: string;
}) {
  const shouldPreviewImage =
    file.kind === "image" && typeof file.absolutePath === "string" && file.absolutePath.trim();
  const { imageSrc, isLoading } = useUploadedImagePreview(
    shouldPreviewImage ? file.absolutePath : undefined,
    workspaceRoot,
  );

  if (shouldPreviewImage) {
    return (
      <UserImageAttachmentCard
        file={file}
        workspaceRoot={workspaceRoot}
        imageSrc={imageSrc}
        isLoading={isLoading}
        compact={compactImageLayout}
        onRemove={onRemove}
        removeLabel={removeLabel}
        previewLabel={previewLabel}
        closePreviewLabel={closePreviewLabel}
      />
    );
  }

  return (
    <UserFileAttachmentCard
      file={file}
      onRemove={onRemove}
      removeLabel={removeLabel}
      compact={compactFileLayout}
    />
  );
}

export function UserAttachmentCards({
  files,
  workspaceRoot,
  onRemove,
}: {
  files: PendingUploadedFile[];
  workspaceRoot?: string;
  onRemove?: ((relativePath: string) => void) | undefined;
}) {
  const { t } = useLocale();
  if (files.length === 0) return null;
  const imageFiles = files.filter((file) => file.kind === "image");
  const otherFiles = files.filter((file) => file.kind !== "image");
  const compactImageLayout = imageFiles.length > 1;
  const compactFileLayout = otherFiles.length > 1;
  const removeLabel = onRemove ? t("chat.upload.removeFile") : undefined;
  const previewLabel = t("chat.upload.previewImage");
  const closePreviewLabel = t("chat.upload.closePreview");

  return (
    <AstryxView layout="flex" direction="vertical" className="mb-2 flex flex-col gap-2">
      {imageFiles.length > 0 ? (
        <AstryxView layout="flex" direction="horizontal" className="flex flex-wrap gap-2">
          {imageFiles.map((file) => (
            <UserAttachmentCard
              key={`${file.relativePath}-${file.absolutePath ?? file.fileName}`}
              file={file}
              workspaceRoot={workspaceRoot}
              compactImageLayout={compactImageLayout}
              compactFileLayout={false}
              onRemove={onRemove}
              removeLabel={removeLabel}
              previewLabel={previewLabel}
              closePreviewLabel={closePreviewLabel}
            />
          ))}
        </AstryxView>
      ) : null}
      {otherFiles.length > 0 ? (
        <AstryxView layout="flex" direction="horizontal" className="flex flex-wrap gap-2">
          {otherFiles.map((file) => (
            <UserAttachmentCard
              key={`${file.relativePath}-${file.absolutePath ?? file.fileName}`}
              file={file}
              workspaceRoot={workspaceRoot}
              compactImageLayout={false}
              compactFileLayout={compactFileLayout}
              onRemove={onRemove}
              removeLabel={removeLabel}
              previewLabel={previewLabel}
              closePreviewLabel={closePreviewLabel}
            />
          ))}
        </AstryxView>
      ) : null}
    </AstryxView>
  );
}
