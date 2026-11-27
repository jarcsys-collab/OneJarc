import session from "express-session";
import type { Collection, Db } from "mongodb";

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

interface MongoSessionDoc {
  _id: string;
  /** JSON text: session data may contain keys MongoDB rejects. */
  json: string;
  expiresAt: Date;
}

/**
 * Sessions in MongoDB (`sessions` collection). A TTL index removes expired
 * documents; reads also check expiresAt because the TTL monitor runs only once a minute.
 * Sessions survive redeploys and are shared by all replicas.
 */
export class MongoSessionStore implements SessionStore {
  private readonly col: Collection<MongoSessionDoc>;

  constructor(
    db: Db,
    private readonly now: () => number = Date.now,
  ) {
    this.col = db.collection<MongoSessionDoc>("sessions");
  }

  /** Creates the TTL index. Safe to call on every start. */
  async init(): Promise<void> {
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });
  }

  async get(sid: string): Promise<StoredSession | null> {
    const doc = await this.col.findOne({ _id: sid, expiresAt: { $gt: new Date(this.now()) } });
    return doc ? (JSON.parse(doc.json) as StoredSession) : null;
  }

  async set(sid: string, data: StoredSession, ttlMs: number): Promise<void> {
    await this.col.updateOne(
      { _id: sid },
      { $set: { json: JSON.stringify(data), expiresAt: new Date(this.now() + ttlMs) } },
      { upsert: true },
    );
  }

  async touch(sid: string, data: StoredSession, ttlMs: number): Promise<void> {
    await this.col.updateOne({ _id: sid }, { $set: { json: JSON.stringify(data), expiresAt: new Date(this.now() + ttlMs) } });
  }

  async destroy(sid: string): Promise<void> {
    await this.col.deleteOne({ _id: sid });
  }
}
