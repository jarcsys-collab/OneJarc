import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { ConfigError, loadConfig } from "../src/config.js";
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
    expect(c.mongodbUri).toBeNull();
    expect(c.mongodbDb).toBe("onejarc");
    expect(c.chat).toEqual({ anthropicApiKey: null, model: "claude-opus-5-5", ratePerMinute: 10 });
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

  it("MONGODB_URI is required in production and must be a mongodb URL", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/MONGODB_URI/);
    expect(() => loadConfig({ ...base, MONGODB_URI: "postgres://x" })).toThrow(/mongodb:\/\//);
    const c = loadConfig({ ...base, NODE_ENV: "production", MONGODB_URI: "mongodb://mongo:pw@mongodb.railway.internal:27017" });
    expect(c.mongodbUri).toBe("mongodb://mongo:pw@mongodb.railway.internal:27017");
  });

  it("Railway counts as production even without NODE_ENV", () => {
    expect(loadConfig(base).production).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: "production", MONGODB_URI: "mongodb://h" }).production).toBe(true);
    expect(() => loadConfig({ ...base, RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow(/MONGODB_URI/);
    const c = loadConfig({ ...base, RAILWAY_ENVIRONMENT_ID: "e", MONGODB_URI: "mongodb://h" });
    expect(c.production).toBe(true);
    expect(c.nodeEnv).toBe("development");
    expect(() =>
      loadConfig({ ...base, APP_BASE_URL: "http://localhost:3000", RAILWAY_ENVIRONMENT_NAME: "x", MONGODB_URI: "mongodb://h", DEV_AUTH_BYPASS_OID: "x" }),
    ).toThrow(/Refusing/);
  });

  it("an unresolved Railway reference in MONGODB_URI is reported by name", () => {
    expect(() => loadConfig({ ...base, MONGODB_URI: "${{Mongo.MONGO_URL}}" })).toThrow(/unresolved Railway reference/);
  });

  it("chat settings come from ANTHROPIC_API_KEY / CHAT_MODEL / CHAT_RATE_PER_MINUTE", () => {
    const c = loadConfig({ ...base, ANTHROPIC_API_KEY: "k", CHAT_MODEL: "claude-sonnet-5-5", CHAT_RATE_PER_MINUTE: "3" });
    expect(c.chat).toEqual({ anthropicApiKey: "k", model: "claude-sonnet-5-5", ratePerMinute: 3 });
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
