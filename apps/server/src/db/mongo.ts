import { MongoClient, type Db } from "mongodb";

export interface Mongo {
  db: Db;
  /** Resolves true when the server answers a ping within the timeout. */
  ping(timeoutMs?: number): Promise<boolean>;
  close(): Promise<void>;
}

/** Connects at startup (never during the build). Throws if MongoDB can't be reached. */
export async function connectMongo(uri: string, dbName: string): Promise<Mongo> {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    appName: "onejarc",
  });
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  return {
    db,
    async ping(timeoutMs = 3_000) {
      try {
        await Promise.race([
          db.command({ ping: 1 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("ping timeout")), timeoutMs).unref()),
        ]);
        return true;
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}
