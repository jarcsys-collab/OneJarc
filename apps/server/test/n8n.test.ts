import { describe, expect, it } from "vitest";
import { ADMIN_OID, USER_OID, buildApp, fakeFetch, makeConfig, signedInAgent } from "./helpers.js";
import { N8N_ACTIONS } from "../src/n8n-actions.js";

const ACTIONS = Object.entries(N8N_ACTIONS);

function allUrls(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, a] of ACTIONS) env[a.envVar] = `https://n8n.example.test/webhook/${name}`;
  return env;
}

describe("n8n proxy allow-list", () => {
  it("has exactly the 13 contract actions", () => {
    expect(ACTIONS.length).toBe(13);
    expect(Object.keys(N8N_ACTIONS)).not.toContain("login");
  });

  it.each(ACTIONS)("%s forwards to its env URL with the right method (admin)", async (name, action) => {
    const f = fakeFetch();
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: ADMIN_OID, DEV_AUTH_BYPASS_EMAIL: "admin@example.test" }), {
      fetch: f.fn,
    });
    const agent = await signedInAgent(app);
    const res =
      action.method === "GET"
        ? await agent.get(`/api/n8n/${name}`)
        : await agent.post(`/api/n8n/${name}`).send({ toolId: "t1", payload: { nested: [1, 2] } });
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0]!;
    expect(call.url).toBe(`https://n8n.example.test/webhook/${name}`);
    expect(call.method).toBe(action.method);
    expect(call.redirect).toBe("manual");
    expect(call.headers["accept"]).toBe("application/json");
    expect(call.headers["x-onejarc-user-oid"]).toBe(ADMIN_OID);
    expect(call.headers["x-onejarc-user-email"]).toBe("admin@example.test");
    expect(call.headers["x-onejarc-user-is-admin"]).toBe("true");
    expect(call.headers["cookie"]).toBeUndefined();
    if (action.method === "POST") {
      expect(call.headers["content-type"]).toBe("application/json");
      if (name === "get-tool-creds") {
        expect(call.body).toEqual({ toolId: "t1", payload: { nested: [1, 2] }, email: "admin@example.test", role: "admin" });
      } else {
        expect(call.body).toEqual({ toolId: "t1", payload: { nested: [1, 2] } });
      }
    } else {
      expect(call.body).toBeUndefined();
    }
  });

  it.each(ACTIONS.filter(([, a]) => a.admin))("%s is 403 for a non-admin and never calls n8n", async (name) => {
    const f = fakeFetch();
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: USER_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = await agent.post(`/api/n8n/${name}`).send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: "Administrator access required" });
    expect(f.calls).toHaveLength(0);
  });

  it.each(ACTIONS.filter(([, a]) => !a.admin))("%s is allowed for a non-admin", async (name, action) => {
    const f = fakeFetch();
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: USER_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = action.method === "GET" ? await agent.get(`/api/n8n/${name}`) : await agent.post(`/api/n8n/${name}`).send({});
    expect(res.status).toBe(200);
    expect(f.calls[0]!.headers["x-onejarc-user-is-admin"]).toBe("false");
  });

  it("get-tool-creds overrides email and role from the session", async () => {
    const f = fakeFetch();
    const app = buildApp(
      makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: USER_OID, DEV_AUTH_BYPASS_EMAIL: "user@example.test" }),
      { fetch: f.fn },
    );
    const agent = await signedInAgent(app);
    await agent.post("/api/n8n/get-tool-creds").send({ toolName: "Sales", email: "ceo@example.test", role: "admin" });
    expect(f.calls[0]!.body).toEqual({ toolName: "Sales", email: "user@example.test", role: "user" });
  });

  it("unset, empty or PASTE_ URL → 501", async () => {
    const f = fakeFetch();
    const app = buildApp(
      makeConfig({
        DEV_AUTH_BYPASS_OID: ADMIN_OID,
        N8N_URL_CHAT: "",
        N8N_URL_EDIT_TOOL: "PASTE_EDIT_TOOL_WEBHOOK_URL",
        N8N_URL_GET_TOOLS: undefined,
      }),
      { fetch: f.fn },
    );
    const agent = await signedInAgent(app);
    for (const [method, name] of [
      ["post", "chat"],
      ["post", "edit-tool"],
      ["get", "get-tools"],
    ] as const) {
      const res = await agent[method](`/api/n8n/${name}`);
      expect(res.status).toBe(501);
      expect(res.body).toEqual({ success: false, error: "This action is not connected to n8n yet." });
    }
    expect(f.calls).toHaveLength(0);
  });

  it("unknown action → 404 JSON (including the retired login action)", async () => {
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: ADMIN_OID }), { fetch: fakeFetch().fn });
    const agent = await signedInAgent(app);
    for (const name of ["login", "nope", "__proto__", "toString"]) {
      const res = await agent.post(`/api/n8n/${name}`).send({});
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: "Unknown action" });
    }
  });

  it("wrong method → 405", async () => {
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: ADMIN_OID }), { fetch: fakeFetch().fn });
    const agent = await signedInAgent(app);
    const res = await agent.get("/api/n8n/chat");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("POST");
  });

  it("passes upstream status and JSON body through as-is", async () => {
    const f = fakeFetch(() => new Response('{"success":false,"error":"Tool exists"}', { status: 409 }));
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: ADMIN_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/n8n/create-tool").send({ name: "x" });
    expect(res.status).toBe(409);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({ success: false, error: "Tool exists" });
  });

  it("non-JSON upstream body → 502 wrapped", async () => {
    const f = fakeFetch(() => new Response("<html>oops</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: USER_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/n8n/chat").send({ message: "hi" });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ success: false, error: "Unexpected response from n8n", status: 200 });
  });

  it("upstream redirect is not followed → 502", async () => {
    const f = fakeFetch(() => new Response(null, { status: 302, headers: { Location: "https://elsewhere.test/" } }));
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: USER_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/n8n/chat").send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Unexpected response from n8n");
  });

  it("upstream timeout → 504 JSON", async () => {
    const f = fakeFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: USER_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/n8n/chat").send({});
    expect(res.status).toBe(504);
    expect(res.body).toEqual({ success: false, error: "n8n did not respond in time." });
  });

  it("network failure → 502 JSON", async () => {
    const f = fakeFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: USER_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/n8n/chat").send({});
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ success: false, error: "Could not reach n8n." });
  });

  it("accepts large (base64 icon) bodies up to 10 MB", async () => {
    const f = fakeFetch(() => new Response('{"success":true}'));
    const app = buildApp(makeConfig({ ...allUrls(), DEV_AUTH_BYPASS_OID: ADMIN_OID }), { fetch: f.fn });
    const agent = await signedInAgent(app);
    const ok = await agent.post("/api/n8n/create-tool").send({ iconImage: "A".repeat(5 * 1024 * 1024) });
    expect(ok.status).toBe(200);
    const tooBig = await agent.post("/api/n8n/create-tool").send({ iconImage: "A".repeat(11 * 1024 * 1024) });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body).toEqual({ success: false, error: "Request body is too large" });
  });
});
