import fs from "node:fs";
import path from "node:path";
import express, { type Request, Router } from "express";
import type { Logger } from "./logger.js";
import { escapeHtml } from "./html.js";

/** Inserts <base href="/"> and the build meta as the first children of <head>. */
export function transformIndexHtml(html: string, buildId: string): string {
  const inject = `\n    <base href="/">\n    <meta name="onejarc-build" content="${escapeHtml(buildId)}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + inject + html.slice(at);
  }
  return inject + "\n" + html;
}

function acceptsHtml(req: Request): boolean {
  return (req.get("accept") ?? "").includes("text/html");
}

function isSpaRoute(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!acceptsHtml(req)) return false;
  const p = req.path;
  for (const prefix of ["/api", "/auth", "/assets"]) {
    if (p === prefix || p.startsWith(prefix + "/")) return false;
  }
  const last = p.split("/").pop() ?? "";
  return !last.includes(".");
}

/** Serves STATIC_DIR (behind auth). index.html is transformed once at boot and kept in memory. */
export function createStaticRouter(opts: { staticDir: string; buildId: string; logger: Logger }): Router {
  const { staticDir, buildId, logger } = opts;
  const router = Router();

  let indexHtml: string | null = null;
  try {
    indexHtml = transformIndexHtml(fs.readFileSync(path.join(staticDir, "index.html"), "utf8"), buildId);
  } catch (err) {
    logger.warn("static: index.html not found; the site will return 503", {
      staticDir,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const sendIndex: express.RequestHandler = (_req, res) => {
    if (indexHtml === null) {
      res.status(503).type("text").set("Cache-Control", "no-store").send("Site files are missing on the server.");
      return;
    }
    res.type("html").set("Cache-Control", "no-cache").send(indexHtml);
  };

  router.get(["/", "/index.html"], sendIndex);

  router.use(
    express.static(staticDir, {
      index: false,
      redirect: false,
      dotfiles: "ignore",
      etag: true,
      lastModified: true,
      cacheControl: false,
      setHeaders: (res, filePath) => {
        const rel = path.relative(staticDir, filePath).split(path.sep).join("/");
        // File names are not content-hashed yet, so everything revalidates (never immutable).
        res.setHeader("Cache-Control", rel === "onejarc-config.json" ? "no-store" : "no-cache");
      },
    }),
  );

  router.use((req, res, next) => {
    if (isSpaRoute(req)) return sendIndex(req, res, next);
    res.status(404).type("text").set("Cache-Control", "no-store").send("Not found");
  });

  return router;
}
