# PATCHES.md: hand edits to the built frontend (`site/`)

The OneJarc frontend in `site/` is a **built** Vite bundle (`site/assets/index-D3Sf9OYN.js`, about 37k unminified lines with `//#region src/...` markers) plus 17 hand-written ES modules in `site/assets/*.js`. The TypeScript source is not in this repository, so nothing can be rebuilt. To move sign-in to Microsoft Entra ID and send every n8n call through the same-origin OneJarc server (`apps/server`), the built files were **edited by hand, minimally**.

- **Baseline:** commit `5f0dd20`. Every "Line" below is the line number **at 5f0dd20** (before any edit), so you can find the spot with `git show 5f0dd20:site/assets/index-D3Sf9OYN.js`.
- **These edits must be ported to the TypeScript source** when it is recovered or rebuilt (PLAN.md Phase 0). After that, regenerate the bundle and delete this file.
- Bundle edits were applied from the bottom of the file upward. Where an edit adds or removes lines, later line numbers in the patched file shift by a few lines.
- Server contract the frontend now relies on: `GET /api/me`, `GET /auth/login?returnTo=`, `GET /auth/logout`, `POST|GET /api/n8n/<action>`, `POST /api/powerbi/embed-token`, a 401 JSON answer (never a redirect) for `/api/*`, the `X-OneJarc-Build` response header, and `<base href="/">` + `<meta name="onejarc-build">` injected into `index.html`.

Legend: **B** = `site/assets/index-D3Sf9OYN.js`.

---

## Bundle `site/assets/index-D3Sf9OYN.js`

### B1. Auth service: identity from the server session
- **Region:** `//#region src/models/auth-service.ts`, `createPrototypeAuthService`
- **Line:** B:9974-10005
- **Reason:** The browser used to post a username and password to an n8n login webhook (`./login.js`) and keep the user and role in `sessionStorage`. Identity now comes from the server's Entra session (`GET /api/me`). Sign-in and sign-out are full-page redirects. A build-id check reloads the page once after a redeploy. The `store` argument is no longer used, and `createSessionStore` stays in place (still wired at B:10373) but is never used.

BEFORE
```js
async restore() {
	const session = store.read();
	if (!session || session.expiresAt <= now() || session.expiresAt > now() + 288e5) return null;
	// Reads saved user directly from local session storage
	return session.user || null;
},
async signIn(username, password) {
	const { signInWithWebhook } = await import("./login.js");
	const user = await signInWithWebhook(username, password);
	/* ...store.write({ version: 1, userId: user.id, user, expiresAt }) ... */
	return { ...user };
},
async signOut() {
	store.clear();
}
```
AFTER
```js
// PATCHED (PATCHES.md): identity comes from the same-origin server session
// (Microsoft Entra ID). `store` is no longer used.
async restore() {
	const response = await fetch("/api/me", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
	const serverBuild = response.headers.get("X-OneJarc-Build");
	const pageBuild = document.querySelector('meta[name="onejarc-build"]')?.content;
	if (serverBuild && pageBuild && serverBuild !== pageBuild) {
		let reloaded = null;
		try { reloaded = window.sessionStorage.getItem("onejarc-build-reload"); } catch {}
		if (reloaded !== serverBuild) {
			try { window.sessionStorage.setItem("onejarc-build-reload", serverBuild); } catch {}
			window.location.reload();
		}
	}
	if (response.status === 401) return null;
	if (!response.ok) throw new Error("Session check failed (HTTP " + response.status + ").");
	const me = await response.json();
	if (!me || typeof me.oid !== "string" || !me.oid) return null;
	return { id: me.oid, username: me.email, displayName: me.name || me.email, email: me.email, role: me.isAdmin === true ? "admin" : "user" };
},
async signIn() {
	window.location.assign("/auth/login?returnTo=" + encodeURIComponent(location.pathname + location.search + location.hash));
	return new Promise(() => {});
},
async signOut() {
	window.location.assign("/auth/logout");
}
```

### B2. `validateChatWebhookUrl`: accept same-origin paths
- **Region:** `//#region src/models/backend-config.ts`
- **Line:** B:10075-10079
- **Reason:** The config now holds relative paths such as `/api/n8n/chat`. The old check required an absolute `https:` URL, so page load failed. A URL is now accepted if it is same-origin (any protocol, so `http://localhost` works) or `https:`. The checks for credentials, query string, fragment, root path and length stay. The function still returns `url.href`, the absolute URL. Callers checked: `parseRuntimeConfig` (all 5 URLs), `validatePlannedConnections` (empty strings are skipped by `if (value[key])`), and `validateBackendConfig` B:10051 (it receives the already-absolute href).

