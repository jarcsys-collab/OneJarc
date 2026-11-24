import { describe, expect, it } from "vitest";
import { USER_OID, buildApp, makeConfig, signedInAgent } from "./helpers.js";
import { transformIndexHtml } from "../src/static.js";

describe("static site", () => {
  const app = buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }));

  it("transformIndexHtml puts <base> first in <head>, then the build meta", () => {
    const out = transformIndexHtml('<html><head lang="x"><meta charset="utf-8"></head></html>', "b1");
    expect(out).toMatch(/<head lang="x">\s*<base href="\/">\s*<meta name="onejarc-build" content="b1">\s*<meta charset/);
  });

  it("/ serves the transformed index.html with no-cache", async () => {
    const agent = await signedInAgent(app);
    const res = await agent.get("/").set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["etag"]).toBeTruthy();
    expect(res.text).toMatch(/<head>\s*<base href="\/">/);
    expect(res.text).toContain('<meta name="onejarc-build" content="abcdef012345">');
    expect(res.headers["x-onejarc-build"]).toBe("abcdef012345");
  });

  it("revalidation with If-None-Match returns 304", async () => {
    const agent = await signedInAgent(app);
    const first = await agent.get("/");
    const again = await agent.get("/").set("If-None-Match", first.headers["etag"] as string);
    expect(again.status).toBe(304);
  });

  it("/index.html is the transformed page too", async () => {
    const agent = await signedInAgent(app);
    const res = await agent.get("/index.html");
    expect(res.text).toContain('<base href="/">');
  });

  it("assets are served with no-cache + ETag (never immutable)", async () => {
    const agent = await signedInAgent(app);
    const res = await agent.get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["etag"]).toBeTruthy();
  });

  it("/onejarc-config.json is no-store", async () => {
    const agent = await signedInAgent(app);
    const res = await agent.get("/onejarc-config.json");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ timeoutMs: 60000 });
  });

  it("SPA fallback serves index.html for an HTML navigation to an extensionless path", async () => {
    const agent = await signedInAgent(app);
    const res = await agent.get("/some/route").set("Accept", "text/html,application/xhtml+xml");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.text).toContain('<base href="/">');
  });

  it("missing files are 404 and never HTML", async () => {
    const agent = await signedInAgent(app);
    for (const p of ["/assets/missing.js", "/missing.json", "/style.css", "/assets/deep/route"]) {
      const res = await agent.get(p).set("Accept", "text/html,*/*");
      expect(res.status, p).toBe(404);
      expect(res.headers["content-type"]).not.toMatch(/html/);
    }
  });

  it("extensionless path without Accept text/html is 404", async () => {
    const agent = await signedInAgent(app);
    const res = await agent.get("/some/route").set("Accept", "application/json");
    expect(res.status).toBe(404);
  });

  it("unknown /auth path is 404, not the SPA", async () => {
    const agent = await signedInAgent(app);
    const res = await agent.get("/auth/whatever").set("Accept", "text/html");
    expect(res.status).toBe(404);
  });
});
