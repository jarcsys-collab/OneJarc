import path from "node:path";
import { z } from "zod";
import { isLogLevel, type LogLevel } from "./logger.js";
import { N8N_ACTIONS } from "./n8n-actions.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface DevAuthBypass {
  oid: string;
  name: string;
  email: string;
}

export interface Config {
  port: number;
  nodeEnv: string;
  appBaseUrl: string; // no trailing slash
  redirectUri: string;
  secureCookies: boolean;
  trustProxy: boolean | number | string;
  staticDir: string; // absolute
  sessionSecret: string;
  sessionMaxAgeMs: number;
  entra: {
    cloudInstance: string; // always ends with "/"
    tenantId: string;
    clientId: string;
    clientSecret: string;
  };
  adminObjectIds: ReadonlySet<string>; // lower-case
  n8nTimeoutMs: number;
  /** Raw env values keyed by env var name (N8N_URL_*). May be empty / PASTE_ placeholders. */
  n8nUrls: Readonly<Record<string, string>>;
  pbi: {
    mode: "n8n" | "server";
    tenantId: string;
    clientId: string;
    clientSecret: string;
  };
  logLevel: LogLevel;
  buildId: string;
  devAuthBypass: DevAuthBypass | null;
}

type Env = Record<string, string | undefined>;

/** Empty strings count as "unset". */
const opt = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const envSchema = z.object({
  PORT: opt,
  NODE_ENV: opt,
  APP_BASE_URL: opt,
  TRUST_PROXY: opt,
  STATIC_DIR: opt,
  SESSION_SECRET: opt,
  SESSION_MAX_AGE_HOURS: opt,
  ENTRA_CLOUD_INSTANCE: opt,
  ENTRA_TENANT_ID: opt,
  ENTRA_CLIENT_ID: opt,
  ENTRA_CLIENT_SECRET: opt,
  ADMIN_OBJECT_IDS: opt,
  N8N_TIMEOUT_MS: opt,
  PBI_EMBED_MODE: opt,
  PBI_TENANT_ID: opt,
  PBI_CLIENT_ID: opt,
  PBI_CLIENT_SECRET: opt,
  LOG_LEVEL: opt,
  RAILWAY_GIT_COMMIT_SHA: opt,
  DEV_AUTH_BYPASS_OID: opt,
  DEV_AUTH_BYPASS_NAME: opt,
  DEV_AUTH_BYPASS_EMAIL: opt,
});

function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw === undefined) return 1;
  const lower = raw.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw; // e.g. "loopback" or a CIDR list
}

function positiveNumber(raw: string | undefined, name: string, fallback: number, problems: string[]): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    problems.push(`${name} must be a positive number (got "${raw}")`);
    return fallback;
  }
  return n;
}

