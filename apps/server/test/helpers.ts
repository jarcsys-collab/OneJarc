import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { silentLogger } from "../src/logger.js";

export const ADMIN_OID = "00000000-0000-0000-0000-00000000000a";
export const USER_OID = "00000000-0000-0000-0000-00000000000b";
export const TENANT = "11111111-1111-1111-1111-111111111111";
export const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

export const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>OneJarc</title>
  </head>
  <body><div id="app"></div><script type="module" src="./assets/app.js"></script></body>
</html>
`;

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** A throwaway repo root containing site/ with a few files. */
export function makeSiteRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "onejarc-test-"));
  tmpDirs.push(root);
  const site = path.join(root, "site");
  fs.mkdirSync(path.join(site, "assets"), { recursive: true });
  fs.writeFileSync(path.join(site, "index.html"), INDEX_HTML);
  fs.writeFileSync(path.join(site, "assets", "app.js"), "console.log('app');\n");
  fs.writeFileSync(path.join(site, "onejarc-config.json"), JSON.stringify({ timeoutMs: 60000 }));
  return root;
}

export function makeConfig(env: Record<string, string | undefined> = {}, cwd = makeSiteRoot()): Config {
  return loadConfig(
    {
      APP_BASE_URL: "http://localhost:3000",
      SESSION_SECRET: SECRET,
      ENTRA_TENANT_ID: TENANT,
      ENTRA_CLIENT_ID: "22222222-2222-2222-2222-222222222222",
      ENTRA_CLIENT_SECRET: "fake-client-secret",
      ADMIN_OBJECT_IDS: ` ${ADMIN_OID.toUpperCase()} , someone-else `,
      RAILWAY_GIT_COMMIT_SHA: "abcdef0123456789abcdef",
      ...env,
    },
    { cwd },
  );
}

export function buildApp(config: Config, deps: Partial<AppDeps> = {}) {
  const created = createApp(config, { logger: silentLogger, ...deps });
  afterAll(() => created.close());
  return created.app;
}

/** Signs in through the DEV_AUTH_BYPASS login and returns a cookie-keeping agent. */
export async function signedInAgent(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  const res = await agent.get("/auth/login");
  if (res.status !== 302) throw new Error(`dev login failed: ${res.status}`);
  return agent;
}

export function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers["set-cookie"];
  return Array.isArray(raw) ? (raw as string[]) : typeof raw === "string" ? [raw] : [];
}

export function cookiePair(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const c = setCookies(res).find((s) => s.startsWith(name + "="));
  return c?.split(";")[0];
}
