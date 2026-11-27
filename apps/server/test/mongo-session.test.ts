import { describe, expect, it } from "vitest";
import request from "supertest";
import { USER_OID, buildApp, cookiePair, makeConfig } from "./helpers.js";
import { useMongo } from "./mongo.js";
import { MongoSessionStore } from "../src/session/session-store.js";

const mongo = useMongo();

describe("MongoSessionStore", () => {
  it("creates a TTL index on expiresAt", async () => {
    const db = mongo.freshDb();
    await new MongoSessionStore(db).init();
    const indexes = await db.collection("sessions").indexes();
    expect(indexes.find((i) => i.name === "expiresAt_ttl")).toMatchObject({ key: { expiresAt: 1 }, expireAfterSeconds: 0 });
  });

  it("set / get / touch / expiry / destroy", async () => {
    let now = 1_000_000;
    const store = new MongoSessionStore(mongo.freshDb(), () => now);
    await store.init();
    const data = { cookie: { maxAge: 100 }, user: { oid: "o", name: "n", email: "e" } };
    await store.set("sid1", data, 100);
    expect(await store.get("sid1")).toEqual(data);
    now += 90;
    await store.touch("sid1", data, 100);
    now += 90;
    expect(await store.get("sid1")).toEqual(data); // touch extended it
    now += 20;
    expect(await store.get("sid1")).toBeNull(); // expired, even before the TTL monitor runs
    await store.set("sid2", data, 1000);
    await store.destroy("sid2");
    expect(await store.get("sid2")).toBeNull();
    expect(await store.get("missing")).toBeNull();
  });

  it("a session survives a restart (a second app on the same database)", async () => {
    const db = mongo.freshDb();
    const config = makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID });
    const first = buildApp(config, { sessionStore: new MongoSessionStore(db) });
    const login = await request(first).get("/auth/login");
    const sid = cookiePair(login, "onejarc.sid")!;
    expect(sid).toBeTruthy();

    const second = buildApp(config, { sessionStore: new MongoSessionStore(db) });
    const me = await request(second).get("/api/me").set("Cookie", sid);
    expect(me.status).toBe(200);
    expect(me.body.oid).toBe(USER_OID);

    await request(second).get("/auth/logout").set("Cookie", sid);
    expect((await request(first).get("/api/me").set("Cookie", sid)).status).toBe(401);
  });
});
