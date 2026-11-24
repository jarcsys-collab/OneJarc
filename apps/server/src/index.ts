import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
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

const { app, close } = createApp(config, { logger });

const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info("server listening", {
    port: config.port,
    build: config.buildId,
    staticDir: config.staticDir,
    pbiMode: config.pbi.mode,
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
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
