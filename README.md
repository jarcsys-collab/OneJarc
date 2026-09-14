# OneJarc connection configuration

## Important scope

This is a configuration-ready frontend, NOT a completed universal database
integration. Only Analyze/search is connected to n8n. Tools, categories,
favorites, preferences, notifications and status have clearly labeled PLANNED
configuration entries. Their save/load services are not wired to those entries.
Pasting their URLs does not activate them or move saved browser data to a database.
Keep their enabled flags false. Enabling an unsupported connection produces a
configuration error instead of pretending data is being saved remotely.

## Install once

Upload the contents of this package to your GitHub repository root, including
site/index.html, the new compiled assets, site/onejarc-config.json and the workflow.
The previous app rejects the new plannedConnections field; do not upload just
this JSON to an older app. Old ZIPs and local browser data have been preserved.

In GitHub Settings → Pages, choose GitHub Actions. Run **Publish OneJarc frontend
test** under Actions. The workflow publishes ONLY site/. This package has not
been deployed to GitHub or to the separate Sites link by the assistant.

## Edit one file after installing

Open **site/onejarc-config.json** in GitHub.

- **chatWebhookUrl**: active connection. Paste the COMPLETE HTTPS chat webhook URL,
  including its path. No /chat suffix is appended. Changing this works without a rebuild.
- **timeoutMs**: chat request timeout, 1000–60000 milliseconds.
- **plannedConnections**: places to record future readUrl/writeUrl endpoints;
  these are documentation only until authenticated integration code is implemented.
- **_comment**: explanations that are valid JSON fields, not executable code.

Commit your edit, rerun the Pages workflow, then refresh the app. Configuration
is loaded once on startup without browser-cache reuse. It is not read again by
already-open sessions until they refresh. Missing/invalid config fails visibly.

## Security and future integration

All these files are browser-visible. Never add passwords, API keys, database
credentials, tokens, or secret headers. Only use a trusted, intentionally public
test endpoint for chat. Credential-bearing URLs, query strings and fragments are
rejected. n8n must permit your Pages origin through CORS and return a valid JSON
reply. The configuration does not repair unavailable n8n services.

Future shared-data integration requires endpoint contracts, real user identity,
server-side permissions, per-user records and a database. Demo admin/123 is not
authorization for database writes. Database secrets stay in n8n/server-side
credentials. Existing browser records need an explicit migration, not automatic
upload. The anonymous chat exception never enables admin API access.

## Verification / maintenance

Build, TypeScript checks, 44 offline tests and root plus /OneJarc/ static delivery
checks passed. Tests verify URL switching without recompiling and rejection of
unsupported activation/secret fields. No live n8n workflow was called for this update.

Readable source remains in the separate onejarc-github-n8n-ready-2026-09-11 project.
The source config is public/onejarc-config.json; parser is src/models/runtime-config.ts.
Keep the source config aligned with GitHub before future source rebuilds.
This minimal package contains no raw src/, TypeScript, dependencies or build tools.
