import type { SessionUser } from "../session/session-store.js";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type UpstreamResult =
  | { kind: "json"; status: number; text: string; data: unknown }
  | { kind: "non-json"; status: number }
  | { kind: "timeout" }
  | { kind: "network"; message: string };

export const NOT_CONNECTED = { success: false, error: "This action is not connected to n8n yet." } as const;

/** Calls an n8n webhook on behalf of a signed-in user. Never follows redirects. */
export async function callN8n(opts: {
  fetch: FetchLike;
  url: string;
  method: "GET" | "POST";
  user: SessionUser;
  isAdmin: boolean;
  body?: unknown;
  timeoutMs: number;
}): Promise<UpstreamResult> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-OneJarc-User-Oid": opts.user.oid,
    "X-OneJarc-User-Email": opts.user.email,
    "X-OneJarc-User-Is-Admin": opts.isAdmin ? "true" : "false",
  };
  const init: RequestInit = {
    method: opts.method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs),
  };
  if (opts.method !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body ?? {});
  }

  let response: Response;
  let text: string;
  try {
    response = await opts.fetch(opts.url, init);
    text = await response.text();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { kind: "timeout" };
    return { kind: "network", message: err instanceof Error ? err.message : String(err) };
  }

  // A redirect (opaque or 3xx) is never followed and never treated as a valid answer.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400) || response.status === 0) {
    return { kind: "non-json", status: response.status };
  }
  try {
    if (text.trim() === "") throw new Error("empty");
    return { kind: "json", status: response.status, text, data: JSON.parse(text) as unknown };
  } catch {
    return { kind: "non-json", status: response.status };
  }
}

/** Standard JSON error bodies for failed upstream calls. */
export function upstreamFailure(result: Exclude<UpstreamResult, { kind: "json" }>): { status: number; body: object } {
  switch (result.kind) {
    case "non-json":
      return { status: 502, body: { success: false, error: "Unexpected response from n8n", status: result.status } };
    case "timeout":
      return { status: 504, body: { success: false, error: "n8n did not respond in time." } };
    case "network":
      return { status: 502, body: { success: false, error: "Could not reach n8n." } };
  }
}
