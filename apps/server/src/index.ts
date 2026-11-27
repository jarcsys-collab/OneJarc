import fs from "node:fs";
import path from "node:path";
import { createApp, type AppDeps } from "./app.js";
import { connectMongo, type Mongo } from "./db/mongo.js";
import { MemoryToolRepository, MongoToolRepository } from "./catalog/tool-repository.js";
import { seedTools } from "./catalog/seed.js";
import { MongoSessionStore } from "./session/session-store.js";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

// Local convenience only: load ./.env (relative to the working directory, i.e. the repo root)
// when it exists. Real environment variables always win; Railway never has a .env file.
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    console.error(`Could not read ${envFile}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config.logLevel);

if (config.devAuthBypass) {
  const banner = "!".repeat(78);
  console.warn(
    `${banner}\n!! DEV_AUTH_BYPASS is ACTIVE: /auth/login signs everyone in as "${config.devAuthBypass.name}" ` +
      `without Microsoft Entra.\n!! For local automated testing only. Never set DEV_AUTH_BYPASS_* on Railway.\n${banner}`,
  );
  logger.warn("DEV_AUTH_BYPASS active", { oid: config.devAuthBypass.oid });
}

// MongoDB: catalog + sessions. Without MONGODB_URI (local development only; the
// config refuses it in production) both live in memory and are lost on restart.
let mongo: Mongo | null = null;
const deps: Partial<AppDeps> = {};
try {
  if (config.mongodbUri) {
    mongo = await connectMongo(config.mongodbUri, config.mongodbDb);
    const sessions = new MongoSessionStore(mongo.db);
    await sessions.init();
    deps.sessionStore = sessions;
    deps.tools = new MongoToolRepository(mongo.db);
    deps.healthCheck = () => mongo!.ping();
    logger.info("mongodb connected", { db: config.mongodbDb });
  } else {
    deps.tools = new MemoryToolRepository();
    logger.warn("MONGODB_URI is not set: catalog and sessions are in memory and are lost on restart");
  }
  if (await deps.tools.seedIfEmpty(seedTools())) logger.info("catalog seeded with example tools");
} catch (err) {
  // Never log the URI: it contains the database password.
  logger.error("startup failed: could not prepare MongoDB", { error: err instanceof Error ? err.name + ": " + err.message.replace(/mongodb(\+srv)?:\/\/[^\s]+/g, "<uri>") : String(err) });
  process.exit(1);
}

const { app, close } = createApp(config, { logger, ...deps });

const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info("server listening", {
    port: config.port,
    build: config.buildId,
    staticDir: config.staticDir,
    chat: config.chat.anthropicApiKey ? `anthropic (${config.chat.model})` : "coming-soon",
  });
});

server.on("error", (err) => {
  logger.error("server error", { error: err.message });
  process.exit(1);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  close();
  server.close(() => {
    void (mongo?.close() ?? Promise.resolve()).finally(() => process.exit(0));
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
