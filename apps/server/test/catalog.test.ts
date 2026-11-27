import { describe, expect, it } from "vitest";
import { ADMIN_OID, USER_OID, TENANT, buildApp, makeConfig, signedInAgent } from "./helpers.js";
import { useMongo } from "./mongo.js";
import { MongoToolRepository, type ToolRepository } from "../src/catalog/tool-repository.js";
import { seedTools } from "../src/catalog/seed.js";

const mongo = useMongo();

async function agents(tools: ToolRepository) {
  const admin = await signedInAgent(buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: ADMIN_OID }), { tools }));
  const user = await signedInAgent(buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: USER_OID }), { tools }));
  return { admin, user };
}

/** What create-tool.js `toolPayload()` sends. */
const createPayload = (over: Record<string, unknown> = {}) => ({
  toolName: "Expense Tracker",
  category: "Finance Tools",
  description: "Submit and approve expenses.",
  link: "https://expenses.example.test/",
  owner: "Finance",
  tab: "new-tab",
  iconImage: "",
  iconKey: "finance",
  color: "#55bf87",
  status: "Operational",
  ...over,
});

/** A full ToolDefinition, as the admin console sends it in entry.draft. */
const definition = (over: Record<string, unknown> = {}) => ({
  slug: "expense-tracker",
  name: "Expense Tracker",
  description: "Submit and approve expenses.",
  category: "Finance Tools",
  subtitle: "Expenses",
  iconKey: "finance",
  iconImage: "",
  color: "#55bf87",
  applicationUrl: "https://expenses.example.test/",
  openBehavior: "new-tab",
  documentationUrl: "",
  supportUrl: "",
  statusUrl: "",
  accessType: "Open",
  owner: "Finance",
  team: "Finance",
  supportContact: "",
  status: "Operational",
  statusNote: "",
  lifecycle: "Active",
  keywords: ["receipts"],
  aliases: [],
  tags: [],
  tasks: [],
  quickActions: [],
  featured: false,
  demoPreview: false,
  ...over,
});

const names = (list: Array<Record<string, unknown>>) => list.map((t) => t.toolName).sort();

describe("seeding", () => {
  it("inserts the example tools once, on first start only", async () => {
    const repo = new MongoToolRepository(mongo.freshDb());
    expect(await repo.seedIfEmpty(seedTools())).toBe(true);
    expect(await repo.list()).toHaveLength(4);
    expect(await repo.seedIfEmpty(seedTools())).toBe(false);
    // Even after every tool is deleted, it does not come back.
    for (const t of await repo.list()) await repo.delete(t.id);
    expect(await repo.seedIfEmpty(seedTools())).toBe(false);
    expect(await repo.list()).toHaveLength(0);
  });

  it("does not seed a collection that already has tools", async () => {
    const repo = new MongoToolRepository(mongo.freshDb());
    await repo.insert(seedTools()[0]!);
    expect(await repo.seedIfEmpty(seedTools())).toBe(false);
    expect(await repo.list()).toHaveLength(1);
  });

  it("employees see the 3 live examples; admins also see the Power BI draft", async () => {
    const repo = new MongoToolRepository(mongo.freshDb());
    await repo.seedIfEmpty(seedTools());
    const { admin, user } = await agents(repo);
    const a = await admin.get("/api/tools");
    const u = await user.get("/api/tools");
    expect(a.status).toBe(200);
    expect(a.headers["cache-control"]).toBe("no-store");
    expect(names(a.body)).toEqual(["Example Power BI report", "Microsoft 365", "Microsoft Learn", "Outlook on the web"]);
    expect(names(u.body)).toEqual(["Microsoft 365", "Microsoft Learn", "Outlook on the web"]);
  });
});

