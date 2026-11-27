// OneJarc same-origin API transport (see PATCHES.md).
// Every catalog, chat and launch call goes to the OneJarc server, which holds the
// Microsoft Entra session cookie.

export const SESSION_EXPIRED_MESSAGE = "Your session expired. Sign in again.";

/**
 * Resolves to { ok, status, data } and never throws for HTTP errors.
 * Network failures and timeouts throw (error.name is "TimeoutError" / "AbortError" / "TypeError").
 * data is the parsed JSON body, or null when the body is not JSON.
 * A 401 is normalised to data = { success: false, error: SESSION_EXPIRED_MESSAGE }.
 */
export async function apiFetch(path, { method = "GET", body, timeoutMs = 60000, fetchImpl = fetch } = {}) {
  const headers = { "Accept": "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetchImpl(path, {
    method,
    headers,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  let data = null;
  try { data = await response.json(); } catch { data = null; }

  if (response.status === 401) {
    return { ok: false, status: 401, data: { success: false, error: SESSION_EXPIRED_MESSAGE } };
  }
  return { ok: response.ok, status: response.status, data };
}

/** Prefer the server's own { error } / { message } text; fall back to a generic message. */
export function apiErrorMessage(data, fallback) {
  if (typeof data?.error === "string" && data.error) return data.error;
  if (typeof data?.message === "string" && data.message) return data.message;
  return fallback;
}
