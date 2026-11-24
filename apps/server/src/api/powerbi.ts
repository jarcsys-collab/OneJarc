import { Router, type Response } from "express";
import { z } from "zod";
import { ConfidentialClientApplication } from "@azure/msal-node";
import type { AuthenticationResult, ClientCredentialRequest } from "@azure/msal-node";
import { connectedUrl, type Config } from "../config.js";
import { errorMessage, type Logger } from "../logger.js";
import { currentUser, isAdmin } from "../auth/middleware.js";
import type { SessionUser } from "../session/session-store.js";
import { callN8n, NOT_CONNECTED, upstreamFailure, type FetchLike } from "./n8n-client.js";

export const PBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const PBI_API = "https://api.powerbi.com/v1.0/myorg";
const CATALOG_TTL_MS = 30_000;
const MIN_APP_TOKEN_LIFETIME_MS = 20 * 60_000;

/** The subset of ConfidentialClientApplication used for the Power BI service principal. */
export interface PbiAppClient {
  acquireTokenByClientCredential(request: ClientCredentialRequest): Promise<AuthenticationResult | null>;
}

export interface EmbedTokenResponse {
  reportId: string;
  embedUrl: string;
  accessToken: string;
  expiration: string | null;
}

const bodySchema = z.object({
  toolId: z.string().trim().min(1).optional(),
  toolName: z.string().trim().min(1).optional(),
});

type Json = Record<string, unknown>;

function obj(v: unknown): Json | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
function toIso(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  return null;
}

const GUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
function fromLink(link: string | undefined, segment: "reports" | "groups"): string | undefined {
  if (!link) return undefined;
  const m = new RegExp(`/${segment}/(${GUID})`).exec(link);
  return m?.[1];
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error });
}

/** Extracts the tool list from a get-tools answer (an array or { tools: [...] }). */
export function catalogRecords(data: unknown): Json[] {
  const list = Array.isArray(data) ? data : Array.isArray(obj(data)?.tools) ? (obj(data)!.tools as unknown[]) : [];
  return list.map(obj).filter((t): t is Json => t !== undefined);
}

export function describeTool(tool: Json) {
  const draft = obj(tool.draft);
  const published = obj(tool.published);
  const id = str(tool.id) ?? str(tool._id) ?? str(obj(tool._id)?.$oid);
  const name = str(draft?.name) ?? str(tool.toolName) ?? str(tool.name) ?? str(published?.name);
  const category = str(draft?.category) ?? str(tool.category) ?? str(published?.category);
  const rolesRaw = Array.isArray(tool.allowedRoles)
    ? tool.allowedRoles
    : Array.isArray(draft?.allowedRoles)
      ? draft.allowedRoles
      : [];
  const allowedRoles = rolesRaw.filter((r): r is string => typeof r === "string").map((r) => r.trim().toLowerCase());
  const link = str(tool.link) ?? str(draft?.link) ?? str(published?.link) ?? str(draft?.applicationUrl);
  const reportId = str(tool.reportId) ?? str(draft?.reportId) ?? str(published?.reportId) ?? fromLink(link, "reports");
  const workspaceId =
    str(tool.workspaceId) ?? str(draft?.workspaceId) ?? str(published?.workspaceId) ?? fromLink(link, "groups");
  return { id, name, category, allowedRoles, reportId, workspaceId };
}