describe("GET /api/tools is readable by the frontend's get-tools.js", () => {
  it("parses into entries with the right published/enabled/archived state", async () => {
    const repo = new MongoToolRepository(mongo.freshDb());
    await repo.seedIfEmpty(seedTools());
    const { admin } = await agents(repo);
    const modPath = new URL("../../../site/assets/get-tools.js", import.meta.url).href;
    const { fetchToolCatalogSnapshot } = (await import(modPath)) as {
      fetchToolCatalogSnapshot: (s: object, r: number, f: typeof fetch) => Promise<{ entries: Array<Record<string, any>>; categories: string[] }>;
    };
    const res = await admin.get("/api/tools");
    const fakeFetch = (async () => new Response(JSON.stringify(res.body), { status: 200 })) as unknown as typeof fetch;
    const snapshot = await fetchToolCatalogSnapshot({ getToolsWebhookUrl: "/api/tools" }, 1, fakeFetch);
    expect(snapshot.entries).toHaveLength(4);
    const pbi = snapshot.entries.find((e) => e.draft.name === "Example Power BI report")!;
    expect(pbi.published).toBeNull();
    expect(pbi.draft.workspaceId).toBe("00000000-0000-0000-0000-000000000000");
    const m365 = snapshot.entries.find((e) => e.draft.name === "Microsoft 365")!;
    expect(m365.published).toMatchObject({ name: "Microsoft 365", applicationUrl: "https://www.microsoft365.com/" });
    expect(m365.enabled).toBe(true);
    expect(m365.archived).toBe(false);
    expect(snapshot.categories).toEqual(["JARC Technologies Tools", "Microsoft Hub", "Power BI"]);
  });
});

describe("create-tool", () => {
  it("admin creates a live tool (no publish flag, as before) and a draft (publish:false)", async () => {
    const repo = new MongoToolRepository(mongo.freshDb());
    const { admin, user } = await agents(repo);
    const live = await admin.post("/api/tools/create").send(createPayload());
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ success: true, id: expect.stringMatching(/^[0-9a-f]{24}$/) });
    const draft = await admin.post("/api/tools/create").send(createPayload({ toolName: "Draft Tool", publish: false }));
    expect(draft.status).toBe(200);
    expect(names((await user.get("/api/tools")).body)).toEqual(["Expense Tracker"]);
    expect(names((await admin.get("/api/tools")).body)).toEqual(["Draft Tool", "Expense Tracker"]);
    const stored = await repo.get(live.body.id);
    expect(stored).toMatchObject({ toolName: "Expense Tracker", link: "https://expenses.example.test/", tab: "new-tab", createdBy: ADMIN_OID });
  });

  it("non-admins get 403 for create and every admin action", async () => {
    const repo = new MongoToolRepository(mongo.freshDb());
    const { user } = await agents(repo);
    for (const action of ["create", "delete", "edit", "duplicate", "publish", "unpublish", "enable", "disable", "archive", "restore"]) {
      const res = await user.post(`/api/tools/${action}`).send({ id: "0".repeat(24) });
      expect(res.status, action).toBe(403);
      expect(res.body).toEqual({ success: false, error: "Administrator access required" });
    }
    expect(await repo.list()).toHaveLength(0);
  });

  it("validates like the frontend: category, URL, Power BI fields, publish requirements", async () => {
    const { admin } = await agents(new MongoToolRepository(mongo.freshDb()));
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ category: "Made Up" }, /predefined category/],
      [{ toolName: "" }, /tool name/],
      [{ link: "javascript:alert(1)" }, /https/],
      [{ link: "https://user:pw@example.test/" }, /https/],
      [{ iconKey: "rocket" }, /approved icon/],
      [{ color: "red" }, /color/],
      [{ category: "Power BI", workspaceId: "nope", allowedRoles: ["user"] }, /Workspace ID/],
      [{ category: "Power BI", workspaceId: "11111111-2222-3333-4444-555555555555", allowedRoles: [] }, /role/],
      [{ owner: "" }, /owner/],
    ];
    for (const [over, message] of cases) {
      const res = await admin.post("/api/tools/create").send(createPayload(over));
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(message);
    }
    // A draft may be incomplete.
    const draft = await admin.post("/api/tools/create").send(createPayload({ owner: "", description: "", link: "", publish: false }));
    expect(draft.status).toBe(200);
  });
});