export function loadConfig(env: Env = process.env, opts: { cwd?: string; now?: number } = {}): Config {
  const cwd = opts.cwd ?? process.cwd();
  const now = opts.now ?? Date.now();
  const e = envSchema.parse(env);
  const missing: string[] = [];
  const problems: string[] = [];

  // --- base URL ---
  let appBaseUrl = "";
  let appUrl: URL | null = null;
  if (!e.APP_BASE_URL) missing.push("APP_BASE_URL");
  else {
    try {
      appUrl = new URL(e.APP_BASE_URL);
      if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") throw new Error("bad protocol");
      appBaseUrl = appUrl.origin;
    } catch {
      problems.push(`APP_BASE_URL must be an absolute http(s) URL (got "${e.APP_BASE_URL}")`);
    }
  }

  // --- session ---
  if (!e.SESSION_SECRET) missing.push("SESSION_SECRET");
  else if (e.SESSION_SECRET.length < 32) problems.push("SESSION_SECRET must be at least 32 characters long");
  const sessionHours = positiveNumber(e.SESSION_MAX_AGE_HOURS, "SESSION_MAX_AGE_HOURS", 8, problems);

  // --- dev bypass (local automated testing only) ---
  let devAuthBypass: DevAuthBypass | null = null;
  if (e.DEV_AUTH_BYPASS_OID) {
    const isLocal =
      appUrl !== null && appUrl.protocol === "http:" && (appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1");
    if (e.NODE_ENV === "production" || !isLocal) {
      throw new ConfigError(
        "Refusing to start: DEV_AUTH_BYPASS_OID is set, but it is only allowed when NODE_ENV is not 'production' " +
          "and APP_BASE_URL is http://localhost or http://127.0.0.1. Remove DEV_AUTH_BYPASS_* from the environment.",
      );
    }
    devAuthBypass = {
      oid: e.DEV_AUTH_BYPASS_OID,
      name: e.DEV_AUTH_BYPASS_NAME ?? "Dev User",
      email: e.DEV_AUTH_BYPASS_EMAIL ?? "dev@localhost",
    };
  }

  // --- Entra ---
  if (!devAuthBypass) {
    for (const name of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET"] as const) {
      if (!e[name]) missing.push(name);
    }
  }
  let cloudInstance = e.ENTRA_CLOUD_INSTANCE ?? "https://login.microsoftonline.com/";
  if (!cloudInstance.endsWith("/")) cloudInstance += "/";

  // --- misc ---
  const pbiMode = (e.PBI_EMBED_MODE ?? "n8n").toLowerCase();
  if (pbiMode !== "n8n" && pbiMode !== "server") problems.push(`PBI_EMBED_MODE must be "n8n" or "server" (got "${e.PBI_EMBED_MODE}")`);
  const logLevel = (e.LOG_LEVEL ?? "info").toLowerCase();
  if (!isLogLevel(logLevel)) problems.push(`LOG_LEVEL must be one of debug, info, warn, error, silent (got "${e.LOG_LEVEL}")`);
  const n8nTimeoutMs = positiveNumber(e.N8N_TIMEOUT_MS, "N8N_TIMEOUT_MS", 60_000, problems);

  let port = 3000;
  if (e.PORT !== undefined) {
    const p = Number(e.PORT);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) problems.push(`PORT must be an integer 1-65535 (got "${e.PORT}")`);
    else port = p;
  }

  if (missing.length || problems.length) {
    const lines = ["Invalid server configuration:"];
    if (missing.length) lines.push(`  Missing required environment variables: ${missing.join(", ")}`);
    for (const p of problems) lines.push(`  ${p}`);
    lines.push("  See .env.example for the full list.");
    throw new ConfigError(lines.join("\n"));
  }

  const n8nUrls: Record<string, string> = {};
  for (const action of Object.values(N8N_ACTIONS)) {
    n8nUrls[action.envVar] = (env[action.envVar] ?? "").trim();
  }

  const adminObjectIds = new Set(
    (e.ADMIN_OBJECT_IDS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const tenantId = e.ENTRA_TENANT_ID ?? "";
  const clientId = e.ENTRA_CLIENT_ID ?? "";
  const clientSecret = e.ENTRA_CLIENT_SECRET ?? "";

  return {
    port,
    nodeEnv: e.NODE_ENV ?? "development",
    appBaseUrl,
    redirectUri: `${appBaseUrl}/auth/callback`,
    secureCookies: appUrl?.protocol === "https:",
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    staticDir: path.resolve(cwd, e.STATIC_DIR ?? "site"),
    sessionSecret: e.SESSION_SECRET ?? "",
    sessionMaxAgeMs: Math.round(sessionHours * 3_600_000),
    entra: { cloudInstance, tenantId, clientId, clientSecret },
    adminObjectIds,
    n8nTimeoutMs,
    n8nUrls,
    pbi: {
      mode: pbiMode as "n8n" | "server",
      tenantId: e.PBI_TENANT_ID ?? tenantId,
      clientId: e.PBI_CLIENT_ID ?? clientId,
      clientSecret: e.PBI_CLIENT_SECRET ?? clientSecret,
    },
    logLevel: logLevel as LogLevel,
    buildId: e.RAILWAY_GIT_COMMIT_SHA ? e.RAILWAY_GIT_COMMIT_SHA.slice(0, 12) : `dev-${now}`,
    devAuthBypass,
  };
}

/** True when an N8N_URL_* value is usable (set, not a PASTE_ placeholder, absolute http(s) URL). */
export function connectedUrl(raw: string | undefined): string | null {
  if (!raw || raw.startsWith("PASTE_")) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
