import type {
  Api,
  Context,
  ImageContent,
  Message,
  Model,
  TextContent,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

function omittedImagesNotice(images: ImageContent[], modelId: string): string {
  const types = images.map((image) => image.mimeType || "image").join(", ");
  return [
    `[${images.length} tool-result image${images.length === 1 ? "" : "s"} omitted: ${types}]`,
    `The active model (${modelId}) cannot read images. Use the tool's text output or switch to an image-capable model; repeating the same image action will not reveal its contents.`,
  ].join("\n");
}

export function omitToolResultImagesForTextOnlyModel(context: Context, model: Model<Api>): Context {
  if (model.input.includes("image")) return context;
  let changed = false;
  const messages: Message[] = context.messages.map((message) => {
    if (message.role !== "toolResult") return message;
    const images = message.content.filter((block): block is ImageContent => block.type === "image");
    if (images.length === 0) return message;
    changed = true;
    const textBlocks = message.content.filter(
      (block): block is TextContent => block.type === "text",
    );
    return {
      ...message,
      content: [...textBlocks, { type: "text", text: omittedImagesNotice(images, model.id) }],
    } satisfies ToolResultMessage;
  });
  return changed ? { ...context, messages } : context;
}
