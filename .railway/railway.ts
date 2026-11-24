/**
 * OneJarc — Railway Infrastructure as Code (IaC)
 *
 * This file replaces the deprecated Config as Code files (railway.json /
 * railway.toml), which Railway stops reading on 2026-12-01.
 *
 * IMPORTANT: Railway does NOT read `.railway/` during a deploy. This file only
 * takes effect when someone applies it with the Railway CLI:
 *
 *   railway login
 *   railway link                    # pick the OneJarc project
 *   railway environment staging     # select the target environment
 *   railway config plan             # preview (safe, read-only)
 *   railway config apply            # apply after confirming the plan
 *
 * Alternatively, set the same things by hand in the Railway dashboard
 * (service source/branch, build + start command, healthcheck, replicas,
 * variables). Either way works; the file just keeps the settings reviewable.
 *
 * The CLI evaluates this file with the `railway` npm package (`railway/iac`).
 * It is not part of the app build and is not imported by apps/server.
 *
 * Secrets: every secret / tenant-specific value is `preserve()`, which means
 * "keep whatever value is already set in Railway". Set those values in the
 * dashboard (service -> Variables). Never put real ids or secrets in this file:
 * the repository is public.
 */
import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  // `production` is not used yet: only the `staging` environment exists today.
  // When production is created, it deploys from `main`; everything else
  // (staging) deploys from the `railway-entra` branch.
  const isProduction = ctx.environment === "production";
  const branch = isProduction ? "main" : "railway-entra";

  const onejarc = service("onejarc", {
    source: github("jarcsys-collab/OneJarc", { branch }),

    // Builder: Railpack (Railway's default for new services; there is no
    // Dockerfile in this repo). The documented string form below sets only
    // the build command and leaves the default builder in place.
    build: "pnpm build",
    // SDK-only (typed in `railway/iac` BuildConfig, not documented on
    // docs.railway.com/infrastructure-as-code/reference). Use instead of the
    // line above only if the builder must be pinned explicitly:
    // build: { builder: "RAILPACK", buildCommand: "pnpm build" },

    start: "pnpm start",

    healthcheck: "/health",
    healthcheckTimeout: 60,

    // Exactly 1 replica: sessions live in an in-memory store inside the Node
    // process (MemorySessionStore). A second replica would not see the first
    // replica's sessions and users would be signed out at random. Raise this
    // only after moving sessions to a shared store (e.g. Mongo/Redis).
    replicas: 1,

    env: {
      // --- Plain, non-secret values (managed by this file) ---
      NODE_ENV: "production",
      TRUST_PROXY: "1",
      STATIC_DIR: "site",
      PBI_EMBED_MODE: "n8n",
      N8N_TIMEOUT_MS: "60000",
      LOG_LEVEL: "info",

      // --- Values set in the Railway dashboard; kept as-is by apply ---
      // PORT is injected by Railway automatically; do not set it.

      // Public URL of this service, e.g. https://<service>.up.railway.app
      // (Entra redirect URI = APP_BASE_URL + /auth/callback)
      APP_BASE_URL: preserve(),
      // Secret, >= 32 random characters
      SESSION_SECRET: preserve(),
      SESSION_MAX_AGE_HOURS: preserve(),

      // Microsoft Entra ID app registration
      ENTRA_CLOUD_INSTANCE: preserve(),
      ENTRA_TENANT_ID: preserve(),
      ENTRA_CLIENT_ID: preserve(),
      ENTRA_CLIENT_SECRET: preserve(), // secret
      // Comma-separated Entra object IDs (oid) of administrators
      ADMIN_OBJECT_IDS: preserve(),

      // n8n webhook Production URLs (empty/unset -> server answers 501)
      N8N_URL_CHAT: preserve(),
      N8N_URL_GET_TOOLS: preserve(),
      N8N_URL_GET_TOOL_CREDS: preserve(),
      N8N_URL_CREATE_TOOL: preserve(),
      N8N_URL_DELETE_TOOL: preserve(),
      N8N_URL_EDIT_TOOL: preserve(),
      N8N_URL_DUPLICATE_TOOL: preserve(),
      N8N_URL_PUBLISH_TOOL: preserve(),
      N8N_URL_UNPUBLISH_TOOL: preserve(),
      N8N_URL_ENABLE_TOOL: preserve(),
      N8N_URL_DISABLE_TOOL: preserve(),
      N8N_URL_ARCHIVE_TOOL: preserve(),
      N8N_URL_RESTORE_TOOL: preserve(),

      // Power BI service principal (only used when PBI_EMBED_MODE=server;
      // defaults to the ENTRA_* values when unset)
      PBI_TENANT_ID: preserve(),
      PBI_CLIENT_ID: preserve(),
      PBI_CLIENT_SECRET: preserve(), // secret
    },
  });

  // The project name is informational; the CLI targets the project selected
  // with `railway link`.
  return project("OneJarc", {
    resources: [onejarc],
  });
});
