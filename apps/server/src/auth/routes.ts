import express, { type Request, type Response, Router } from "express";
import { CryptoProvider, ResponseMode } from "@azure/msal-node";
import type { Config } from "../config.js";
import { errorMessage, type Logger } from "../logger.js";
import { simplePage } from "../html.js";
import type { SessionUser } from "../session/session-store.js";
import {
  AUTHTX_COOKIE,
  AUTHTX_TTL_MS,
  decryptAuthTx,
  deriveAuthTxKey,
  encryptAuthTx,
  randomToken,
  readCookie,
  safeEqual,
  sanitizeReturnTo,
} from "./authtx.js";
import type { MsalAuthClient } from "./msal.js";

export const SESSION_COOKIE = "onejarc.sid";
const SCOPES = ["openid", "profile", "email"];

const authTxCookieOptions = {
  httpOnly: true,
  secure: true, // required for SameSite=None; browsers accept Secure cookies on http://localhost
  sameSite: "none" as const,
  path: "/auth",
};

function regenerate(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((err: unknown) => (err ? reject(err) : resolve())));
}
function save(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((err: unknown) => (err ? reject(err) : resolve())));
}
function destroy(req: Request): Promise<void> {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy(() => resolve());
  });
}

async function signIn(req: Request, user: SessionUser): Promise<void> {
  await regenerate(req); // prevents session fixation
  req.session.user = user;
  await save(req);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function createAuthRouter(opts: { config: Config; logger: Logger; getMsal: () => MsalAuthClient }): Router {
  const { config, logger, getMsal } = opts;
  const key = deriveAuthTxKey(config.sessionSecret);
  const cryptoProvider = new CryptoProvider();
  const router = Router();

  const failPage = (res: Response, status: number, message: string): void => {
    res
      .status(status)
      .type("html")
      .set("Cache-Control", "no-store")
      .send(simplePage("Sign-in failed", message, { href: "/auth/login", label: "Try again" }));
  };

  router.get("/login", async (req, res) => {
    const returnTo = sanitizeReturnTo(req.query.returnTo);
    try {
      if (req.session?.user) {
        res.redirect(302, returnTo);
        return;
      }
      if (config.devAuthBypass) {
        const user: SessionUser = { ...config.devAuthBypass };
        await signIn(req, user);
        logger.warn("auth.login via DEV_AUTH_BYPASS (no Entra) - never enable this outside local testing", { oid: user.oid });
        res.redirect(302, returnTo);
        return;
      }
      const pkce = await cryptoProvider.generatePkceCodes();
      const state = randomToken();
      const nonce = randomToken();
      const url = await getMsal().getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri: config.redirectUri,
        responseMode: ResponseMode.FORM_POST,
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
        state,
        nonce,
      });
      const tx = encryptAuthTx(
        { state, nonce, verifier: pkce.verifier, returnTo, exp: Date.now() + AUTHTX_TTL_MS },
        key,
      );
      res.cookie(AUTHTX_COOKIE, tx, { ...authTxCookieOptions, maxAge: AUTHTX_TTL_MS });
      res.set("Cache-Control", "no-store");
      res.redirect(302, url);
    } catch (err) {
      logger.error("auth.login failed", { error: errorMessage(err) });
      failPage(res, 500, "We could not start sign-in with Microsoft. Please try again in a moment.");
    }
  });

  router.post("/callback", express.urlencoded({ extended: false, limit: "64kb" }), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const tx = decryptAuthTx(readCookie(req.headers.cookie, AUTHTX_COOKIE), key);
    res.clearCookie(AUTHTX_COOKIE, authTxCookieOptions);

    if (!tx) {
      logger.warn("auth.callback rejected", { reason: "missing or expired login transaction" });
      return failPage(res, 400, "Your sign-in attempt expired or could not be verified. Please try again.");
    }
    const entraError = str(body.error);
    if (entraError) {
      logger.warn("auth.callback rejected", { reason: "entra error", error: entraError });
      return failPage(res, 400, "Microsoft sign-in did not complete. Please try again.");
    }
    const code = str(body.code);
    const state = str(body.state);
    if (!code || !state || !safeEqual(state, tx.state)) {
      logger.warn("auth.callback rejected", { reason: "state mismatch or missing code" });
      return failPage(res, 400, "Your sign-in attempt could not be verified. Please try again.");
    }

    try {
      const msal = getMsal();
      const result = await msal.acquireTokenByCode({
        code,
        codeVerifier: tx.verifier,
        redirectUri: config.redirectUri,
        scopes: SCOPES,
      });
      // Tokens are not kept: drop the account from MSAL's in-memory cache right away.
      if (result.account) {
        await msal
          .getTokenCache()
          .removeAccount(result.account)
          .catch(() => undefined);
      }
      const claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;
      if (str(claims.nonce) !== tx.nonce) {
        logger.warn("auth.callback rejected", { reason: "nonce mismatch" });
        return failPage(res, 400, "Your sign-in attempt could not be verified. Please try again.");
      }
      if ((str(claims.tid) ?? "").toLowerCase() !== config.entra.tenantId.toLowerCase()) {
        logger.warn("auth.callback rejected", { reason: "tenant mismatch" });
        return failPage(res, 400, "This account belongs to a different organization.");
      }
      const oid = str(claims.oid);
      if (!oid) {
        logger.warn("auth.callback rejected", { reason: "no oid claim" });
        return failPage(res, 400, "Your account information was incomplete. Please try again.");
      }
      const user: SessionUser = {
        oid,
        name: str(claims.name) ?? str(claims.preferred_username) ?? "",
        email: str(claims.email) ?? str(claims.preferred_username) ?? "",
      };
      await signIn(req, user);
      logger.info("auth.login", { oid });
      res.redirect(302, tx.returnTo);
    } catch (err) {
      logger.warn("auth.callback failed", { error: errorMessage(err) });
      return failPage(res, 400, "Microsoft sign-in could not be completed. Please try again.");
    }
  });

  router.get("/logout", async (req, res) => {
    const oid = req.session?.user?.oid;
    await destroy(req);
    res.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax", secure: config.secureCookies });
    res.set("Cache-Control", "no-store");
    if (oid) logger.info("auth.logout", { oid });
    if (config.devAuthBypass || !config.entra.tenantId) {
      res.redirect(302, "/auth/signed-out");
      return;
    }
    const signedOut = `${config.appBaseUrl}/auth/signed-out`;
    const url =
      `${config.entra.cloudInstance}${encodeURIComponent(config.entra.tenantId)}/oauth2/v2.0/logout` +
      `?post_logout_redirect_uri=${encodeURIComponent(signedOut)}`;
    res.redirect(302, url);
  });

  router.get("/signed-out", (_req, res) => {
    res
      .type("html")
      .set("Cache-Control", "no-cache")
      .send(
        simplePage("You are signed out", "You have been signed out of OneJarc.", {
          href: "/auth/login",
          label: "Sign in again",
        }),
      );
  });

  router.use((_req, res) => {
    res.status(404).type("text").send("Not found");
  });

  return router;
}
