import { describe, expect, it } from "vitest";
import type { AuthenticationResult, ClientCredentialRequest } from "@azure/msal-node";
import { ADMIN_OID, USER_OID, buildApp, fakeFetch, jsonResponse, makeConfig, signedInAgent } from "./helpers.js";
import type { PbiAppClient } from "../src/api/powerbi.js";

const CREDS_URL = "https://n8n.example.test/webhook/get-tool-creds";
const TOOLS_URL = "https://n8n.example.test/webhook/get-tools";
const WS = "aaaaaaaa-0000-0000-0000-000000000001";
const REPORT = "bbbbbbbb-0000-0000-0000-000000000002";
const DATASET = "cccccccc-0000-0000-0000-000000000003";

describe("POST /api/powerbi/embed-token (n8n mode)", () => {
  it("calls get-tool-creds with {toolName,email,role} and maps the answer", async () => {
    const f = fakeFetch(() =>
      jsonResponse({
        authorized: true,
        category: "Power BI",
        reportId: REPORT,
        targetUrl: "https://app.powerbi.com/reportEmbed?reportId=x",
        accessToken: "embed-token",
        tokenExpiration: "2030-01-01T00:00:00Z",
      }),
    );
    const app = buildApp(
      makeConfig({ N8N_URL_GET_TOOL_CREDS: CREDS_URL, DEV_AUTH_BYPASS_OID: USER_OID, DEV_AUTH_BYPASS_EMAIL: "u@example.test" }),
      { fetch: f.fn },
    );
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/powerbi/embed-token").send({ toolId: "t1", toolName: "Sales" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reportId: REPORT,
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=x",
      accessToken: "embed-token",
      expiration: "2030-01-01T00:00:00.000Z",
    });
    expect(f.calls[0]!.url).toBe(CREDS_URL);
    expect(f.calls[0]!.method).toBe("POST");
    expect(f.calls[0]!.body).toEqual({ toolName: "Sales", email: "u@example.test", role: "user" });
  });

  it("prefers embedUrl/expiration and returns expiration null when absent", async () => {
    const f = fakeFetch(() => jsonResponse({ authorized: true, reportId: REPORT, embedUrl: "https://e", targetUrl: "https://t", accessToken: "a" }));
    const app = buildApp(makeConfig({ N8N_URL_GET_TOOL_CREDS: CREDS_URL, DEV_AUTH_BYPASS_OID: ADMIN_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/powerbi/embed-token").send({ toolName: "Sales" });
    expect(res.body).toEqual({ reportId: REPORT, embedUrl: "https://e", accessToken: "a", expiration: null });
    expect(f.calls[0]!.body).toMatchObject({ role: "admin" });
  });

  it("authorized:false → 403", async () => {
    const f = fakeFetch(() => jsonResponse({ authorized: false }));
    const app = buildApp(makeConfig({ N8N_URL_GET_TOOL_CREDS: CREDS_URL, DEV_AUTH_BYPASS_OID: USER_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/powerbi/embed-token").send({ toolName: "Sales" });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("not connected → 501; missing toolName → 400", async () => {
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }), { fetch: fakeFetch().fn });
    const agent = await signedInAgent(app);
    const a = await agent.post("/api/powerbi/embed-token").send({ toolName: "Sales" });
    expect(a.status).toBe(501);
    const b = await agent.post("/api/powerbi/embed-token").send({});
    expect(b.status).toBe(400);
  });
});

describe("POST /api/powerbi/embed-token (server mode)", () => {
  function pbiClient(expiresInMs: number) {
    const requests: ClientCredentialRequest[] = [];
    const client: PbiAppClient = {
      async acquireTokenByClientCredential(req) {
        requests.push(req);
        const fresh = req.skipCache === true;
        return {
          accessToken: fresh ? "app-token-fresh" : "app-token-cached",
          expiresOn: new Date(Date.now() + (fresh ? 3_600_000 : expiresInMs)),
        } as AuthenticationResult;
      },
    };
    return { client, requests };
  }

  function pbiFetch() {
    return fakeFetch((call) => {
      if (call.url === TOOLS_URL) {
        return jsonResponse({
          tools: [
            { id: "t1", toolName: "Sales", category: "Power BI", allowedRoles: ["admin"], link: `https://app.powerbi.com/groups/${WS}/reports/${REPORT}/ReportSection` },
            { _id: "t2", draft: { name: "Ops", category: "Power BI" }, workspaceId: WS, reportId: REPORT, allowedRoles: [] },
            { id: "t3", toolName: "Wiki", category: "Docs" },
          ],
        });
      }
      if (call.url === `https://api.powerbi.com/v1.0/myorg/groups/${WS}/reports/${REPORT}`) {
        return jsonResponse({ id: REPORT, embedUrl: "https://app.powerbi.com/reportEmbed?reportId=r", datasetId: DATASET });
      }
      if (call.url === "https://api.powerbi.com/v1.0/myorg/GenerateToken") {
        return jsonResponse({ token: "embed-token-xyz", expiration: "2030-01-01T01:00:00Z" });
      }
      return new Response("not found", { status: 404 });
    });
  }

  it("resolves the tool, refreshes a short-lived app token and generates an embed token", async () => {
    const f = pbiFetch();
    const pbi = pbiClient(5 * 60_000); // cached token has < 20 min left → forced refresh
    const app = buildApp(makeConfig({ PBI_EMBED_MODE: "server", N8N_URL_GET_TOOLS: TOOLS_URL, DEV_AUTH_BYPASS_OID: USER_OID }), {
      fetch: f.fn,
      pbiClient: pbi.client,
    });
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/powerbi/embed-token").send({ toolId: "t2" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reportId: REPORT,
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=r",
      accessToken: "embed-token-xyz",
      expiration: "2030-01-01T01:00:00.000Z",
    });
    expect(pbi.requests.map((r) => r.skipCache === true)).toEqual([false, true]);
    expect(pbi.requests[0]!.scopes).toEqual(["https://analysis.windows.net/powerbi/api/.default"]);
    const gen = f.calls.find((c) => c.url.endsWith("/GenerateToken"))!;
    expect(gen.headers["authorization"]).toBe("Bearer app-token-fresh");
    expect(gen.body).toEqual({ reports: [{ id: REPORT }], datasets: [{ id: DATASET }], targetWorkspaces: [{ id: WS }] });
  });

  it("enforces allowedRoles for non-admins and parses ids from the link for admins", async () => {
    const f = pbiFetch();
    const userApp = buildApp(makeConfig({ PBI_EMBED_MODE: "server", N8N_URL_GET_TOOLS: TOOLS_URL, DEV_AUTH_BYPASS_OID: USER_OID }), {
      fetch: f.fn,
      pbiClient: pbiClient(3_600_000).client,
    });
    const user = await signedInAgent(userApp);
    expect((await user.post("/api/powerbi/embed-token").send({ toolName: "sales" })).status).toBe(403);
    expect((await user.post("/api/powerbi/embed-token").send({ toolName: "Wiki" })).status).toBe(400);
    expect((await user.post("/api/powerbi/embed-token").send({ toolId: "nope" })).status).toBe(404);

    const adminApp = buildApp(makeConfig({ PBI_EMBED_MODE: "server", N8N_URL_GET_TOOLS: TOOLS_URL, DEV_AUTH_BYPASS_OID: ADMIN_OID }), {
      fetch: pbiFetch().fn,
      pbiClient: pbiClient(3_600_000).client,
    });
    const admin = await signedInAgent(adminApp);
    const ok = await admin.post("/api/powerbi/embed-token").send({ toolName: "Sales" });
    expect(ok.status).toBe(200);
    expect(ok.body.reportId).toBe(REPORT);
  });
});
