import { afterAll, beforeAll } from "vitest";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server-core";

/**
 * Starts one in-memory MongoDB for the calling test file. `freshDb()` gives each
 * test its own database. The first run downloads a mongod binary (cached afterwards).
 */
export function useMongo() {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let n = 0;
  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
  }, 600_000);
  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });
  return {
    freshDb: (): Db => client.db(`test_${process.pid}_${++n}`),
    uri: () => server.getUri(),
  };
}
