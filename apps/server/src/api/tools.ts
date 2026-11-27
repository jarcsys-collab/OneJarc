import { Router, type Request, type Response } from "express";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { ADMIN_REQUIRED, currentUser, isAdmin } from "../auth/middleware.js";
import {
  adminRecord,
  definitionFromCreatePayload,
  draftDefinition,
  employeeRecord,
  fieldsFromDefinition,
  isPlainObject,
  liveDefinition,
  POWER_BI,
  ValidationError,
  validateDefinition,
  visibleToEmployees,
  type Definition,
  type NewToolDoc,
  type ToolDoc,
} from "../catalog/definition.js";
import { isToolId, type ToolRepository } from "../catalog/tool-repository.js";

export const TOOL_ACTIONS = [
  "delete",
  "edit",
  "duplicate",
  "publish",
  "unpublish",
  "enable",
  "disable",
  "archive",
  "restore",
] as const;
type ToolAction = (typeof TOOL_ACTIONS)[number];

const GUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

function fromLink(link: string, segment: "reports" | "groups"): string | undefined {
  return new RegExp(`/${segment}/(${GUID})`).exec(link)?.[1];
}

/**
 * Power BI opens with the viewer's own Power BI sign-in (user-owns-data): the
 * report's secure-embed URL, which Power BI shows only to people with access.
 */
export function powerBiEmbedUrl(def: Definition, tenantId: string): string | null {
  const link = typeof def.applicationUrl === "string" ? def.applicationUrl : "";
  if (/^https:\/\/app\.powerbi\.com\/reportEmbed\?/i.test(link)) return link;
  const reportId = fromLink(link, "reports");
  if (!reportId) return null;
  const workspace = typeof def.workspaceId === "string" && def.workspaceId ? def.workspaceId : fromLink(link, "groups");
  const url = new URL("https://app.powerbi.com/reportEmbed");
  url.searchParams.set("reportId", reportId);
  if (workspace) url.searchParams.set("groupId", workspace);
  url.searchParams.set("autoAuth", "true");
  if (tenantId) url.searchParams.set("ctid", tenantId);
  return url.toString();
}