describe("the 9 admin actions", () => {
  async function setup() {
    const repo = new MongoToolRepository(mongo.freshDb());
    const { admin, user } = await agents(repo);
    const { body } = await admin.post("/api/tools/create").send(createPayload());
    return { repo, admin, user, id: body.id as string };
  }
  const userNames = async (user: Awaited<ReturnType<typeof agents>>["user"]) => names((await user.get("/api/tools")).body);

  it("edit: save draft keeps the live version for employees; save & publish replaces it", async () => {
    const { repo, admin, user, id } = await setup();
    const draft = await admin
      .post("/api/tools/edit")
      .send({ action: "edit", id, requestId: "r1", publish: false, entry: { id, draft: definition({ name: "Expense Tracker v2" }), published: null } });
    expect(draft.status).toBe(200);
    expect(draft.body).toEqual({ success: true, id });
    // Employees still get the live version, and none of the draft data.
    const live = (await user.get("/api/tools")).body as Array<Record<string, any>>;
    expect(live).toHaveLength(1);
    expect(live[0]!.toolName).toBe("Expense Tracker");
    expect(JSON.stringify(live)).not.toContain("v2");
    const stored = (await repo.get(id))!;
    expect(stored.toolName).toBe("Expense Tracker v2");
    expect(stored.published).toMatchObject({ name: "Expense Tracker" });
    expect(stored.draft).toMatchObject({ subtitle: "Expenses", keywords: ["receipts"] });

    const pub = await admin.post("/api/tools/edit").send({ action: "edit", id, publish: true, entry: { id, draft: definition({ name: "Expense Tracker v2" }) } });
    expect(pub.status).toBe(200);
    expect(await userNames(user)).toEqual(["Expense Tracker v2"]);
    expect((await repo.get(id))!.published).toBe(true);
  });

  it("edit rejects a missing draft, a bad definition and unknown ids", async () => {
    const { admin, id } = await setup();
    expect((await admin.post("/api/tools/edit").send({ id, entry: {} })).status).toBe(400);
    expect((await admin.post("/api/tools/edit").send({ id, entry: { draft: definition({ category: "x" }) } })).status).toBe(400);
    expect((await admin.post("/api/tools/edit").send({ id, entry: { draft: definition({ $where: "1" }) } })).status).toBe(400);
    expect((await admin.post("/api/tools/edit").send({ id: "f".repeat(24), entry: { draft: definition() } })).status).toBe(404);
    expect((await admin.post("/api/tools/edit").send({ entry: { draft: definition() } })).status).toBe(400);
  });

  it("duplicate inserts a draft copy and returns the new id and sourceId", async () => {
    const { repo, admin, user, id } = await setup();
    const res = await admin.post("/api/tools/duplicate").send({ action: "duplicate", id, entry: { draft: definition({ name: "Expense Tracker copy" }) } });
    expect(res.status).toBe(200);
    expect(res.body.sourceId).toBe(id);
    expect(res.body.id).not.toBe(id);
    const copy = (await repo.get(res.body.id))!;
    expect(copy).toMatchObject({ toolName: "Expense Tracker copy", published: null, enabled: true, archived: false });
    expect(await userNames(user)).toEqual(["Expense Tracker"]);
    // Without an entry, the server copies the source itself.
    const plain = await admin.post("/api/tools/duplicate").send({ id });
    expect((await repo.get(plain.body.id))!.toolName).toBe("Expense Tracker (copy)");
  });

  it("publish / unpublish / disable / enable / archive / restore / delete", async () => {
    const { repo, admin, user, id } = await setup();
    const act = (a: string) => admin.post(`/api/tools/${a}`).send({ action: a, id });

    expect((await act("unpublish")).body).toEqual({ success: true, id });
    expect(await userNames(user)).toEqual([]);
    expect((await act("publish")).status).toBe(200);
    expect(await userNames(user)).toEqual(["Expense Tracker"]);

    await act("disable");
    expect((await repo.get(id))!.enabled).toBe(false);
    expect(await userNames(user)).toEqual([]);
    await act("enable");
    expect(await userNames(user)).toEqual(["Expense Tracker"]);

    await act("archive");
    expect(await repo.get(id)).toMatchObject({ archived: true, published: null });
    expect(await userNames(user)).toEqual([]);
    await act("restore");
    expect(await repo.get(id)).toMatchObject({ archived: false, published: null }); // back as a draft
    expect(await userNames(user)).toEqual([]);
    await act("publish");
    expect(await userNames(user)).toEqual(["Expense Tracker"]);

    expect((await act("delete")).body).toEqual({ success: true, id });
    expect(await repo.get(id)).toBeNull();
    expect((await act("delete")).status).toBe(404);
    expect((await act("publish")).status).toBe(404);
  });

  it("publish refuses an incomplete draft", async () => {
    const { admin } = await setup();
    const { body } = await admin.post("/api/tools/create").send(createPayload({ owner: "", publish: false }));
    const res = await admin.post("/api/tools/publish").send({ id: body.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/owner/);
  });

  it("missing id → 400, malformed or unknown id → 404", async () => {
    const { admin } = await setup();
    for (const action of ["delete", "publish", "archive"]) {
      expect((await admin.post(`/api/tools/${action}`).send({})).status).toBe(400);
      expect((await admin.post(`/api/tools/${action}`).send({ id: "not-an-id" })).status).toBe(404);
      expect((await admin.post(`/api/tools/${action}`).send({ id: "a".repeat(24) })).status).toBe(404);
    }
  });

  it("writes one audit line per admin action", async () => {
    const { createLogger } = await import("../src/logger.js");
    const lines: string[] = [];
    const logger = createLogger("info", (l) => lines.push(l));
    const repo = new MongoToolRepository(mongo.freshDb());
    const admin = await signedInAgent(buildApp(makeConfig({ DEV_AUTH_BYPASS_OID: ADMIN_OID }), { tools: repo, logger }));
    const { body } = await admin.post("/api/tools/create").send(createPayload());
    await admin.post("/api/tools/archive").send({ id: body.id });
    const audits = lines.map((l) => JSON.parse(l)).filter((e) => e.audit === true);
    expect(audits.map((a) => [a.action, a.result, a.status])).toEqual([
      ["tool.create", "ok", 200],
      ["tool.archive", "ok", 200],
    ]);
    expect(audits[1].actor).toEqual({ oid: ADMIN_OID });
  });
});

describe("launch (get-tool-creds)", () => {
  async function setup() {
    const repo = new MongoToolRepository(mongo.freshDb());
    const { admin, user } = await agents(repo);
    const web = (await admin.post("/api/tools/create").send(createPayload({ tab: "embedded" }))).body.id as string;
    const report = (
      await admin.post("/api/tools/create").send(
        createPayload({
          toolName: "Sales Report",
          category: "Power BI",
          link: "https://app.powerbi.com/groups/11111111-2222-3333-4444-555555555555/reports/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/ReportSection",
          workspaceId: "11111111-2222-3333-4444-555555555555",
          allowedRoles: ["user", "admin"],
        }),
      )
    ).body.id as string;
    const adminOnly = (
      await admin.post("/api/tools/create").send(
        createPayload({
          toolName: "Board Report",
          category: "Power BI",
          link: "https://app.powerbi.com/groups/11111111-2222-3333-4444-555555555555/reports/aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
          workspaceId: "11111111-2222-3333-4444-555555555555",
          allowedRoles: ["admin"],
        }),
      )
    ).body.id as string;
    const draft = (await admin.post("/api/tools/create").send(createPayload({ toolName: "Secret Draft", publish: false }))).body.id as string;
    return { admin, user, web, report, adminOnly, draft };
  }

  it("a web tool returns its URL and open behavior", async () => {
    const { user, web } = await setup();
    const res = await user.post("/api/tools/launch").send({ toolName: "Expense Tracker", toolId: web });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      authorized: true,
      category: "Finance Tools",
      toolName: "Expense Tracker",
      targetUrl: "https://expenses.example.test/",
      openBehavior: "embedded",
    });
    // By name only (the old call form).
    expect((await user.post("/api/tools/launch").send({ toolName: "expense tracker" })).body.targetUrl).toBe("https://expenses.example.test/");
  });

  it("Power BI opens the secure-embed URL with the viewer's own sign-in", async () => {
    const { user, report } = await setup();
    const res = await user.post("/api/tools/launch").send({ toolName: "Sales Report", toolId: report });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeUndefined();
    const url = new URL(res.body.targetUrl);
    expect(url.origin + url.pathname).toBe("https://app.powerbi.com/reportEmbed");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      reportId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      groupId: "11111111-2222-3333-4444-555555555555",
      autoAuth: "true",
      ctid: TENANT,
    });
  });

  it("role checks: an admin-only report is hidden from users and denied on launch", async () => {
    const { admin, user, adminOnly } = await setup();
    expect(names((await user.get("/api/tools")).body)).not.toContain("Board Report");
    expect((await user.post("/api/tools/launch").send({ toolId: adminOnly })).body).toEqual({ authorized: false, toolName: "Board Report" });
    expect((await admin.post("/api/tools/launch").send({ toolId: adminOnly })).body.authorized).toBe(true);
  });

  it("drafts open for admins only", async () => {
    const { admin, user, draft } = await setup();
    expect((await user.post("/api/tools/launch").send({ toolId: draft })).status).toBe(404);
    expect((await user.post("/api/tools/launch").send({ toolName: "Secret Draft" })).status).toBe(404);
    expect((await admin.post("/api/tools/launch").send({ toolId: draft })).body.authorized).toBe(true);
  });

  it("400 without toolId/toolName, 404 for unknown tools", async () => {
    const { user } = await setup();
    expect((await user.post("/api/tools/launch").send({})).status).toBe(400);
    expect((await user.post("/api/tools/launch").send({ toolName: "Nope" })).status).toBe(404);
  });
});
