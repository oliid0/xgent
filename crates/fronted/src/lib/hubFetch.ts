import { prepareUpstreamProxyRequest } from "./providers/proxy";

// Skills/MCP Hub outbound adapter. Native runtimes use the loopback proxy and
// paired WebUI clients use its authenticated, same-origin local-access facade.
// Keeping both paths on the same adapter avoids third-party CORS failures and
// makes the application's system-proxy policy consistent across every client.
//
// The signature is intentionally narrower than `fetch`: native URL rewriting
// cannot faithfully preserve an arbitrary Request object's body and headers.
export async function hubFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const prepared = await prepareUpstreamProxyRequest(
    typeof input === "string" ? input : input.toString(),
  );
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(prepared.headers)) {
    headers.set(name, value);
  }
  headers.set("x-xgent-upstream-user-agent", "Xgent-Hub/1.0");
  return fetch(prepared.url, { credentials: "same-origin", ...init, headers });
}
