import { isBrowserRuntime } from "@xagent/runtime";
import { prepareUpstreamProxyRequest } from "./providers/proxy";

// Skills/MCP Hub outbound adapter. Native runtimes route requests through the
// local proxy so system-proxy settings are honored. A paired browser keeps
// normal browser networking for public Hub resources; privileged provider
// requests use the authenticated local provider proxy elsewhere.
//
// The signature is intentionally narrower than `fetch`: native URL rewriting
// cannot faithfully preserve an arbitrary Request object's body and headers.
export async function hubFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  if (isBrowserRuntime()) {
    return fetch(input, init);
  }
  const prepared = await prepareUpstreamProxyRequest(
    typeof input === "string" ? input : input.toString(),
  );
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(prepared.headers)) {
    headers.set(name, value);
  }
  return fetch(prepared.url, { ...init, headers });
}
