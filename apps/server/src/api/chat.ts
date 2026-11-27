import { Router } from "express";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { currentUser } from "../auth/middleware.js";
import { chatSummary, isPlainObject, liveDefinition, visibleToEmployees } from "../catalog/definition.js";
import type { ToolRepository } from "../catalog/tool-repository.js";
import { ChatUnavailableError, type ChatProvider } from "../chat/provider.js";

const MAX_MESSAGE = 2000;
const WINDOW_MS = 60_000;

/** POST /api/chat — { message } -> { reply }. Mounted behind requireApiAuth and express.json. */
export function createChatRouter(opts: { config: Config; logger: Logger; tools: ToolRepository; provider: ChatProvider }): Router {
  const { config, logger, tools, provider } = opts;
  const router = Router();
  const recent = new Map<string, number[]>();

  function allow(oid: string): boolean {
    const now = Date.now();
    const hits = (recent.get(oid) ?? []).filter((t) => now - t < WINDOW_MS);
    if (hits.length >= config.chat.ratePerMinute) {
      recent.set(oid, hits);
      return false;
    }
    hits.push(now);
    recent.set(oid, hits);
    if (recent.size > 10_000) recent.clear(); // bound memory; worst case a user gets a fresh window
    return true;
  }

  router.post("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = currentUser(req)!;
    const raw = isPlainObject(req.body) ? req.body.message : undefined;
    const message = typeof raw === "string" ? raw.trim() : "";
    if (!message || message.length > MAX_MESSAGE) {
      res.status(400).json({ success: false, error: `Enter a message of 1 to ${MAX_MESSAGE} characters.` });
      return;
    }
    if (!allow(user.oid)) {
      res.status(429).json({ success: false, error: "Too many messages. Wait a minute and try again." });
      return;
    }
    // Recommendations come from what an employee can open (admins included, so
    // drafts and disabled tools are never suggested).
    const catalog = (await tools.list())
      .filter((d) => visibleToEmployees(d, "user"))
      .map((d) => chatSummary(liveDefinition(d)!))
      .slice(0, 300);
    try {
      const reply = await provider.reply({ message, catalog });
      logger.info("chat.reply", { oid: user.oid, provider: provider.name, chars: reply.length });
      res.json({ reply });
    } catch (err) {
      if (err instanceof ChatUnavailableError) {
        res.status(err.status).json({ success: false, error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
