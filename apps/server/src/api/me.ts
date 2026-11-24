import { Router } from "express";
import type { Config } from "../config.js";
import { currentUser, isAdmin } from "../auth/middleware.js";

/** GET /api/me — exactly { name, email, oid, isAdmin }. Mounted behind requireApiAuth. */
export function createMeRouter(config: Config): Router {
  const router = Router();
  router.get("/me", (req, res) => {
    const user = currentUser(req)!;
    res.set("Cache-Control", "no-store").json({
      name: user.name,
      email: user.email,
      oid: user.oid,
      isAdmin: isAdmin(config, user),
    });
  });
  return router;
}
