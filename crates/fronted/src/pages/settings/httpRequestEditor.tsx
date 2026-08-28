import { Badge } from "@astryxdesign/core/Badge";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Section, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ChevronDown, ChevronRight, Globe, Trash2 } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  canHttpMethodHaveBody,
  HTTP_METHODS,
  type HttpMethod,
  type HttpRequestSpec,
} from "../../lib/automation";
import { createUuid } from "../../lib/shared/id";

export type HttpRequestDraft = {
  id: string;
  url: string;
  method: HttpMethod;
  headersText: string;
  bodyText: string;
};

export function createEmptyRequestDraft(): HttpRequestDraft {
  return {
    id: createUuid(),
    url: "",
    method: "POST",
    headersText: "",
    bodyText: "",
  };
}

function stringifyHeaders(headers?: Record<string, string>) {
  if (!headers || Object.keys(headers).length === 0) return "";
  return JSON.stringify(headers, null, 2);
}

function stringifyBody(body?: unknown) {
  if (body === undefined) return "";
  return JSON.stringify(body, null, 2);
}

export function requestToDraft(request?: HttpRequestSpec): HttpRequestDraft {
  if (!request) return createEmptyRequestDraft();
  return {
    id: request.id,
    url: request.url,
    method: request.method,
    headersText: stringifyHeaders(request.headers),
    bodyText: stringifyBody(request.body),
  };
}

function parseHeaders(input: string, invalidMessage: string) {
  if (!input.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(invalidMessage);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(invalidMessage);
  }

  const headers: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const key = String(rawKey).trim();
    const value = typeof rawValue === "string" ? rawValue.trim() : String(rawValue ?? "").trim();
    if (!key || !value) continue;
    headers[key] = value;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function parseBody(method: HttpMethod, input: string, invalidMessage: string) {
  if (!canHttpMethodHaveBody(method)) return undefined;
  if (!input.trim()) return undefined;
  try {
    return JSON.parse(input);
  } catch {
    throw new Error(invalidMessage);
  }
}

export function parseHttpRequestDrafts(
  requests: HttpRequestDraft[],
  t: (key: string) => string,
): HttpRequestSpec[] {
  if (requests.length === 0) {
    throw new Error(t("settings.cronHttpRequestRequired"));
  }

  return requests.map((request, index) => {
    const url = request.url.trim();
    if (!url) {
      throw new Error(`${t("settings.cronHttpUrlRequired")} #${index + 1}`);
    }
    try {
      new URL(url);
    } catch {
      throw new Error(`${t("settings.cronHttpUrlInvalid")} #${index + 1}`);
    }

    return {
      id: request.id,
      url,
      method: request.method,
      headers: parseHeaders(request.headersText, t("settings.cronHttpHeadersInvalid")),
      body: parseBody(request.method, request.bodyText, t("settings.cronHttpBodyInvalid")),
    } satisfies HttpRequestSpec;
  });
}

type HttpRequestListEditorProps = {
  requests: HttpRequestDraft[];
  expandedRequestId: string | null;
  onExpand: (id: string | null) => void;
  onChange: (requests: HttpRequestDraft[]) => void;
  /** Called before any edit so the host modal can clear its form error. */
  onDirty: () => void;
  urlPlaceholder: string;
};

export function HttpRequestListEditor({
  requests,
  expandedRequestId,
  onExpand,
  onChange,
  onDirty,
  urlPlaceholder,
}: HttpRequestListEditorProps) {
  const { t } = useLocale();

  function updateRequest(id: string, patch: Partial<HttpRequestDraft>) {
    onChange(requests.map((request) => (request.id === id ? { ...request, ...patch } : request)));
  }

  return (
    <VStack gap={0}>
      {requests.map((request, index) => {
        const bodyEnabled = canHttpMethodHaveBody(request.method);
        const isExpanded = expandedRequestId === request.id;

        return (
          <Section key={request.id} variant="transparent" padding={3} dividers={["bottom"]}>
            <VStack gap={3}>
              <HStack gap={2} vAlign="center">
                <Badge label={index + 1} variant="neutral" />
                <Selector
                  label={t("settings.cronHttpMethod")}
                  isLabelHidden
                  value={request.method}
                  width="var(--xagent-http-method-width)"
                  size="sm"
                  options={HTTP_METHODS.map((method) => ({
                    value: method,
                    label: method,
                  }))}
                  onChange={(value) => {
                    onDirty();
                    updateRequest(request.id, {
                      method: value as HttpMethod,
                      bodyText: canHttpMethodHaveBody(value as HttpMethod) ? request.bodyText : "",
                    });
                  }}
                />
                <StackItem size="fill">
                  <TextInput
                    label="URL"
                    isLabelHidden
                    value={request.url}
                    size="sm"
                    placeholder={urlPlaceholder}
                    onChange={(value) => {
                      onDirty();
                      updateRequest(request.id, { url: value });
                    }}
                  />
                </StackItem>
                <IconButton
                  label={isExpanded ? t("settings.collapse") : t("settings.expand")}
                  tooltip={isExpanded ? t("settings.collapse") : t("settings.expand")}
                  variant="ghost"
                  size="sm"
                  icon={
                    isExpanded ? (
                      <ChevronDown aria-hidden="true" />
                    ) : (
                      <ChevronRight aria-hidden="true" />
                    )
                  }
                  onClick={() => onExpand(isExpanded ? null : request.id)}
                />
                <IconButton
                  label={t("settings.delete")}
                  tooltip={t("settings.delete")}
                  variant="destructive"
                  size="sm"
                  icon={<Trash2 aria-hidden="true" />}
                  onClick={() => {
                    onDirty();
                    onChange(requests.filter((item) => item.id !== request.id));
                    if (expandedRequestId === request.id) onExpand(null);
                  }}
                />
              </HStack>

              {isExpanded ? (
                <FormLayout direction="horizontal">
                  <TextArea
                    label="Headers"
                    value={request.headersText}
                    rows={5}
                    hasSpellCheck={false}
                    placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                    onChange={(value) => {
                      onDirty();
                      updateRequest(request.id, { headersText: value });
                    }}
                  />
                  {bodyEnabled ? (
                    <TextArea
                      label="Body"
                      value={request.bodyText}
                      rows={5}
                      hasSpellCheck={false}
                      placeholder={'{\n  "message": "hello"\n}'}
                      onChange={(value) => {
                        onDirty();
                        updateRequest(request.id, { bodyText: value });
                      }}
                    />
                  ) : (
                    <VStack gap={1}>
                      <Text type="body" weight="semibold">
                        Body
                      </Text>
                      <Section variant="muted" padding={4}>
                        <Text type="supporting" color="secondary">
                          {t("settings.cronHttpBodyDisabled")}
                        </Text>
                      </Section>
                    </VStack>
                  )}
                </FormLayout>
              ) : null}
            </VStack>
          </Section>
        );
      })}

      {requests.length === 0 ? (
        <EmptyState
          isCompact
          icon={<Globe aria-hidden="true" />}
          title={t("settings.cronHttpRequestRequired")}
          description={t("settings.cronHttpRequestRequired")}
        />
      ) : null}
    </VStack>
  );
}
