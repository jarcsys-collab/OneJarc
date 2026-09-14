# OneJarc — GitHub Pages deployment only

Upload the CONTENTS of this folder to the repository root, not this folder itself.
This package contains compiled frontend files only. Do not upload the separate
source project or choose its development index.html as the Pages entry.

## Publish

1. Open the `jarcsys-collab/OneJarc` repository.
2. Put `site/`, `.github/workflows/pages.yml`, and this README at its root.
   Include hidden files: `.github` and `site/.nojekyll`. Verify them in GitHub.
3. In Settings → Pages → Build and deployment, choose **GitHub Actions**.
4. Under Actions, select **Publish OneJarc frontend test** → **Run workflow**.
   Uploading alone does not run this manually triggered workflow.
5. Open https://jarcsys-collab.github.io/OneJarc/ after the workflow succeeds.
   Hard-refresh if an older screen remains.

The workflow checks the compiled entry and `.nojekyll`, rejects raw TypeScript,
configures Pages, uploads ONLY `site`, and deploys that artifact. It does not
need Node, package.json, a source tree, or a build step on GitHub.

## What works / what remains a prototype

- Current OneJarc UI, username/password demo login, admin menu and catalog editor.
- Demo admin: `admin` / `123`; employee: `medtek` / `123`.
- Empty catalog on a fresh installation. Existing device records are not deleted.
- Catalog/admin changes remain in this browser. They are not shared across users
  or devices, do not update this ZIP, and are not written to GitHub.
- Analyze now calls the n8n test webhook. Local tool matches are labeled separately
  from the workflow reply; errors are not presented as successful API results.
- No real company authentication, secret keys, credentials or fake bearer tokens.
- The public webhook must only process non-sensitive test prompts. CORS is not
  authentication; it does not prevent non-browser clients from calling a webhook.
- This package has not been uploaded to GitHub by the assistant. It does not
  change the separate chatgpt.site publication.

## Deployment and network report — 2026-09-14

ROOT CAUSE OF NO NETWORK REQUEST:
The previous source selected development/local mode with a blank API base URL.
The Analyze handler only ran local catalog search; no `/chat` service existed.
Changing dataSource alone would also select unconfigured company authentication,
and the API client rejected missing user tokens before fetch. The old minimal
package already referenced compiled assets: a raw main.tsx problem would come
from publishing the development root rather than the generated site folder.

BACKEND PROFILE USED: staging (production-compiled frontend, staging service).

DATA SOURCE: api for Analyze/chat. Catalog and other workspace operations are
explicitly local in this narrow test; they do not silently fall back after errors.

API BASE URL: https://jarctech-ai-n8n-rnd.onrender.com/webhook

AUTH MODE: prototype-chat, unauthenticated ONLY for POST /chat at that exact
staging host. The client rejects other paths/methods in this mode. Anonymous mode
is rejected for production. Future authenticated clients still require
Authorization: Bearer <user session token> and a real company-auth adapter.

ACTION TESTED: Demo admin login → describe a task → Analyze.
Non-sensitive test text: "OneJarc deployment test: which tool can help create a presentation?"

EXPECTED REQUEST: POST https://jarctech-ai-n8n-rnd.onrender.com/webhook/chat

REQUEST OBSERVED: YES — browser Resource Timing recorded initiatorType `fetch`
for that URL after the actual Analyze click in the compiled production preview.
The built-in Test connection details disclosure showed that browser-owned record.
This confirms fetch dispatch, not that the server accepted/executed the POST.

METHOD: POST (the client submits JSON; the browser may first send OPTIONS).

URL: https://jarctech-ai-n8n-rnd.onrender.com/webhook/chat

STATUS: Browser reported a network failure with no readable HTTP response;
an earlier attempt timed out. A separate real OPTIONS preflight probe with
Origin https://jarcsys-collab.github.io returned HTTP 503 and JSON
`{"code":503,"message":"Database is not ready!"}`. That response contained no
Access-Control-Allow-Origin header. The POST may be stopped at preflight.
Do NOT interpret the OPTIONS 503 as an observed POST HTTP status.

IF NO REQUEST: Not applicable to browser fetch dispatch. Successful workflow
response is NOT verified: n8n/database availability and CORS must be fixed first.
The browser's DevTools Network panel was not directly inspected; the browser's
Resource Timing record and visible UI failure were inspected instead.

NETWORK FETCH/XHR VERIFIED: YES, request attempt only. End-to-end success: NO.

## Request flow and contract

Analyze UI → hub-controller.submitSearch → use-chat-controller.analyze →
chat-service.analyze → api-client.post → fetch → configured /chat webhook.

The only request body is `{"message":"the submitted description"}`.
No catalog, login values, role, browser records or private tokens are submitted.
The workflow's input schema could not be confirmed while it is unavailable;
this explicit contract must be matched in n8n (`body.message`).