BEFORE
```js
const url = new URL(value);
if (typeof value !== "string" || value.length > 2048 || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname === "/") throw new Error();
return url.href;
} catch {
	throw new Error("Use a complete HTTPS webhook URL without credentials, query parameters, or fragments.");
```
AFTER
```js
const url = new URL(value, window.location.origin);
if (typeof value !== "string" || value.length > 2048 || url.origin !== window.location.origin && url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname === "/") throw new Error();
return url.href;
} catch {
	throw new Error("Use a same-origin path (e.g. /api/n8n/chat) or a complete HTTPS URL without credentials, query parameters, or fragments.");
```

### B3. api-client: send the session cookie
- **Region:** `//#region src/models/api-client.ts`, `createApiClient` → `request` fetch options
- **Line:** B:10228
- **Reason:** Chat (`POST /api/n8n/chat`) must carry the session cookie. A 401 already maps to `ApiError("UNAUTHORIZED")` and calls `dependencies.onUnauthorized` (B:10260). See B6 for wiring that callback to the chat client. `mode: "cors"` and `redirect: "error"` stay; both are harmless for same-origin requests.

BEFORE `credentials: "omit",` → AFTER `credentials: "same-origin",`

### B4. `expireSession` no longer signs out of Microsoft
- **Region:** `//#region src/views/hooks/use-auth.tsx`, `AuthProvider`
- **Line:** B:10365
- **Reason:** `service.signOut()` now redirects to `/auth/logout`, which also ends the Microsoft session. When the session expires, the app should only clear the user so the LoginScreen shows the existing "Your session expired. Sign in again." message. `explicitlySignedOut` stays true, so the 60-second restore poll stops until the user signs in again with a full-page redirect.

BEFORE
```js
setUser(null);
setError("Your session expired. Sign in again.");
service.current?.signOut().catch(() => {});
}, []);
```
AFTER
```js
setUser(null);
setError("Your session expired. Sign in again.");
}, []);
```

### B5. Restore error copy
- **Region:** `//#region src/views/hooks/use-auth.tsx`, `restore()` catch
- **Line:** B:10377
- **Reason:** `restore()` no longer reads browser storage, so the old message was misleading.

BEFORE `"Demo session storage is unavailable. Enable browser storage to sign in."` → AFTER `"Your sign-in could not be checked. Check your connection and try again."`

### B6. Chat client reports 401s to the auth layer
- **Region:** `//#region src/views/hooks/use-backend.tsx` (`useBackendServices`)
- **Line:** B:12695
- **Reason:** The chat `ApiClient` was created without `onUnauthorized`, so a 401 from chat would only show an error. It now calls `expireSession`, which shows the LoginScreen.

BEFORE `chat: createChatService(createApiClient(backendConfig, { getAccessToken })),`
AFTER `chat: createChatService(createApiClient(backendConfig, { getAccessToken, onUnauthorized: expireSession })),`

### B7. LoginScreen: company Microsoft sign-in only
- **Region:** `//#region src/views/components/login-screen.tsx` (`LoginScreen`)
- **Lines:** B:18500, 18502, 18506-18523, 18597
- **Reason:** The company sign-in branch is now always shown. The `companyReady` gate is gone. The button redirects to `/auth/login` with `returnTo` (the same redirect as `signIn()`). It does not set `loading`, so a back-navigation restored from the browser cache never shows a stuck "Connecting…" button. The prototype and demo-credential copy is removed. The password form (B:18525-18591) is now unreachable and is left in place; delete it in the rebuild. The layout is unchanged.

