import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { ConfigError, connectedUrl, loadConfig } from "../src/config.js";
import { MemorySessionStore } from "../src/session/session-store.js";
import { decryptAuthTx, deriveAuthTxKey, encryptAuthTx } from "../src/auth/authtx.js";
import { SECRET } from "./helpers.js";

const base = {
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: SECRET,
  ENTRA_TENANT_ID: "t",
  ENTRA_CLIENT_ID: "c",
  ENTRA_CLIENT_SECRET: "s",
};

describe("config", () => {
  it("lists every missing variable", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (e) {
      const msg = (e as Error).message;
      for (const v of ["APP_BASE_URL", "SESSION_SECRET", "ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET"]) {
        expect(msg).toContain(v);
      }
    }
  });

  it("rejects a short SESSION_SECRET", () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("applies defaults", () => {
    const c = loadConfig(base, { cwd: "/repo", now: 42 });
    expect(c.port).toBe(3000);
    expect(c.staticDir).toBe(path.resolve("/repo", "site"));
    expect(c.sessionMaxAgeMs).toBe(8 * 3_600_000);
    expect(c.trustProxy).toBe(1);
    expect(c.n8nTimeoutMs).toBe(60_000);
    expect(c.pbi.mode).toBe("n8n");
    expect(c.pbi.clientId).toBe("c");
    expect(c.entra.cloudInstance).toBe("https://login.microsoftonline.com/");
    expect(c.buildId).toBe("dev-42");
    expect(c.secureCookies).toBe(false);
    expect(c.redirectUri).toBe("http://localhost:3000/auth/callback");
  });

  it("https base URL → secure cookies; build id from Railway sha", () => {
    const c = loadConfig({ ...base, APP_BASE_URL: "https://x.up.railway.app/", RAILWAY_GIT_COMMIT_SHA: "0123456789abcdef" });
    expect(c.secureCookies).toBe(true);
    expect(c.appBaseUrl).toBe("https://x.up.railway.app");
    expect(c.buildId).toBe("0123456789ab");
  });

  it("dev bypass makes ENTRA_* optional on localhost", () => {
    const c = loadConfig({ APP_BASE_URL: "http://127.0.0.1:3999", SESSION_SECRET: SECRET, DEV_AUTH_BYPASS_OID: "x" });
    expect(c.devAuthBypass).toEqual({ oid: "x", name: "Dev User", email: "dev@localhost" });
  });

  it("dev bypass refuses production or a non-local base URL", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production", DEV_AUTH_BYPASS_OID: "x" })).toThrow(/Refusing to start/);
    expect(() => loadConfig({ ...base, APP_BASE_URL: "https://x.up.railway.app", DEV_AUTH_BYPASS_OID: "x" })).toThrow(/Refusing/);
    expect(() => loadConfig({ ...base, APP_BASE_URL: "https://localhost:3000", DEV_AUTH_BYPASS_OID: "x" })).toThrow(/Refusing/);
  });

  it("connectedUrl treats empty / PASTE_ / invalid as not connected", () => {
    expect(connectedUrl("")).toBeNull();
    expect(connectedUrl(undefined)).toBeNull();
    expect(connectedUrl("PASTE_URL_HERE")).toBeNull();
    expect(connectedUrl("not a url")).toBeNull();
    expect(connectedUrl("https://n8n.example.test/webhook/x")).toBe("https://n8n.example.test/webhook/x");
  });
});

describe("MemorySessionStore", () => {
  afterEach(() => vi.useRealTimers());

  it("stores copies and expires entries", async () => {
    let now = 1000;
    const store = new MemorySessionStore(60_000, () => now);
    const data = { cookie: {}, user: { oid: "o", name: "n", email: "e" } };
    await store.set("a", data, 100);
    data.user.name = "changed";
    expect((await store.get("a"))?.user?.name).toBe("n");
    now = 1050;
    await store.touch("a", data, 100);
    now = 1120;
    expect(await store.get("a")).not.toBeNull();
    now = 1200;
    store.sweep();
    expect(store.size).toBe(0);
    store.close();
  });
});

describe("authtx cookie crypto", () => {
  it("round-trips and rejects expiry / wrong key", () => {
    const key = deriveAuthTxKey(SECRET);
    const tx = { state: "s", nonce: "n", verifier: "v", returnTo: "/", exp: 2000 };
    const enc = encryptAuthTx(tx, key);
    expect(decryptAuthTx(enc, key, 1000)).toEqual(tx);
    expect(decryptAuthTx(enc, key, 2000)).toBeNull();
    expect(decryptAuthTx(enc, deriveAuthTxKey(SECRET + "x"), 1000)).toBeNull();
    expect(decryptAuthTx("garbage", key, 1000)).toBeNull();
  });
});
