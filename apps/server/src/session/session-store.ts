import session from "express-session";

/** The signed-in user kept in the server-side session. Tokens are never stored. */
export interface SessionUser {
  oid: string;
  name: string;
  email: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}

/** Serialized session data as express-session hands it to a store (JSON-safe). */
export interface StoredSession {
  cookie?: unknown;
  user?: SessionUser;
  [key: string]: unknown;
}

/**
 * Small Promise-based store port. MemorySessionStore implements it now;
 * a MongoSessionStore can implement it later without touching routes.
 */
export interface SessionStore {
  get(sid: string): Promise<StoredSession | null>;
  set(sid: string, data: StoredSession, ttlMs: number): Promise<void>;
  touch(sid: string, data: StoredSession, ttlMs: number): Promise<void>;
  destroy(sid: string): Promise<void>;
}

interface MemoryEntry {
  json: string;
  expiresAt: number;
}

export class MemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    sweepIntervalMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    this.timer = setInterval(() => this.sweep(), sweepIntervalMs);
    this.timer.unref();
  }

  get size(): number {
    return this.entries.size;
  }

  async get(sid: string): Promise<StoredSession | null> {
    const entry = this.entries.get(sid);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(sid);
      return null;
    }
    return JSON.parse(entry.json) as StoredSession;
  }

  async set(sid: string, data: StoredSession, ttlMs: number): Promise<void> {
    this.entries.set(sid, { json: JSON.stringify(data), expiresAt: this.now() + ttlMs });
  }

  async touch(sid: string, data: StoredSession, ttlMs: number): Promise<void> {
    const entry = this.entries.get(sid);
    if (!entry) return;
    entry.json = JSON.stringify(data);
    entry.expiresAt = this.now() + ttlMs;
  }

  async destroy(sid: string): Promise<void> {
    this.entries.delete(sid);
  }

  sweep(): void {
    const t = this.now();
    for (const [sid, entry] of this.entries) {
      if (entry.expiresAt <= t) this.entries.delete(sid);
    }
  }

  close(): void {
    clearInterval(this.timer);
    this.entries.clear();
  }
}

/** Bridges any SessionStore to express-session's callback-style Store API. */
export class ExpressStoreAdapter extends session.Store {
  constructor(
    private readonly inner: SessionStore,
    private readonly defaultTtlMs: number,
  ) {
    super();
  }

  private ttl(sess: session.SessionData): number {
    const maxAge = sess.cookie?.maxAge;
    if (typeof maxAge === "number" && maxAge > 0) return maxAge;
    const expires = sess.cookie?.expires;
    if (expires) {
      const ms = new Date(expires).getTime() - Date.now();
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return this.defaultTtlMs;
  }

  override get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    this.inner.get(sid).then(
      (s) => callback(null, s as unknown as session.SessionData | null),
      (err: unknown) => callback(err),
    );
  }

  override set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    this.inner.set(sid, sess as unknown as StoredSession, this.ttl(sess)).then(
      () => callback?.(),
      (err: unknown) => callback?.(err),
    );
  }

  override touch(sid: string, sess: session.SessionData, callback?: () => void): void {
    this.inner.touch(sid, sess as unknown as StoredSession, this.ttl(sess)).then(
      () => callback?.(),
      () => callback?.(),
    );
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.inner.destroy(sid).then(
      () => callback?.(),
      (err: unknown) => callback?.(err),
    );
  }
}