BEFORE (18500, 18502)
```js
children: auth.companyMode ? "Use your company account to access OneJarc." : "Enter your username and password to access OneJarc."
...
auth.companyMode ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
```
AFTER
```js
children: "Sign in with your company Microsoft account to access OneJarc."
...
true ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
```
BEFORE (18506-18523)
```js
disabled: loading || !auth.companyReady,
onClick: async () => {
	if (loading) return;
	setLoading(true);
	setError("");
	try { await auth.beginCompanySignIn(); }
	catch { setError("Company sign-in could not be started. Contact your administrator."); }
	finally { setLoading(false); }
},
children: loading ? "Connecting…" : "Continue with company sign-in"
}), (error || auth.error || !auth.companyReady) && /* ... */("p", {
	...
	children: error || auth.error || "Company sign-in is not configured yet. No demo credentials are sent to the API."
```
AFTER
```js
disabled: loading,
onClick: () => {
	if (loading) return;
	setError("");
	window.location.assign("/auth/login?returnTo=" + encodeURIComponent(location.pathname + location.search + location.hash));
},
children: loading ? "Connecting…" : "Sign in with Microsoft"
}), (error || auth.error) && /* ... */("p", {
	...
	children: error || auth.error
```
BEFORE (18597)
```js
("p", { children: auth.companyMode ? "API mode requires an approved company identity provider. ..." : (Fragment, { children: "Prototype access only. Demo credentials are visible in the frontend. Company SSO is not connected; do not enter a real company password." }) })
```
AFTER
```js
("p", { children: "Sign in with your company Microsoft account. OneJarc never sees your password; access to each tool is checked by the server." })
```

### B8. Launch call site passes the tool id
- **Region:** `//#region src/controllers/hub-controller.tsx` (`HubContent` → `openToolWorkspace`)
- **Line:** B:35948-35952
- **Reason:** The server works out the email and role from the session. The tool id is passed so `launch-tool.js` can request embed-token refreshes. `launchTool` still accepts the old `(name, email, role)` form (see M9).

BEFORE
```js
await launchAuthorizedTool(
	tool.name,
	auth.user?.email || auth.user?.username || "",
	auth.user?.role || ""
);
```
AFTER
```js
await launchAuthorizedTool(tool.name, { toolId: tool.id });
```

### B9. Runtime config is fetched with the session cookie
- **Region:** `//#region src/models/runtime-config.ts`, `loadRuntimeConfig`
- **Line:** B:37160
- **Reason:** `onejarc-config.json` is now served behind auth.

BEFORE `credentials: "omit",` → AFTER `credentials: "same-origin",`

### B10. Config URL resolved against `document.baseURI`
- **Region:** `//#region src/main.tsx`
- **Line:** B:37179
- **Reason:** The server's SPA fallback serves `index.html` at deep paths such as `/tools/x` and injects `<base href="/">`. Resolving `./onejarc-config.json` against `location.href` would request `/tools/onejarc-config.json`. With `document.baseURI` the result is always `/onejarc-config.json`. Without a `<base>` tag, `document.baseURI` equals `location.href`, so the old behaviour is kept.

BEFORE `loadRuntimeConfig(window.location.href).then(() => {`
AFTER `loadRuntimeConfig(document.baseURI).then(() => {`

### Not changed (intentional)
- B:10020 / B:10053: the dead `https://jarctech-ai-n8n-rnd.onrender.com/webhook` `apiBaseUrl` in the `staging` profile, which `validateBackendConfig` requires. It is never fetched, because chat uses `chatWebhookUrl`. Remove it in the rebuild.
- B:70: `fetchOpts.credentials = "omit"` belongs to Vite's modulepreload polyfill and applies only to `<link rel="modulepreload" crossorigin="anonymous">`, which this page does not use.
- B:9945-9968 `DEMO_SESSION_KEY` / `createSessionStore`, B:10373 wiring, and the `signIn(username, password)` path in `use-auth.tsx`. All of it is unused or unreachable now.

---

## Sibling modules `site/assets/*.js`

### M0. NEW `site/assets/api-fetch.js`
- **Reason:** One same-origin transport for all module calls. `apiFetch(path, { method = "GET", body, timeoutMs = 60000, fetchImpl = fetch })` sends `credentials: "same-origin"`, `redirect: "error"`, `cache: "no-store"`, `Accept: application/json` (plus `Content-Type: application/json` only when there is a body) and `AbortSignal.timeout(timeoutMs)`. It resolves to `{ ok, status, data }`, where `data` is the parsed JSON or `null`. It never throws for an HTTP status; network failures and timeouts still throw, which the callers already handle. A **401** is normalised to `{ ok: false, status: 401, data: { success: false, error: "Your session expired. Sign in again." } }`, so each caller's existing `!ok → throw new Error(data.error)` path shows that message. `apiErrorMessage(data, fallback)` is a small helper that returns `data.error`, then `data.message`, then the fallback.

