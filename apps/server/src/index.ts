import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { RequestListener } from "node:http";

/**
 * Startup order (each step prints something, so a crash is never silent):
 *   1. config (errors go to stderr, written synchronously, then exit 1)
 *   2. HTTP server listens at once; /health answers 503 until the database is ready
 *   3. MongoDB connect + indexes + seed, retried with backoff (never exits the process)
 *   4. the full app replaces the "starting" handler
 */

/** Writes straight to the file descriptor: process.exit() can't drop it, unlike stream writes to a pipe. */
function stderrSync(text: string): void {
  try {
    fs.writeSync(2, text.endsWith("\n") ? text : text + "\n");
  } catch {
    /* nothing left to report to */
  }
}

function fatal(message: string, err?: unknown): never {
  const detail = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : err === undefined ? "" : String(err);
  stderrSync(`[onejarc] FATAL ${message}${detail ? `\n${redact(detail)}` : ""}`);
  process.exit(1);
}

/** Never print connection strings: they contain the database password. */
function redact(text: string): string {
  return text.replace(/mongodb(\+srv)?:\/\/[^\s"']+/g, "mongodb://<redacted>");
}

process.on("uncaughtException", (err) => fatal("uncaught exception", err));
process.on("unhandledRejection", (err) => fatal("unhandled promise rejection", err));

stderrSync(`[onejarc] starting: node ${process.version}, cwd ${process.cwd()}`);

// Imports are dynamic so that a module that fails to load is reported by fatal() above.
const [{ createApp }, { connectMongo }, repoMod, { seedTools }, { MongoSessionStore }, configMod, { createLogger }] = await Promise.all([
  import("./app.js"),
  import("./db/mongo.js"),
  import("./catalog/tool-repository.js"),
  import("./catalog/seed.js"),
  import("./session/session-store.js"),
  import("./config.js"),
  import("./logger.js"),
]).catch((err: unknown) => fatal("could not load the server modules", err));
type AppDeps = import("./app.js").AppDeps;
type Mongo = import("./db/mongo.js").Mongo;

// Local convenience only: load ./.env (relative to the working directory, i.e. the repo root)
// when it exists. Real environment variables always win; Railway never has a .env file.
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    stderrSync(`[onejarc] could not read ${envFile}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let config: import("./config.js").Config;
try {
  config = configMod.loadConfig();
} catch (err) {
  if (err instanceof configMod.ConfigError) fatal(err.message);
  fatal("could not read the configuration", err);
}

const logger = createLogger(config.logLevel);

if (config.devAuthBypass) {
  const banner = "!".repeat(78);
  stderrSync(
    `${banner}\n!! DEV_AUTH_BYPASS is ACTIVE: /auth/login signs everyone in as "${config.devAuthBypass.name}" ` +
      `without Microsoft Entra.\n!! For local automated testing only. Never set DEV_AUTH_BYPASS_* on Railway.\n${banner}`,
  );
  logger.warn("DEV_AUTH_BYPASS active", { oid: config.devAuthBypass.oid });
}
if (!fs.existsSync(path.join(config.staticDir, "index.html"))) {
  logger.warn("static site not found: check STATIC_DIR", { staticDir: config.staticDir });
}

// --- 2. listen at once with a "starting" handler ---
let dbState: { state: "connecting" | "down"; error?: string; attempts: number } = { state: "connecting", attempts: 0 };
const startingHandler: RequestListener = (req, res) => {
  const body =
    req.url?.split("?")[0] === "/health"
      ? { ok: false, build: config.buildId, db: dbState.state, attempts: dbState.attempts, ...(dbState.error ? { error: dbState.error } : {}) }
      : { success: false, error: "OneJarc is starting: the database is not reachable yet. Try again in a minute." };
  res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "10", "X-OneJarc-Build": config.buildId });
  res.end(JSON.stringify(body));
};
let handler: RequestListener = startingHandler;
const server = http.createServer((req, res) => handler(req, res));
// "::" accepts IPv4 and IPv6 (Railway's private network is IPv6 in older environments).
// Hosts without IPv6 fall back to 0.0.0.0.
let host = "::";
server.on("error", (err: NodeJS.ErrnoException) => {
  if (host === "::" && (err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL")) {
    host = "0.0.0.0";
    server.listen(config.port, host);
    return;
  }
  fatal(`HTTP server error on port ${config.port}`, err);
});
server.on("listening", () => {
  logger.info("server listening", {
    port: config.port,
    build: config.buildId,
    staticDir: config.staticDir,
    production: config.production,
    database: config.mongodbUri ? "mongodb" : "memory",
    chat: config.chat.anthropicApiKey ? `anthropic (${config.chat.model})` : "coming-soon",
    host,
  });
});
server.listen(config.port, host);

// --- 3. database, retried until it works ---
let mongo: Mongo | null = null;
let closeApp: () => void = () => {};

async function prepare(): Promise<Partial<AppDeps>> {
  if (!config.mongodbUri) {
    logger.warn("MONGODB_URI is not set: catalog and sessions are in memory and are lost on restart");
    const tools = new repoMod.MemoryToolRepository();
    if (await tools.seedIfEmpty(seedTools())) logger.info("catalog seeded with example tools");
    return { tools };
  }
  const m = await connectMongo(config.mongodbUri, config.mongodbDb);
  try {
    const sessions = new MongoSessionStore(m.db);
    await sessions.init();
    const tools = new repoMod.MongoToolRepository(m.db);
    if (await tools.seedIfEmpty(seedTools())) logger.info("catalog seeded with example tools");
    mongo = m;
    logger.info("mongodb connected", { db: config.mongodbDb });
    return { tools, sessionStore: sessions, healthCheck: () => m.ping() };
  } catch (err) {
    await m.close().catch(() => undefined);
    throw err;
  }
}

function describe(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  let hint = "";
  if (/ENOTFOUND|EAI_AGAIN/.test(text) && /railway\.internal/.test(text)) {
    hint = " (private network name not resolving: is the MongoDB service in the same project and environment?)";
  } else if (/Authentication failed/i.test(text)) {
    hint = " (check that MONGODB_URI references the MongoDB service's MONGO_URL)";
  }
  return redact(text).slice(0, 400) + hint;
}

async function start(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    dbState = { ...dbState, attempts: attempt };
    try {
      const deps = await prepare();
      const created = createApp(config, { logger, ...deps });
      closeApp = created.close;
      handler = created.app as unknown as RequestListener;
      logger.info("ready", { attempts: attempt });
      return;
    } catch (err) {
      const error = describe(err);
      dbState = { state: "down", error, attempts: attempt };
      const waitMs = Math.min(30_000, 2_000 * attempt);
      logger.error("database not ready; retrying", { attempt, retryInMs: waitMs, error });
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
void start();

// --- shutdown ---
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  closeApp();
  server.close(() => {
    void ((mongo as Mongo | null)?.close() ?? Promise.resolve()).finally(() => process.exit(0));
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
