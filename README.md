# OneJarc: editable n8n webhook configuration

## First upload — replace the app with this package once

Upload this folder's CONTENTS to your GitHub repository root, preserving the
`site/` and `.github/workflows/` folders. Include hidden files. Replace the previous
site/index.html and add the new assets, config file, and updated workflow together.
The older JavaScript does not know how to read this configuration file.

In repository Settings → Pages, select GitHub Actions. Run the Actions workflow
**Publish OneJarc frontend test**. The workflow uploads only `site/`.
Your expected site is https://jarcsys-collab.github.io/OneJarc/.
No GitHub upload or change to the separate Sites-hosted app was performed here.

## Where you change the webhook URL from now on

Open **site/onejarc-config.json** in GitHub and edit **chatWebhookUrl**:

```json
{
  "chatWebhookUrl": "https://jarctech-ai-n8n-rnd.onrender.com/webhook/chat",
  "timeoutMs": 60000
}
```

Paste the COMPLETE HTTPS webhook URL, including its path. The application does
not append /chat to this value. The optional `_comment` field in the shipped file
is an explanation, not a setting. Keep valid JSON: double quotes, no trailing comma.

Commit the change, rerun **Publish OneJarc frontend test**, wait for success, then
refresh the app. You do NOT need to rebuild JavaScript for URL changes. The app
loads configuration once per page load using a no-store request; an already open
session keeps its settings until refreshed. GitHub must publish the change first.

Never place API keys, passwords, private tokens, or confidential settings here.
This JSON and everything in site/ is publicly readable to anyone allowed to view
the website. Credential-bearing URLs and URL query parameters/fragments are rejected.
The full URL must point to your trusted, intentionally unauthenticated test workflow.
Only the description submitted through Analyze is sent there as `{"message":"..."}`.

## Scope and errors

- Only the chat webhook link is configurable. This does not connect catalog,
  admin, user accounts or shared storage to n8n.
- Demo login remains admin / 123 or medtek / 123. It is not company authentication.
- Catalog starts empty on a fresh browser; existing local records are retained.
- No fake Bearer token is sent. Future authenticated production APIs retain their
  token requirement. This JSON cannot switch authentication modes or grant access.
- Missing, invalid or unavailable config stops startup with a visible message;
  the app never silently sends a prompt to the previous compiled URL.
- Analyze uses the existing API client. The workflow should return JSON with a
  reply, output, or message string. Response text is never executed as HTML.
- If requests fail, check the workflow's availability, authentication, response
  contract and CORS. Expected allowed origin: https://jarcsys-collab.github.io
  (no /OneJarc/ path). JSON POST needs OPTIONS/POST and Content-Type permission,
  with the origin allowed on the real response as well as the preflight.
- Previous live testing returned 503 "Database is not ready!" from the configured
  n8n host. This packaging change does not fix that backend and did not retest it.

## Validation and maintenance

Production build, TypeScript check, 43 offline tests, JavaScript syntax, and
root plus /OneJarc/ asset/config delivery checks passed. Tests loaded two different
complete URLs into the same code and verified exact POST targets without tokens.
Those tests used offline transports, not real n8n responses.

The package contains eight files only: this README, the workflow, site/index.html,
site/.nojekyll, site/onejarc-config.json, site/juno-logo.svg and compiled JS/CSS.
No src/, raw TS/TSX, node_modules, secrets or development configuration is included.
The former ZIPs are preserved; this package is the new config-enabled edition.

Readable source is retained in the separate local
onejarc-github-n8n-ready-2026-09-11 project. Runtime loading is in
src/models/runtime-config.ts and src/main.tsx. The source copy of the public file
is public/onejarc-config.json; keep it in sync before any later source rebuild.
The source build remains `npm run build`, Vite base `./`, output `site/`.