### M1. `site/assets/get-tools.js`
- **Line:** 1-2 (header plus import), 83-108 (`fetchToolCatalogSnapshot` transport)
- **Reason:** Calls go through `apiFetch` with the cookie, and the error text no longer mentions CORS. The URL still comes from config (`getToolsWebhookUrl` = `/api/n8n/get-tools`). HTTP errors (401, 501, 502, 504) now show the server's `error` text before the "invalid JSON" check is reached.

BEFORE
```js
response = await fetchImpl(settings.getToolsWebhookUrl, {
  method: "GET", headers: { "Accept": "application/json" }, credentials: "omit",
  redirect: "error", cache: "no-store", signal: AbortSignal.timeout(settings.timeoutMs || 60000)
});
...
let body;
try { body = await response.json(); } catch { throw new Error("The get-tools webhook returned invalid JSON."); }
if (!response.ok) { throw new Error(typeof body?.error === "string" ? body.error : `get-tools failed with HTTP ${response.status}.`); }
```
AFTER
```js
response = await apiFetch(settings.getToolsWebhookUrl, { method: "GET", timeoutMs: settings.timeoutMs || 60000, fetchImpl });
...
const body = response.data;
if (!response.ok) { throw new Error(typeof body?.error === "string" ? body.error : `get-tools failed with HTTP ${response.status}.`); }
if (body === null) { throw new Error("The get-tools webhook returned invalid JSON."); }
```

