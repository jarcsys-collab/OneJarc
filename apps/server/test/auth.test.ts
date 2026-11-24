import { describe, expect, it } from "vitest";
import request from "supertest";
import type { AccountInfo, AuthenticationResult, AuthorizationCodeRequest, AuthorizationUrlRequest } from "@azure/msal-node";
import { TENANT, USER_OID, buildApp, cookiePair, makeConfig, setCookies } from "./helpers.js";
import type { MsalAuthClient } from "../src/auth/msal.js";
import { AUTHTX_COOKIE } from "../src/auth/authtx.js";

function fakeMsal(claims: (urlReq: AuthorizationUrlRequest) => Record<string, unknown>) {
  const state = {
    urlRequests: [] as AuthorizationUrlRequest[],
    codeRequests: [] as AuthorizationCodeRequest[],
    removed: [] as AccountInfo[],
  };
  const client: MsalAuthClient = {
    async getAuthCodeUrl(req) {
      state.urlRequests.push(req);
      return `https://login.example.test/authorize?state=${encodeURIComponent(req.state ?? "")}`;
    },
    async acquireTokenByCode(req) {
      state.codeRequests.push(req);
      const account = { homeAccountId: "h", localAccountId: "l", environment: "e", tenantId: TENANT, username: "u" } as AccountInfo;
      return { idTokenClaims: claims(state.urlRequests.at(-1)!), account } as unknown as AuthenticationResult;
    },
    getTokenCache() {
      return {
        async removeAccount(a: AccountInfo) {
          state.removed.push(a);
        },
      };
    },
  };
  return { client, state };
}

const goodClaims = (u: AuthorizationUrlRequest) => ({
  nonce: u.nonce,
  tid: TENANT,
  oid: USER_OID,
  name: "Grace Hopper",
  preferred_username: "grace@example.test",
});

