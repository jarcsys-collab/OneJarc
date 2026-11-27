import { describe, expect, it } from "vitest";
import request from "supertest";
import { ADMIN_OID, USER_OID, buildApp, makeConfig, signedInAgent } from "./helpers.js";

describe("public endpoints and the auth gate", () => {
  const app = buildApp(makeConfig());

  it("GET /health returns ok + build id", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, build: "abcdef012345" });
    expect(res.headers["x-onejarc-build"]).toBe("abcdef012345");
  });

  it("unauthenticated HTML navigation to / redirects to sign-in", async () => {
    const res = await request(app).get("/").set("Accept", "text/html");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/auth/login?returnTo=%2F");
  });

  it("keeps path + query in returnTo", async () => {
    const res = await request(app).get("/tools/x?a=1").set("Accept", "text/html,*/*");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/auth/login?returnTo=${encodeURIComponent("/tools/x?a=1")}`);
  });

  it("unauthenticated non-HTML request to the site gets 401", async () => {
    const res = await request(app).get("/assets/app.js").set("Accept", "*/*");
    expect(res.status).toBe(401);
  });

  it("unauthenticated /api/me is 401 JSON, never a redirect", async () => {
    const res = await request(app).get("/api/me").set("Accept", "text/html");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: "Not signed in" });
  });

  it("unauthenticated /api/chat and /api/tools are 401 JSON", async () => {
    for (const res of [await request(app).post("/api/chat").send({ message: "hi" }), await request(app).get("/api/tools")]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, error: "Not signed in" });
    }
  });

  it("/auth/signed-out is public HTML", async () => {
    const res = await request(app).get("/auth/signed-out");
    expect(res.status).toBe(200);
    expect(res.text).toContain("You are signed out");
    expect(res.text).toContain('href="/auth/login"');
  });

  it("/OneJarc and /OneJarc/* redirect 301 to /", async () => {
    for (const p of ["/OneJarc", "/OneJarc/", "/OneJarc/index.html"]) {
      const res = await request(app).get(p);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe("/");
    }
  });
});

describe("dev auth bypass + /api/me", () => {
  it("admin oid gets isAdmin true (case-insensitive list)", async () => {
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: ADMIN_OID, DEV_AUTH_BYPASS_NAME: "Ada", DEV_AUTH_BYPASS_EMAIL: "ada@example.test" }));
    const agent = await signedInAgent(app);
    const res = await agent.get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "Ada", email: "ada@example.test", oid: ADMIN_OID, isAdmin: true });
  });

  it("other oid gets isAdmin false, with default name/email", async () => {
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }));
    const agent = await signedInAgent(app);
    const res = await agent.get("/api/me");
    expect(res.body).toEqual({ name: "Dev User", email: "dev@localhost", oid: USER_OID, isAdmin: false });
  });

  it("login honours a same-origin returnTo and rejects others", async () => {
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }));
    const a = await request(app).get("/auth/login?returnTo=%2Ftools%3Fx%3D1");
    expect(a.headers.location).toBe("/tools?x=1");
    for (const bad of ["https://evil.test/", "//evil.test", "/\\evil.test", "/auth/login"]) {
      const r = await request(app).get(`/auth/login?returnTo=${encodeURIComponent(bad)}`);
      expect(r.headers.location).toBe("/");
    }
  });

  it("session cookie is HttpOnly, SameSite=Lax, not Secure on http://localhost", async () => {
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }));
    const res = await request(app).get("/auth/login");
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("onejarc.sid="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it("logout destroys the session", async () => {
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }));
    const agent = await signedInAgent(app);
    const out = await agent.get("/auth/logout");
    expect(out.status).toBe(302);
    expect(out.headers.location).toBe("/auth/signed-out");
    const me = await agent.get("/api/me");
    expect(me.status).toBe(401);
  });

  it("unknown /api route is 404 JSON", async () => {
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }));
    const agent = await signedInAgent(app);
    const res = await agent.get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: "Not found" });
  });

  it("invalid JSON body is 400 JSON", async () => {
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }));
    const agent = await signedInAgent(app);
    const res = await agent.post("/api/chat").set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: "Invalid JSON body" });
  });
});

describe("request logging", () => {
  it("logs one JSON line per request with full path, status, ms and oid, and no cookies/bodies", async () => {
    const { createLogger } = await import("../src/logger.js");
    const lines: string[] = [];
    const logger = createLogger("info", (line) => lines.push(line));
    const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }), { logger });
    const agent = await signedInAgent(app);
    await agent.post("/api/chat?x=1").send({ message: "secret message" });
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e.msg === "request");
    const chat = entries.find((e) => e.path === "/api/chat")!;
    expect(chat).toMatchObject({ method: "POST", status: 200, oid: USER_OID });
    expect(typeof chat.ms).toBe("number");
    const all = lines.join("\n");
    expect(all).not.toContain("secret message");
    expect(all).not.toContain("onejarc.sid");
  });
});

describe("/health with a database check", () => {
  it("answers 200 with db ok, and 503 when the database is down", async () => {
    let up = true;
    const app = buildApp(makeConfig(), { healthCheck: async () => up });
    const okRes = await request(app).get("/health");
    expect(okRes.status).toBe(200);
    expect(okRes.body).toEqual({ ok: true, build: "abcdef012345", db: "ok" });
    up = false;
    const down = await request(app).get("/health");
    expect(down.status).toBe(503);
    expect(down.body).toEqual({ ok: false, build: "abcdef012345", db: "down" });
  });
});
