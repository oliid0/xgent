import type { PresentationNode } from "./types";

/** Keep existing action nodes and their handlers while separating scrollable details. */
export function compactExtensionPreview(
  node: PresentationNode,
  options: {
    detailsLabel: string;
    metadata: (item: PresentationNode) => boolean;
    footer: (item: PresentationNode) => boolean;
  },
): PresentationNode {
  const items = node.children ?? [];
  const close = items.find((item) => item.kind === "IconButton");
  const title = items.find((item) => item.kind === "Heading");
  const controls = items.filter((item) => item.variant === "extension-preview-controls");
  const metadata = items.filter(options.metadata);
  const footer = items.filter(options.footer);
  const body = items.filter(
    (item) =>
      item !== close &&
      item !== title &&
      !controls.includes(item) &&
      !metadata.includes(item) &&
      !footer.includes(item),
  );
  return {
    ...node,
    fill: true,
    children: [
      ...(close ? [close] : []),
      ...(title ? [title] : []),
      ...controls,
      {
        id: `${node.id}:body`,
        kind: "VStack",
        variant: "extension-preview-body",
        children: [
          ...body,
          ...(metadata.length
            ? [
                {
                  id: `${node.id}:details`,
                  kind: "Collapsible" as const,
                  label: options.detailsLabel,
                  children: metadata,
                },
              ]
            : []),
        ],
      },
      ...(footer.length
        ? [
            {
              id: `${node.id}:footer`,
              kind: "HStack" as const,
              variant: "extension-preview-footer",
              children: footer,
            },
          ]
        : []),
    ],
  };
}
