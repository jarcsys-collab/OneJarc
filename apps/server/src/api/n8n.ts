import { Router } from "express";
import { connectedUrl, type Config } from "../config.js";
import type { Logger } from "../logger.js";
import { getN8nAction } from "../n8n-actions.js";
import { ADMIN_REQUIRED, currentUser, isAdmin } from "../auth/middleware.js";
import { callN8n, NOT_CONNECTED, upstreamFailure, type FetchLike } from "./n8n-client.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** /api/n8n/:action — fixed allow-list proxy. Mounted behind requireApiAuth. */
export function createN8nRouter(opts: { config: Config; logger: Logger; fetch: FetchLike }): Router {
  const { config, logger } = opts;
  const router = Router();

  router.all("/:action", async (req, res) => {
    const name = String(req.params.action);
    const action = getN8nAction(name);
    if (!action) {
      res.status(404).json({ success: false, error: "Unknown action" });
      return;
    }
    if (req.method !== action.method && !(action.method === "GET" && req.method === "HEAD")) {
      res.set("Allow", action.method).status(405).json({ success: false, error: "Method not allowed" });
      return;
    }
    const user = currentUser(req)!;
    const admin = isAdmin(config, user);
    const audit = (result: "ok" | "denied" | "error", status: number) =>
      logger.info("audit", { audit: true, action: `tool.${name}`, actor: { oid: user.oid }, result, status });

    if (action.admin && !admin) {
      audit("denied", 403);
      res.status(403).json(ADMIN_REQUIRED);
      return;
    }
    const url = connectedUrl(config.n8nUrls[action.envVar]);
    if (!url) {
      res.status(501).json(NOT_CONNECTED);
      return;
    }

    let body: unknown = undefined;
    if (action.method === "POST") {
      body = req.body === undefined ? {} : req.body;
      if (name === "get-tool-creds") {
        body = { ...(isPlainObject(body) ? body : {}), email: user.email, role: admin ? "admin" : "user" };
      }
    }

    const result = await callN8n({
      fetch: opts.fetch,
      url,
      method: action.method,
      user,
      isAdmin: admin,
      body,
      timeoutMs: config.n8nTimeoutMs,
    });

    if (result.kind === "json") {
      if (action.admin) audit(result.status < 400 ? "ok" : "error", result.status);
      res.status(result.status).type("application/json").send(result.text);
      return;
    }
    const failure = upstreamFailure(result);
    logger.warn("n8n upstream failure", { action: name, kind: result.kind, upstreamStatus: "status" in result ? result.status : undefined });
    if (action.admin) audit("error", failure.status);
    res.status(failure.status).json(failure.body);
  });

  return router;
}
