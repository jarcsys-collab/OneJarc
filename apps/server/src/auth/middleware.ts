import type { NextFunction, Request, Response } from "express";
import type { Config } from "../config.js";
import type { SessionUser } from "../session/session-store.js";

export const NOT_SIGNED_IN = { success: false, error: "Not signed in" } as const;
export const ADMIN_REQUIRED = { success: false, error: "Administrator access required" } as const;

export function currentUser(req: Request): SessionUser | undefined {
  return req.session?.user;
}

export function isAdmin(config: Config, user: SessionUser | undefined): boolean {
  return !!user && config.adminObjectIds.has(user.oid.toLowerCase());
}

/** For /api/*: 401 JSON, never a redirect. */
export function requireApiAuth(req: Request, res: Response, next: NextFunction): void {
  if (currentUser(req)) return next();
  res.status(401).json(NOT_SIGNED_IN);
}

function wantsHtml(req: Request): boolean {
  return (req.method === "GET" || req.method === "HEAD") && (req.get("accept") ?? "").includes("text/html");
}

/** For the static site: HTML navigations go to sign-in, everything else gets 401. */
export function requirePageAuth(req: Request, res: Response, next: NextFunction): void {
  if (currentUser(req)) return next();
  if (wantsHtml(req)) {
    res.redirect(302, `/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    return;
  }
  res.status(401).json(NOT_SIGNED_IN);
}

export function requireAdmin(config: Config) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isAdmin(config, currentUser(req))) return next();
    res.status(403).json(ADMIN_REQUIRED);
  };
}
