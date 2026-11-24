import crypto from "node:crypto";

/**
 * Short-lived login transaction (state, nonce, PKCE verifier, returnTo) kept in an
 * AES-256-GCM encrypted + authenticated cookie between /auth/login and /auth/callback.
 */
export interface AuthTx {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  exp: number; // epoch ms
}

export const AUTHTX_COOKIE = "onejarc_authtx";
export const AUTHTX_TTL_MS = 10 * 60 * 1000;

export function deriveAuthTxKey(sessionSecret: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", sessionSecret, "onejarc-authtx-salt", "onejarc authtx v1", 32));
}

export function encryptAuthTx(tx: AuthTx, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(tx), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

/** Returns null if the value is missing, tampered with, malformed or expired. */
export function decryptAuthTx(value: string | undefined, key: Buffer, now = Date.now()): AuthTx | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length < 12 + 16 + 2) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    const tx = JSON.parse(json) as Partial<AuthTx>;
    if (
      typeof tx.state !== "string" ||
      typeof tx.nonce !== "string" ||
      typeof tx.verifier !== "string" ||
      typeof tx.returnTo !== "string" ||
      typeof tx.exp !== "number"
    ) {
      return null;
    }
    if (tx.exp <= now) return null;
    return tx as AuthTx;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Only same-origin absolute paths are allowed; anything else falls back to "/". */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/";
  if (value === "/auth" || value.startsWith("/auth/") || value.startsWith("/auth?")) return "/";
  return value;
}

/** Minimal Cookie header parser (express has none built in). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}
