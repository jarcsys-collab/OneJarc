import crypto from "node:crypto";
import { ObjectId, type Collection, type Db } from "mongodb";
import type { NewToolDoc, ToolDoc } from "./definition.js";

/** Storage port for the tool catalog. Ids are 24-character hex strings. */
export interface ToolRepository {
  list(): Promise<ToolDoc[]>;
  get(id: string): Promise<ToolDoc | null>;
  insert(doc: NewToolDoc): Promise<string>;
  /** Sets the given fields. Returns false when no tool has that id. */
  update(id: string, set: Partial<NewToolDoc>): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  /** Inserts `docs` once, on first start, when the collection is empty. Returns true if it did. */
  seedIfEmpty(docs: NewToolDoc[]): Promise<boolean>;
}

const ID = /^[0-9a-f]{24}$/i;
export function isToolId(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

type StoredTool = Omit<ToolDoc, "id"> & { _id: ObjectId };

function fromStored(stored: StoredTool): ToolDoc {
  const { _id, ...rest } = stored;
  return { id: _id.toHexString(), ...rest };
}

export class MongoToolRepository implements ToolRepository {
  private readonly tools: Collection<StoredTool>;
  private readonly meta: Collection<{ _id: string; at: string }>;

  constructor(db: Db) {
    this.tools = db.collection<StoredTool>("tools");
    this.meta = db.collection<{ _id: string; at: string }>("meta");
  }

  async list(): Promise<ToolDoc[]> {
    const docs = await this.tools.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
    return docs.map(fromStored);
  }

  async get(id: string): Promise<ToolDoc | null> {
    if (!isToolId(id)) return null;
    const doc = await this.tools.findOne({ _id: new ObjectId(id) });
    return doc ? fromStored(doc) : null;
  }

  async insert(doc: NewToolDoc): Promise<string> {
    const _id = new ObjectId();
    await this.tools.insertOne({ ...doc, _id });
    return _id.toHexString();
  }

  async update(id: string, set: Partial<NewToolDoc>): Promise<boolean> {
    if (!isToolId(id)) return false;
    const result = await this.tools.updateOne({ _id: new ObjectId(id) }, { $set: set });
    return result.matchedCount === 1;
  }

  async delete(id: string): Promise<boolean> {
    if (!isToolId(id)) return false;
    const result = await this.tools.deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount === 1;
  }

  async seedIfEmpty(docs: NewToolDoc[]): Promise<boolean> {
    if ((await this.tools.estimatedDocumentCount()) > 0) return false;
    // The marker makes seeding happen once, even with several replicas starting together,
    // and never again after an admin deletes every tool.
    try {
      await this.meta.insertOne({ _id: "catalog-seed", at: new Date().toISOString() });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
    await this.tools.insertMany(docs.map((d) => ({ ...d, _id: new ObjectId() })));
    return true;
  }
}

/** In-process catalog for local development and tests without MongoDB. Lost on restart. */
export class MemoryToolRepository implements ToolRepository {
  private readonly docs = new Map<string, NewToolDoc>();
  private seeded = false;

  async list(): Promise<ToolDoc[]> {
    return [...this.docs].map(([id, d]) => structuredClone({ id, ...d }));
  }
  async get(id: string): Promise<ToolDoc | null> {
    const d = this.docs.get(id);
    return d ? structuredClone({ id, ...d }) : null;
  }
  async insert(doc: NewToolDoc): Promise<string> {
    const id = crypto.randomBytes(12).toString("hex");
    this.docs.set(id, structuredClone(doc));
    return id;
  }
  async update(id: string, set: Partial<NewToolDoc>): Promise<boolean> {
    const d = this.docs.get(id);
    if (!d) return false;
    this.docs.set(id, structuredClone({ ...d, ...set }));
    return true;
  }
  async delete(id: string): Promise<boolean> {
    return this.docs.delete(id);
  }
  async seedIfEmpty(docs: NewToolDoc[]): Promise<boolean> {
    if (this.seeded || this.docs.size > 0) return false;
    this.seeded = true;
    for (const d of docs) await this.insert(d);
    return true;
  }
}
