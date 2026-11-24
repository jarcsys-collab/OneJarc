import express, { type ErrorRequestHandler, type Express } from "express";
import session from "express-session";
import type { Config } from "./config.js";
import { errorMessage, type Logger } from "./logger.js";
import { ExpressStoreAdapter, MemorySessionStore, type SessionStore } from "./session/session-store.js";
import { createAuthRouter, SESSION_COOKIE } from "./auth/routes.js";
import { createMsalClient, type MsalAuthClient } from "./auth/msal.js";
import { requireApiAuth, requirePageAuth } from "./auth/middleware.js";
import { createMeRouter } from "./api/me.js";
import { createN8nRouter } from "./api/n8n.js";
import { createPowerBiRouter, type PbiAppClient } from "./api/powerbi.js";
import type { FetchLike } from "./api/n8n-client.js";
import { createStaticRouter } from "./static.js";

export interface AppDeps {
  logger: Logger;
  /** Injected in tests; created lazily from config otherwise. */
  msalClient?: MsalAuthClient;
  /** Used for every outbound call (n8n, Power BI). Defaults to global fetch. */
  fetch?: FetchLike;
  pbiClient?: PbiAppClient;
  sessionStore?: SessionStore;
}

export interface CreatedApp {
  app: Express;
  /** Stops background timers (session sweep). */
  close(): void;
}

export function createApp(config: Config, deps: AppDeps): CreatedApp {
  const { logger } = deps;
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const ownStore = deps.sessionStore ? null : new MemorySessionStore();
  const store = deps.sessionStore ?? ownStore!;

  let msal = deps.msalClient;
  const getMsal = (): MsalAuthClient => {
    msal ??= createMsalClient(config, logger);
    return msal;
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  // 1. Build header on every response + one JSON log line per request.
  app.use((req, res, next) => {
    res.setHeader("X-OneJarc-Build", config.buildId);
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const path = req.originalUrl.split("?")[0] ?? "";
      const fields = {
        method: req.method,
        path,
        status: res.statusCode,
        ms: Math.round(ms * 10) / 10,
        oid: req.session?.user?.oid,
      };
      if (path === "/health") logger.debug("request", fields);
      else logger.info("request", fields);
    });
    next();
  });

  // 2. Public health check (no session, no dependencies).
  app.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ ok: true, build: config.buildId });
  });

  // 3. Old GitHub Pages path.
  app.use((req, res, next) => {
    if (req.path === "/OneJarc" || req.path.startsWith("/OneJarc/")) {
      res.redirect(301, "/");
      return;
    }
    next();
  });

  // 4. Session.
  app.use(
    session({
      name: SESSION_COOKIE,
      secret: config.sessionSecret,
      store: new ExpressStoreAdapter(store, config.sessionMaxAgeMs),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        maxAge: config.sessionMaxAgeMs,
        path: "/",
      },
    }),
  );

  // 5. Auth routes (public).
  app.use("/auth", createAuthRouter({ config, logger, getMsal }));

  // 6. API (signed in only; JSON 401, never a redirect).
  const api = express.Router();
  api.use(requireApiAuth);
  api.use(express.json({ limit: "10mb" }));
  api.use(createMeRouter(config));
  api.use("/n8n", createN8nRouter({ config, logger, fetch: fetchImpl }));
  api.use("/powerbi", createPowerBiRouter({ config, logger, fetch: fetchImpl, pbiClient: deps.pbiClient }));
  api.use((_req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });
  app.use("/api", api);

  // 7. Static site (signed in only).
  app.use(requirePageAuth, createStaticRouter({ staticDir: config.staticDir, buildId: config.buildId, logger }));

  // 8. Errors: JSON for /api, plain text elsewhere. No stack traces to clients.
  const onError: ErrorRequestHandler = (err: unknown, req, res, _next) => {
    const e = (err ?? {}) as { status?: number; statusCode?: number; type?: string };
    let status = e.status ?? e.statusCode ?? 500;
    if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
    let message = "Internal server error";
    if (e.type === "entity.parse.failed") message = "Invalid JSON body";
    else if (e.type === "entity.too.large") message = "Request body is too large";
    else if (status < 500) message = "Bad request";
    if (status >= 500) logger.error("unhandled error", { path: req.path, error: errorMessage(err) });
    if (res.headersSent) return;
    if (req.path.startsWith("/api/") || req.path === "/api") res.status(status).json({ success: false, error: message });
    else res.status(status).type("text").send(message);
  };
  app.use(onError);

  return {
    app,
    close: () => ownStore?.close(),
  };
}
