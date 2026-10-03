import { canHttpMethodHaveBody, HTTP_METHODS } from "../lib/automation";
import {
  createEmptyRequestDraft,
  type HttpRequestDraft,
} from "../pages/settings/httpRequestEditor";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

// Request drafts and parsing are shared with the Astryx editor. The native
// layout exposes one request at a time rather than an entire JSON array.
export function nativeHttpRequestEditor(options: {
  controls: ReturnType<typeof presentationControls>;
  requests: HttpRequestDraft[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  setRequests: (update: (requests: HttpRequestDraft[]) => HttpRequestDraft[]) => void;
  clearError: () => void;
  t: (key: string) => string;
  enabled: boolean;
  idPrefix?: string;
}): PresentationNode[] {
  const {
    controls: c,
    requests,
    expanded,
    setExpanded,
    setRequests,
    clearError,
    t,
    enabled,
  } = options;
  const prefix = options.idPrefix ?? "http";
  const edit = (update: (requests: HttpRequestDraft[]) => HttpRequestDraft[]) => {
    clearError();
    setRequests(update);
  };
  return [
    ...requests.map((request, index): PresentationNode => {
      const id = `${prefix}:${request.id}`;
      const open = expanded === request.id;
      const patch = (update: Partial<HttpRequestDraft>) =>
        edit((items) =>
          items.map((item) => (item.id === request.id ? { ...item, ...update } : item)),
        );
      return {
        id,
        kind: "VStack",
        variant: "http-request-editor",
        label: `${t("settings.cronTypeHttp")} ${index + 1}`,
        children: [
          {
            ...c.action(
              `${id}:expand`,
              `${t("settings.cronTypeHttp")} ${index + 1}`,
              () => setExpanded(open ? null : request.id),
              enabled,
            ),
            text: request.method,
            selected: open,
            accessibilityHint: t(open ? "settings.collapse" : "settings.expand"),
          },
          {
            ...c.action(
              `${id}:remove`,
              t("settings.delete"),
              () => {
                edit((items) => items.filter((item) => item.id !== request.id));
                if (open) setExpanded(null);
              },
              enabled,
            ),
            kind: "IconButton",
            icon: "trash",
            destructive: true,
          },
          {
            id: `${id}:address`,
            kind: "VStack",
            variant: "http-request-address",
            children: [
              {
                ...c.input(
                  `${id}:url`,
                  t("settings.cronViewHttpUrl"),
                  request.url,
                  (url) => patch({ url }),
                  false,
                  enabled,
                ),
                text: "https://example.com/hook",
              },
              c.select(
                `${id}:method`,
                t("settings.cronHttpMethod"),
                request.method,
                HTTP_METHODS.map((value) => ({ value, label: value })),
                (method) =>
                  edit((items) =>
                    items.map((item) =>
                      item.id === request.id
                        ? {
                            ...item,
                            method: method as HttpRequestDraft["method"],
                            bodyText: canHttpMethodHaveBody(method as HttpRequestDraft["method"])
                              ? item.bodyText
                              : "",
                          }
                        : item,
                    ),
                  ),
                enabled,
              ),
            ],
          },
          ...(open
            ? [
                {
                  id: `${id}:fields`,
                  kind: "VStack" as const,
                  variant: "http-request-fields",
                  children: [
                    {
                      ...c.input(
                        `${id}:headers`,
                        t("settings.cronViewHttpHeaders"),
                        request.headersText,
                        (headersText) => patch({ headersText }),
                        false,
                        enabled,
                      ),
                      kind: "TextArea" as const,
                      language: "json",
                      minHeight: 112,
                    },
                    ...(canHttpMethodHaveBody(request.method)
                      ? [
                          {
                            ...c.input(
                              `${id}:body`,
                              t("settings.cronViewHttpBody"),
                              request.bodyText,
                              (bodyText) => patch({ bodyText }),
                              false,
                              enabled,
                            ),
                            kind: "TextArea" as const,
                            language: "json",
                            minHeight: 132,
                          },
                        ]
                      : [
                          {
                            id: `${id}:body-disabled`,
                            kind: "Text" as const,
                            text: t("settings.cronHttpBodyDisabled"),
                            secondary: true,
                          },
                        ]),
                  ],
                },
              ]
            : []),
        ],
      };
    }),
    ...(!requests.length
      ? [
          {
            id: `${prefix}:empty`,
            kind: "EmptyState" as const,
            label: t("settings.cronHttpRequestRequired"),
            icon: "network",
          },
        ]
      : []),
    c.action(
      `${prefix}:add`,
      t("settings.add"),
      () => {
        const request = createEmptyRequestDraft();
        edit((items) => [...items, request]);
        setExpanded(request.id);
      },
      enabled,
    ),
  ];
}