async function startLogin(app: Parameters<typeof request>[0], returnTo = "/tools?x=1") {
  const res = await request(app).get(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  return res;
}

describe("Entra sign-in flow (fake MSAL)", () => {
  it("/auth/login redirects to Entra with PKCE S256, form_post, state and nonce, and sets the authtx cookie", async () => {
    const msal = fakeMsal(goodClaims);
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const res = await startLogin(app);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.example\.test\/authorize/);
    const req = msal.state.urlRequests[0]!;
    expect(req.responseMode).toBe("form_post");
    expect(req.codeChallengeMethod).toBe("S256");
    expect(req.codeChallenge).toBeTruthy();
    expect(req.scopes).toEqual(["openid", "profile", "email"]);
    expect(req.redirectUri).toBe("http://localhost:3000/auth/callback");
    expect(req.state).toBeTruthy();
    expect(req.nonce).toBeTruthy();
    const cookie = setCookies(res).find((c) => c.startsWith(AUTHTX_COOKIE + "="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=None/);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).not.toContain(req.state!); // encrypted, not plain
  });

  it("successful callback signs in, removes the MSAL account and redirects to returnTo", async () => {
    const msal = fakeMsal(goodClaims);
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const login = await startLogin(app);
    const tx = cookiePair(login, AUTHTX_COOKIE)!;
    const state = msal.state.urlRequests[0]!.state!;

    const cb = await request(app)
      .post("/auth/callback")
      .set("Cookie", tx)
      .type("form")
      .send({ code: "auth-code-123", state });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe("/tools?x=1");
    expect(msal.state.codeRequests[0]).toMatchObject({
      code: "auth-code-123",
      redirectUri: "http://localhost:3000/auth/callback",
      scopes: ["openid", "profile", "email"],
    });
    expect(msal.state.codeRequests[0]!.codeVerifier).toBeTruthy();
    expect(msal.state.removed).toHaveLength(1);
    // authtx cookie cleared
    expect(setCookies(cb).some((c) => c.startsWith(AUTHTX_COOKIE + "=;"))).toBe(true);

    const sid = cookiePair(cb, "onejarc.sid")!;
    const me = await request(app).get("/api/me").set("Cookie", sid);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ name: "Grace Hopper", email: "grace@example.test", oid: USER_OID, isAdmin: false });
  });

  it("prefers the email claim over preferred_username", async () => {
    const msal = fakeMsal((u) => ({ ...goodClaims(u), email: "g.hopper@example.test" }));
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const login = await startLogin(app);
    const cb = await request(app)
      .post("/auth/callback")
      .set("Cookie", cookiePair(login, AUTHTX_COOKIE)!)
      .type("form")
      .send({ code: "c", state: msal.state.urlRequests[0]!.state! });
    const me = await request(app).get("/api/me").set("Cookie", cookiePair(cb, "onejarc.sid")!);
    expect(me.body.email).toBe("g.hopper@example.test");
  });

  it("state mismatch → 400 page with a Try again link, no token call", async () => {
    const msal = fakeMsal(goodClaims);
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const login = await startLogin(app);
    const cb = await request(app)
      .post("/auth/callback")
      .set("Cookie", cookiePair(login, AUTHTX_COOKIE)!)
      .type("form")
      .send({ code: "c", state: "wrong-state" });
    expect(cb.status).toBe(400);
    expect(cb.headers["content-type"]).toMatch(/text\/html/);
    expect(cb.text).toContain('href="/auth/login"');
    expect(cb.text).toContain("Try again");
    expect(msal.state.codeRequests).toHaveLength(0);
    expect(cookiePair(cb, "onejarc.sid")).toBeUndefined();
  });

  it("missing authtx cookie → 400", async () => {
    const msal = fakeMsal(goodClaims);
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const cb = await request(app).post("/auth/callback").type("form").send({ code: "c", state: "s" });
    expect(cb.status).toBe(400);
  });

  it("tampered authtx cookie → 400", async () => {
    const msal = fakeMsal(goodClaims);
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const login = await startLogin(app);
    const tx = cookiePair(login, AUTHTX_COOKIE)!;
    const tampered = tx.slice(0, -4) + (tx.endsWith("AAAA") ? "BBBB" : "AAAA");
    const cb = await request(app)
      .post("/auth/callback")
      .set("Cookie", tampered)
      .type("form")
      .send({ code: "c", state: msal.state.urlRequests[0]!.state! });
    expect(cb.status).toBe(400);
  });

  it("nonce mismatch → 400", async () => {
    const msal = fakeMsal((u) => ({ ...goodClaims(u), nonce: "other" }));
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const login = await startLogin(app);
    const cb = await request(app)
      .post("/auth/callback")
      .set("Cookie", cookiePair(login, AUTHTX_COOKIE)!)
      .type("form")
      .send({ code: "c", state: msal.state.urlRequests[0]!.state! });
    expect(cb.status).toBe(400);
    expect(cookiePair(cb, "onejarc.sid")).toBeUndefined();
  });

  it("wrong tenant → 400", async () => {
    const msal = fakeMsal((u) => ({ ...goodClaims(u), tid: "99999999-9999-9999-9999-999999999999" }));
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const login = await startLogin(app);
    const cb = await request(app)
      .post("/auth/callback")
      .set("Cookie", cookiePair(login, AUTHTX_COOKIE)!)
      .type("form")
      .send({ code: "c", state: msal.state.urlRequests[0]!.state! });
    expect(cb.status).toBe(400);
  });

  it("Entra error in the form post → 400", async () => {
    const msal = fakeMsal(goodClaims);
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const login = await startLogin(app);
    const cb = await request(app)
      .post("/auth/callback")
      .set("Cookie", cookiePair(login, AUTHTX_COOKIE)!)
      .type("form")
      .send({ error: "access_denied", error_description: "nope", state: msal.state.urlRequests[0]!.state! });
    expect(cb.status).toBe(400);
  });

  it("MSAL failure → 400", async () => {
    const msal = fakeMsal(goodClaims);
    msal.client.acquireTokenByCode = async () => {
      throw new Error("invalid_grant");
    };
    const app = buildApp(makeConfig(), { msalClient: msal.client });
    const login = await startLogin(app);
    const cb = await request(app)
      .post("/auth/callback")
      .set("Cookie", cookiePair(login, AUTHTX_COOKIE)!)
      .type("form")
      .send({ code: "c", state: msal.state.urlRequests[0]!.state! });
    expect(cb.status).toBe(400);
  });

  it("logout redirects to the Entra logout endpoint with post_logout_redirect_uri", async () => {
    const app = buildApp(makeConfig(), { msalClient: fakeMsal(goodClaims).client });
    const res = await request(app).get("/auth/logout");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(
        "http://localhost:3000/auth/signed-out",
      )}`,
    );
  });
});