/** /api/tools — the native tool catalog. Mounted behind requireApiAuth and express.json. */
export function createToolsRouter(opts: { config: Config; logger: Logger; tools: ToolRepository }): Router {
  const { config, logger, tools } = opts;
  const router = Router();
  const allowLocalHttp = config.nodeEnv !== "production";

  const actor = (req: Request) => {
    const user = currentUser(req)!;
    return { user, admin: isAdmin(config, user) };
  };
  const audit = (req: Request, action: string, result: "ok" | "denied" | "error", status: number, id?: string) =>
    logger.info("audit", { audit: true, action: `tool.${action}`, actor: { oid: currentUser(req)?.oid }, result, status, id });

  /** Wraps an admin-only handler: role check, audit line, JSON errors. */
  const adminOnly =
    (action: string, handler: (req: Request, res: Response) => Promise<{ status: number; body: object; id?: string }>) =>
    async (req: Request, res: Response) => {
      if (!actor(req).admin) {
        audit(req, action, "denied", 403);
        res.status(403).json(ADMIN_REQUIRED);
        return;
      }
      try {
        const out = await handler(req, res);
        audit(req, action, out.status < 400 ? "ok" : "error", out.status, out.id);
        res.status(out.status).json(out.body);
      } catch (err) {
        if (err instanceof ValidationError) {
          audit(req, action, "error", 400);
          return fail(res, 400, err.message);
        }
        audit(req, action, "error", 500);
        throw err; // -> JSON 500 from the app error handler
      }
    };

  const notFound = { status: 404, body: { success: false, error: "Tool not found." } };
  const bad = (error: string) => ({ status: 400, body: { success: false, error } });
  const ok = (id: string, extra: object = {}) => ({ status: 200, body: { success: true, id, ...extra }, id });

  // --- GET /api/tools (get-tools) ---
  router.get("/", async (req, res) => {
    const { admin } = actor(req);
    const docs = await tools.list();
    const body = admin
      ? docs.map(adminRecord)
      : docs.filter((d) => visibleToEmployees(d, "user")).map(employeeRecord);
    res.set("Cache-Control", "no-store").json(body);
  });

  // --- POST /api/tools/create (create-tool) ---
  router.post(
    "/create",
    adminOnly("create", async (req) => {
      const body = isPlainObject(req.body) ? req.body : {};
      // `publish` is optional for compatibility: a create without it goes live, as before.
      const publish = body.publish !== false;
      const def = validateDefinition(definitionFromCreatePayload(body), { publish, allowLocalHttp });
      const at = new Date().toISOString();
      const oid = currentUser(req)!.oid;
      const id = await tools.insert({
        ...fieldsFromDefinition(def),
        draft: def,
        published: publish ? true : null,
        enabled: true,
        archived: false,
        createdAt: at,
        updatedAt: at,
        createdBy: oid,
        updatedBy: oid,
      });
      return ok(id);
    }),
  );

  // --- POST /api/tools/launch (get-tool-creds) — any signed-in user ---
  router.post("/launch", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { admin } = actor(req);
    const body = isPlainObject(req.body) ? req.body : {};
    const toolId = typeof body.toolId === "string" ? body.toolId.trim() : "";
    const toolName = typeof body.toolName === "string" ? body.toolName.trim().toLowerCase() : "";
    if (!toolId && !toolName) return fail(res, 400, "toolId or toolName is required.");

    let doc: ToolDoc | null = null;
    if (toolId && isToolId(toolId)) doc = await tools.get(toolId);
    if (!doc && toolName) {
      const all = await tools.list();
      doc =
        all.find((d) => (liveDefinition(d)?.name as string | undefined)?.toLowerCase() === toolName) ??
        (admin ? all.find((d) => (draftDefinition(d).name as string).toLowerCase() === toolName) : undefined) ??
        null;
    }
    if (!doc) return fail(res, 404, "Tool not found.");

    const live = liveDefinition(doc);
    if (!admin && (!live || !doc.enabled)) return fail(res, 404, "Tool not found.");
    // Admins may open drafts to test them; everyone else gets the live version.
    const def = live ?? draftDefinition(doc);
    const category = typeof def.category === "string" ? def.category : "";
    const name = typeof def.name === "string" ? def.name : "";

    if (category === POWER_BI) {
      const roles = Array.isArray(def.allowedRoles) ? def.allowedRoles : [];
      if (!admin && roles.length > 0 && !roles.includes("user")) {
        res.json({ authorized: false, toolName: name });
        return;
      }
      const targetUrl = powerBiEmbedUrl(def, config.entra.tenantId) ?? (typeof def.applicationUrl === "string" ? def.applicationUrl : "");
      if (!targetUrl) return fail(res, 422, "This Power BI tool has no report link configured.");
      res.json({ authorized: true, category, toolName: name, targetUrl, openBehavior: "embedded" });
      return;
    }
    const targetUrl = typeof def.applicationUrl === "string" ? def.applicationUrl : "";
    if (!targetUrl) return fail(res, 422, "This tool has no application URL configured.");
    res.json({ authorized: true, category, toolName: name, targetUrl, openBehavior: def.openBehavior ?? "new-tab" });
  });

  // --- POST /api/tools/<action> (the 9 admin actions) ---
  const handlers: Record<ToolAction, (req: Request) => Promise<{ status: number; body: object; id?: string }>> = {
    async delete(req) {
      const id = req.body?.id;
      if (!isToolId(id)) return isNonEmpty(id) ? notFound : bad("The tool id is missing.");
      return (await tools.delete(id)) ? ok(id) : notFound;
    },

    async edit(req) {
      const { id, entry, publish } = req.body ?? {};
      const doc = await load(id);
      if (!isDoc(doc)) return doc;
      if (!isPlainObject(entry) || !isPlainObject(entry.draft)) return bad("The edited tool definition is missing.");
      const goLive = publish === true;
      const def = validateDefinition(entry.draft, { publish: goLive, allowLocalHttp });
      let published: NewToolDoc["published"];
      if (goLive) published = true;
      else {
        // Save draft: a live tool keeps its live version until it is published again.
        // The live version comes from the stored record, not from the browser.
        const live = liveDefinition(doc);
        published = live ? live : null;
      }
      await tools.update(doc.id, { ...fieldsFromDefinition(def), draft: def, published, ...(goLive ? { archived: false } : {}), ...stamp(req) });
      return ok(doc.id);
    },

    async duplicate(req) {
      const { id, entry } = req.body ?? {};
      const source = await load(id);
      if (!isDoc(source)) return source;
      const candidate = isPlainObject(entry) && isPlainObject(entry.draft) ? entry.draft : { ...draftDefinition(source), name: `${draftDefinition(source).name} (copy)` };
      const def = validateDefinition(candidate, { publish: false, allowLocalHttp });
      const s = stamp(req);
      const newId = await tools.insert({
        ...fieldsFromDefinition(def),
        draft: def,
        published: null,
        enabled: true,
        archived: false,
        createdAt: s.updatedAt,
        createdBy: s.updatedBy,
        ...s,
      });
      return ok(newId, { sourceId: source.id });
    },

    async publish(req) {
      const doc = await load(req.body?.id);
      if (!isDoc(doc)) return doc;
      validateDefinition(draftDefinition(doc), { publish: true, allowLocalHttp });
      await tools.update(doc.id, { published: true, archived: false, ...stamp(req) });
      return ok(doc.id);
    },
    unpublish: (req) => setFields(req, { published: null }),
    enable: (req) => setFields(req, { enabled: true }),
    disable: (req) => setFields(req, { enabled: false }),
    archive: (req) => setFields(req, { archived: true, published: null }),
    // A restored tool comes back as a draft.
    restore: (req) => setFields(req, { archived: false, published: null }),
  };

  function isNonEmpty(v: unknown): boolean {
    return typeof v === "string" && v.trim() !== "";
  }
  function isDoc(v: ToolDoc | { status: number; body: object }): v is ToolDoc {
    return "id" in v && "draft" in v;
  }
  async function load(id: unknown): Promise<ToolDoc | { status: number; body: object }> {
    if (!isNonEmpty(id)) return bad("The tool id is missing.");
    const doc = isToolId(id) ? await tools.get(id) : null;
    return doc ?? notFound;
  }
  function stamp(req: Request) {
    return { updatedAt: new Date().toISOString(), updatedBy: currentUser(req)!.oid };
  }
  async function setFields(req: Request, set: Partial<NewToolDoc>) {
    const doc = await load(req.body?.id);
    if (!isDoc(doc)) return doc;
    await tools.update(doc.id, { ...set, ...stamp(req) });
    return ok(doc.id);
  }

  for (const action of TOOL_ACTIONS) {
    router.post(`/${action}`, adminOnly(action, (req) => handlers[action](req)));
  }

  router.use((_req, res) => fail(res, 404, "Not found"));
  return router;
}