### M2. `site/assets/create-tool.js`
- **Line:** 2 (import plus `CREATE_TOOL_PATH = "/api/n8n/create-tool"`), 20-41 (`submitNewTool`)
- **Reason:** Calls go through `apiFetch`. The URL is `settings.createToolWebhookUrl` (the config's `/api/n8n/create-tool`, now an absolute same-origin href), falling back to the constant. `toolPayload()` is unchanged.

BEFORE
```js
response = await fetchImpl(settings.createToolWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(settings.timeoutMs || 60000), body: JSON.stringify(toolPayload(definition)) });
...
let result;
try { result = await response.json(); } catch { throw new Error('The webhook returned an invalid response. ...'); }
```
AFTER
```js
const payload = toolPayload(definition);
response = await apiFetch(settings?.createToolWebhookUrl || CREATE_TOOL_PATH, { method: 'POST', timeoutMs: settings?.timeoutMs || 60000, body: payload, fetchImpl });
...
const result = response.data;
if (response.ok && result === null) throw new Error('The webhook returned an invalid response. ...');
```

### M3. `site/assets/delete-tool.js`
- **Line:** 1-23
- **Reason:** The `PASTE_` placeholder constant and its guard are replaced by the server path `/api/n8n/delete-tool`. Until `N8N_URL_DELETE_TOOL` is set, the server answers 501 `{"success":false,"error":"This action is not connected to n8n yet."}`, and that text is thrown as an `Error`. The admin UI (`AdminWorkspace.act`, B:32363) shows `failure.message`. Nothing is removed locally, because the webhook runs before the local write.

BEFORE
```js
const DELETE_TOOL_WEBHOOK_URL = "PASTE_YOUR_DELETE_WEBHOOK_HERE";
...
if (!DELETE_TOOL_WEBHOOK_URL || DELETE_TOOL_WEBHOOK_URL === "PASTE_YOUR_DELETE_WEBHOOK_HERE") { throw new Error("Delete Tool webhook is not configured. ..."); }
const response = await fetchImpl(DELETE_TOOL_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", redirect: "error", body: JSON.stringify({ id: toolId }) });
let result; try { result = await response.json(); } catch { throw new Error("Delete webhook returned an invalid JSON response."); }
```
AFTER
```js
import { apiFetch } from "./api-fetch.js";
const DELETE_TOOL_PATH = "/api/n8n/delete-tool";
...
let response;
try { response = await apiFetch(DELETE_TOOL_PATH, { method: "POST", body: { id: toolId }, fetchImpl }); }
catch { throw new Error("Could not confirm the delete. Check your connection, and check the database before retrying."); }
const result = response.data;
if (response.ok && result === null) { throw new Error("Delete webhook returned an invalid JSON response."); }
```

### M4. `site/assets/tool-webhook-client.js` (shared by the 8 action adapters)
- **Line:** 1-9
- **Reason:** The `PASTE_` guard and the absolute-https check are replaced by a same-origin check. A URL must resolve to `window.location.origin`; an empty URL falls back to `/api/n8n/<action>-tool`. Calls go through `apiFetch`. The server's 501 or 403 `error` text is thrown as the `Error` message.

BEFORE
```js
if (!url || url.startsWith('PASTE_')) throw new Error(action + ' webhook is not configured. ...');
const target = new URL(url);
if(target.protocol !== 'https:' || target.username || target.password) throw new Error('Use an HTTPS webhook URL without embedded credentials.');
try { response = await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify(payload)}); }
catch { throw new Error('Could not confirm ' + action + '. Check your connection and CORS settings. ...'); }
let result;try{result=await response.json()}catch{throw new Error('The '+action+' webhook returned invalid JSON. ...');}
```
AFTER
```js
import { apiFetch } from './api-fetch.js';
const target = new URL(url || '/api/n8n/' + action + '-tool', window.location.origin);
if(target.origin !== window.location.origin || target.username || target.password) throw new Error('Tool actions must use a same-origin OneJarc server path.');
try { response = await apiFetch(target.pathname, {method:'POST', body:payload, fetchImpl}); }
catch { throw new Error('Could not confirm ' + action + '. Check your connection. ...'); }
const result = response.data;
if(response.ok && result === null) throw new Error('The '+action+' webhook returned invalid JSON. ...');
```

### M5-M8. The 8 action adapters
- **Files and lines:** `edit-tool.js:3-5`, `duplicate-tool.js:2-4`, `publish-tool.js:2-4`, `unpublish-tool.js:2-4`, `enable-tool.js:2-4`, `disable-tool.js:2-4`, `archive-tool.js:2-4`, `restore-tool.js:2-4`
- **Reason:** The placeholder constants become server paths. The server answers 501 until the matching `N8N_URL_<NAME>_TOOL` is set.

BEFORE (example: archive)
```js
// PASTE your production n8n archive webhook URL here.
// Contract and MongoDB instructions: ../WEBHOOKS.md
export const WEBHOOK_URL = "PASTE_YOUR_ARCHIVE_WEBHOOK_HERE";
```
AFTER
```js
// Same-origin OneJarc server path; the server forwards to the n8n URL in
// N8N_URL_ARCHIVE_TOOL and answers 501 until it is set (see PATCHES.md).
export const WEBHOOK_URL = "/api/n8n/archive-tool";
```

### M9. `site/assets/launch-tool.js`
- **Lines:** 1-23 (header, `launchTool` request), 32 (Power BI call passes the tool id), new block before `createViewerShell` (line 50), 99 (Close button), 115 and 151 (`showPowerBIReport`)
- **Reason:**
  - The hardcoded n8n URL is replaced by `apiFetch("/api/n8n/get-tool-creds", { method: "POST", body: { toolName, toolId } })`. The server adds `email` and `role` from the session.
  - New signature `launchTool(toolName, { toolId })`. The old `launchTool(toolName, email, role[, toolId])` still works; email and role are ignored.
  - Non-OK responses throw the server's `error` text, for example "Your session expired. Sign in again." The existing alert, rethrow and launch-message behaviour is kept, and so are the iframe viewer and the Power BI embed.
  - The `report` returned by `powerbi.embed` is now kept and returned. A refresh is scheduled 5 minutes before `expiration` (or `tokenExpiration`). If the response has no expiry, it refreshes every 50 minutes, and never sooner than 10 seconds. A refresh is `POST /api/powerbi/embed-token { toolId, toolName }` followed by `report.setAccessToken(accessToken)`, then the next refresh is scheduled from the new `expiration`.
  - A failed refresh is retried after 1 minute. A 401 stops refreshing.
  - The timer is cleared when the viewer closes or another viewer opens (`createViewerShell`). A `visibilitychange` handler runs an overdue refresh as soon as the tab is visible again, because background tabs throttle timers.

BEFORE
```js
export async function launchTool(toolName, userEmail, userRole) {
  try {
    const response = await fetch('https://jarc-juno.app.n8n.cloud/webhook/get-tool-creds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName: toolName, email: userEmail, role: userRole })
    });
    if (!response.ok) { throw new Error(`Authorization request failed (${response.status}).`); }
    const data = await response.json();
...
      showPowerBIReport(data, toolName);
...
  window.powerbi.reset(pbiReportContainer);
  window.powerbi.embed(pbiReportContainer, config);
}
```
AFTER
```js
import { apiFetch, apiErrorMessage } from './api-fetch.js';
const GET_TOOL_CREDS_PATH = '/api/n8n/get-tool-creds';
const EMBED_TOKEN_PATH = '/api/powerbi/embed-token';
...
export async function launchTool(toolName, options = {}, _legacyRole, legacyToolId) {
  const toolId = options && typeof options === 'object' ? options.toolId : legacyToolId;
  try {
    const response = await apiFetch(GET_TOOL_CREDS_PATH, { method: 'POST', body: { toolName, ...(toolId ? { toolId } : {}) } });
    if (!response.ok) { throw new Error(apiErrorMessage(response.data, `Authorization request failed (${response.status}).`)); }
    const data = response.data;
    if (!data || typeof data !== 'object') { throw new Error('Authorization response was not valid JSON.'); }
...
      showPowerBIReport(data, toolName, toolId);
...
// + stopTokenRefresh / scheduleTokenRefresh / refreshDelayFor / startTokenRefresh / visibilitychange handler
// + createViewerShell() and the Close button call stopTokenRefresh()
...
  window.powerbi.reset(pbiReportContainer);
  const report = window.powerbi.embed(pbiReportContainer, config);
  if (report && typeof report.setAccessToken === 'function') {
    startTokenRefresh(report, toolName, toolId, data.expiration ?? data.tokenExpiration ?? null);
  }
  return report;
}
```

### M10. DELETED `site/assets/login.js`
- **Reason:** It was the n8n username/password login adapter. The only reference was the dynamic `import("./login.js")` at B:9985, which B1 removed. A grep of `site/` finds no remaining reference.

---

## Config `site/onejarc-config.json`
- **Lines:** 2-4, 44-46
- **Reason:** No n8n URL remains in the frontend. The values are same-origin server paths, and the real URLs live only in the server environment (`N8N_URL_*`). `loginWebhookUrl` is still required by `parseRuntimeConfig` (B:37112) but is unused. `plannedConnections` is unchanged.

| Key | BEFORE | AFTER |
|---|---|---|
| `chatWebhookUrl` | `https://<n8n host>/webhook/<chat id>` | `/api/n8n/chat` |
| `loginWebhookUrl` | `https://<n8n host>/webhook/onejarc-login` | `/auth/login` |
| `createToolWebhookUrl` | `https://<n8n host>/webhook/create-tool` | `/api/n8n/create-tool` |
| `getToolsWebhookUrl` | `https://<n8n host>/webhook/get-tools` | `/api/n8n/get-tools` |
| `getToolCredsWebhookUrl` | `https://<n8n host>/webhook/get-tool-creds` | `/api/n8n/get-tool-creds` |
| `_comment` | "...Chat, new-tool creation, and MongoDB-backed catalog reading are connected..." | Explains that all URLs are same-origin server paths, the n8n URLs live in `N8N_URL_*`, and `loginWebhookUrl` is unused. |

---

## What the frontend sends (server checklist)

| Caller | Method + path | Body | Expects |
|---|---|---|---|
| auth-service `restore()` (on load, every 60 s, on focus) | GET `/api/me` | none | 200 `{name,email,oid,isAdmin}` or 401. Header `X-OneJarc-Build` |
| Sign-in button / `signIn()` | navigation `/auth/login?returnTo=<path+search+hash>` | none | 302 to Entra |
| `signOut()` | navigation `/auth/logout` | none | 302 |
| runtime config | GET `/onejarc-config.json` (cookie) | none | JSON |
| chat (api-client) | POST `/api/n8n/chat` | `{message}` | JSON; 401 → LoginScreen |
| get-tools.js | GET `/api/n8n/get-tools` | none | array or `{tools}` |
| create-tool.js | POST `/api/n8n/create-tool` | `toolPayload()` (can carry a base64 `iconImage`) | `{success:true}` |
| delete-tool.js | POST `/api/n8n/delete-tool` | `{id}` | `{success:true}`, or 501 `{error}` |
| edit/duplicate/publish/unpublish/enable/disable/archive/restore | POST `/api/n8n/<name>-tool` | `{action,id,requestId,publish,entry}` | `{success:true}`, or 501 `{error}` |
| launch-tool.js | POST `/api/n8n/get-tool-creds` | `{toolName, toolId}` (the server adds `email`, `role`) | `{authorized, category, reportId, embedUrl\|targetUrl, accessToken, expiration?}` |
| launch-tool.js refresh | POST `/api/powerbi/embed-token` | `{toolId, toolName}` | `{reportId, embedUrl, accessToken, expiration}` |

All `fetch` calls use `credentials: "same-origin"`. The module calls and the chat client also use `redirect: "error"`, so `/api/*` must answer 401 JSON, never a redirect.