export function createPowerBiRouter(opts: {
  config: Config;
  logger: Logger;
  fetch: FetchLike;
  pbiClient?: PbiAppClient;
}): Router {
  const { config, logger } = opts;
  const router = Router();
  let pbiClient = opts.pbiClient;
  let catalogCache: { at: number; tools: Json[] } | null = null;

  const getPbiClient = (): PbiAppClient => {
    pbiClient ??= new ConfidentialClientApplication({
      auth: {
        clientId: config.pbi.clientId,
        authority: config.entra.cloudInstance + config.pbi.tenantId,
        clientSecret: config.pbi.clientSecret,
      },
    });
    return pbiClient;
  };

  async function appToken(): Promise<string> {
    const client = getPbiClient();
    let result = await client.acquireTokenByClientCredential({ scopes: [PBI_SCOPE] });
    const left = result?.expiresOn ? result.expiresOn.getTime() - Date.now() : 0;
    if (!result || left < MIN_APP_TOKEN_LIFETIME_MS) {
      // The embed token lives only as long as this app token, so force a fresh one.
      result = await client.acquireTokenByClientCredential({ scopes: [PBI_SCOPE], skipCache: true });
    }
    if (!result?.accessToken) throw new Error("No Power BI app token returned");
    return result.accessToken;
  }

  async function loadCatalog(user: SessionUser, admin: boolean): Promise<Json[] | { status: number; body: object }> {
    if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.tools;
    const url = connectedUrl(config.n8nUrls.N8N_URL_GET_TOOLS);
    if (!url) return { status: 501, body: NOT_CONNECTED };
    const result = await callN8n({
      fetch: opts.fetch,
      url,
      method: "GET",
      user,
      isAdmin: admin,
      timeoutMs: config.n8nTimeoutMs,
    });
    if (result.kind !== "json") return upstreamFailure(result);
    if (result.status >= 400) return { status: 502, body: { success: false, error: "Could not load the tool catalog." } };
    const tools = catalogRecords(result.data);
    catalogCache = { at: Date.now(), tools };
    return tools;
  }

  async function pbiFetch(url: string, token: string, init: RequestInit = {}): Promise<Json> {
    const response = await opts.fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(config.n8nTimeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Power BI API ${response.status}`);
    const data = obj(JSON.parse(text));
    if (!data) throw new Error("Power BI API returned a non-object");
    return data;
  }

  router.post("/embed-token", async (req, res) => {
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail(res, 400, "Invalid request body");
    const { toolId, toolName } = parsed.data;
    const user = currentUser(req)!;
    const admin = isAdmin(config, user);
    const role = admin ? "admin" : "user";
    res.set("Cache-Control", "no-store");

    if (config.pbi.mode === "n8n") {
      if (!toolName) return fail(res, 400, "toolName is required");
      const url = connectedUrl(config.n8nUrls.N8N_URL_GET_TOOL_CREDS);
      if (!url) {
        res.status(501).json(NOT_CONNECTED);
        return;
      }
      const result = await callN8n({
        fetch: opts.fetch,
        url,
        method: "POST",
        user,
        isAdmin: admin,
        body: { toolName, email: user.email, role },
        timeoutMs: config.n8nTimeoutMs,
      });
      if (result.kind !== "json") {
        const f = upstreamFailure(result);
        res.status(f.status).json(f.body);
        return;
      }
      if (result.status >= 400) {
        res.status(result.status).type("application/json").send(result.text);
        return;
      }
      const data = obj(result.data);
      if (!data) return fail(res, 502, "Unexpected response from n8n");
      if (data.authorized === false) return fail(res, 403, "You do not have access to this report.");
      const reportId = str(data.reportId);
      const embedUrl = str(data.embedUrl) ?? str(data.targetUrl);
      const accessToken = str(data.accessToken);
      if (!reportId || !embedUrl || !accessToken) return fail(res, 502, "n8n did not return Power BI embed details.");
      const body: EmbedTokenResponse = {
        reportId,
        embedUrl,
        accessToken,
        expiration: toIso(data.expiration ?? data.tokenExpiration),
      };
      res.json(body);
      return;
    }

    // --- server mode: service principal + Power BI REST API ---
    if (!toolId && !toolName) return fail(res, 400, "toolId or toolName is required");
    try {
      const catalog = await loadCatalog(user, admin);
      if (!Array.isArray(catalog)) {
        res.status(catalog.status).json(catalog.body);
        return;
      }
      const tools = catalog.map(describeTool);
      const tool =
        (toolId ? tools.find((t) => t.id === toolId) : undefined) ??
        (toolName ? tools.find((t) => t.name?.toLowerCase() === toolName.toLowerCase()) : undefined);
      if (!tool) return fail(res, 404, "Tool not found");
      if ((tool.category ?? "").toLowerCase() !== "power bi") return fail(res, 400, "This tool is not a Power BI report.");
      if (!admin && tool.allowedRoles.length > 0 && !tool.allowedRoles.includes(role)) {
        return fail(res, 403, "You do not have access to this report.");
      }
      if (!tool.reportId || !tool.workspaceId) return fail(res, 422, "This Power BI tool has no report or workspace configured.");

      const token = await appToken();
      const ws = encodeURIComponent(tool.workspaceId);
      const report = await pbiFetch(`${PBI_API}/groups/${ws}/reports/${encodeURIComponent(tool.reportId)}`, token);
      const embedUrl = str(report.embedUrl);
      const datasetId = str(report.datasetId);
      if (!embedUrl || !datasetId) throw new Error("Power BI report has no embedUrl/datasetId");
      const generated = await pbiFetch(`${PBI_API}/GenerateToken`, token, {
        method: "POST",
        body: JSON.stringify({
          reports: [{ id: tool.reportId }],
          datasets: [{ id: datasetId }],
          targetWorkspaces: [{ id: tool.workspaceId }],
        }),
      });
      const accessToken = str(generated.token);
      if (!accessToken) throw new Error("Power BI GenerateToken returned no token");
      logger.info("powerbi.embed", { oid: user.oid, reportId: tool.reportId });
      const body: EmbedTokenResponse = {
        reportId: tool.reportId,
        embedUrl,
        accessToken,
        expiration: toIso(generated.expiration),
      };
      res.json(body);
    } catch (err) {
      logger.error("powerbi.embed failed", { oid: user.oid, error: errorMessage(err) });
      fail(res, 502, "Could not create a Power BI embed token.");
    }
  });

  return router;
}