Expected JSON reply: `{"reply":"text"}`, `{"output":"text"}`, or
`{"message":"text"}`; a JSON string or successful data envelope containing one
of those shapes is also supported. HTML, empty and malformed replies are errors.
Replies render as plain text, never executable HTML or automatically opened URLs.
Local recommendations are not relabeled as n8n recommendations.

The controller blocks duplicate submissions, supports clearing/cancellation,
keeps failures visible and does not automatically retry. Timeout is 60 seconds.
No background test request is sent on page load. Typing alone does not call n8n.
Analyze and the search suggestion buttons send the submitted description.
The existing WebMCP catalog-search tool remains local/read-only.

## Required n8n/CORS work

First restore n8n's database/service health and activate the POST /chat workflow.
The frontend cannot repair that hosted database. This task did not create a backend
or modify the n8n service.

Allow the exact Pages ORIGIN (no /OneJarc/ path):

    Access-Control-Allow-Origin: https://jarcsys-collab.github.io
    Access-Control-Allow-Methods: POST, OPTIONS
    Access-Control-Allow-Headers: Content-Type
    Vary: Origin

Return a successful OPTIONS preflight, and include the appropriate origin header
on actual success AND error responses. The anonymous test omits credentials and
Authorization; do not invent an API key. For local browser retesting, separately
allow http://127.0.0.1:4173 temporarily. Never disable browser security or use no-cors.
Future bearer APIs also need their actual requested headers allowed (Authorization,
X-Request-ID, Idempotency-Key, If-Match), server authorization and rate limiting.

In DevTools → Network → Fetch/XHR, clear the log, enter a harmless test question,
and click Analyze. Inspect /chat and the preflight (use All if OPTIONS is hidden).
Confirm request method, origin, payload and status, then confirm a valid reply in
the UI. Re-test from the actual Pages origin after deployment.

References: [n8n Webhook documentation](https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.webhook/README.md),
[Vite static deployment](https://vite.dev/guide/static-deploy),
[GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Build record (source project is separate)

Readable source is retained locally in `onejarc-github-n8n-ready-2026-09-11`.
Do not regenerate this snapshot from the older main project without carrying
these chat changes forward. The earlier ZIPs are unchanged.

FILES CHANGED in that source project:
- src/models/backend-config.ts — explicit staging chat and local workspace scope.
- src/models/api-client.ts — tightly restricted anonymous chat; bearer unchanged.
- src/models/chat-service.ts — new validated chat contract.
- src/controllers/use-chat-controller.ts — new async state and dispatch evidence.
- src/controllers/hub-controller.tsx — Analyze wiring, reply/error/disclosure.
- src/views/hooks/use-auth.tsx — local demo login for scoped prototype mode.
- src/views/hooks/use-backend.tsx — separate chat and workspace service composition.
- .github/workflows/pages.yml — reject development entries and raw TS files.
- scripts/verify-build.mjs — test root and exact /OneJarc/ asset paths.
- tests/chat.test.mjs — new scoped authentication/contract tests.
- tests/backend-ready.test.mjs — exercise explicit workspace auth configuration.

BUILD COMMAND: npm run build
Its exact equivalent used in this environment:
`node node_modules/vite/bin/vite.js build` then `node scripts/finalize-build.mjs`.
Existing pinned dependencies were reused; no dependencies or lockfile changed.

VITE BASE: ./
VITE OUTPUT DIRECTORY: site
GENERATED JS: assets/index-CTO5RLBU.js
GENERATED CSS: assets/index-FdIXYUh7.css
SITE INDEX REFERENCES RAW TS/TSX: NO
GITHUB WORKFLOW UPLOAD PATH: site

Validation: real Vite production build succeeded; TypeScript check passed;
41 offline regression/safety tests passed; every HTML asset reference exists;
JavaScript syntax and root/subpath HTTP asset checks passed; browser login and
workspace rendered at http://127.0.0.1:4173/OneJarc/. No raw main.tsx entry is
loaded, and no localhost service is required by the deployed app. Vite replaced
only its generated site output; old ZIPs and stored browser data were preserved.

## Final confirmation

DOES THE DEPLOY ZIP CONTAIN RAW src/ FILES? NO
DOES site/index.html LOAD main.tsx? NO
DOES site/index.html LOAD COMPILED JS? YES
IS GITHUB PAGES CONFIGURED TO PUBLISH site/? YES, in the included workflow;
the repository's Pages settings still must be selected by you.
IS API MODE ENABLED FOR THE N8N TEST? YES, chat only.
DOES THE INTENDED ACTION PRODUCE A REAL NETWORK REQUEST? YES, fetch attempt;
successful server execution is unverified and currently blocked.
IS THE DEPLOY PACKAGE READY TO UPLOAD DIRECTLY TO GITHUB? YES for publishing
the frontend. NO claim of a working end-to-end n8n service until the 503/CORS
issue is repaired and the workflow reply contract is confirmed.
