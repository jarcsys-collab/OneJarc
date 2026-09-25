// OneJarc MongoDB-backed catalog reader.
// The URL itself lives in ../onejarc-config.json as getToolsWebhookUrl.

const DEFAULT_COLOR = "#29b7aa";

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function slugify(value, fallback) {
  const slug = cleanString(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return slug || String(fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "tool";
}

function toCatalogEntry(record, index) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Invalid tool record at index ${index}.`);
  }

  const id = cleanString(record.id) || cleanString(record._id);
  const name = cleanString(record.draft?.name) || cleanString(record.toolName);
  if (!id) throw new Error(`Tool record ${index + 1} is missing id/_id.`);
  if (!name) throw new Error(`Tool record ${index + 1} is missing toolName.`);

  const category = cleanString(record.draft?.category || record.category, "Uncategorized") || "Uncategorized";
  const owner = cleanString(record.owner);
  const now = new Date().toISOString();
  const defaults = {
    slug: slugify(name, id),
    name,
    description: cleanString(record.description),
    category,
    subtitle: "",
    iconKey: cleanString(record.iconKey, "globe"),
    iconImage: cleanString(record.iconImage),
    color: cleanString(record.color, DEFAULT_COLOR),
    applicationUrl: cleanString(record.link),
    openBehavior: ["same-tab", "embedded"].includes(record.tab) ? record.tab : "new-tab",
    workspaceId: cleanString(record.workspaceId),
    allowedRoles: Array.isArray(record.allowedRoles) ? [...record.allowedRoles] : [],
    documentationUrl: "",
    supportUrl: "",
    statusUrl: "",
    accessType: "Open",
    owner,
    team: owner,
    supportContact: "",
    status: cleanString(record.status, "Operational"),
    statusNote: "",
    lifecycle: "Active",
    keywords: [],
    aliases: [],
    tags: [],
    tasks: [],
    quickActions: [],
    featured: false,
    demoPreview: false
  };

  const draft = { ...defaults, ...(record.draft || {}) };
  const archived = record.archived === true;
  const published = archived || record.published === null || record.published === false
    ? null : record.published && typeof record.published === 'object'
      ? { ...defaults, ...record.published } : { ...draft };
  return {
    id,
    draft,
    published,
    enabled: record.enabled !== false,
    archived,
    createdAt: cleanString(record.createdAt, now),
    updatedAt: cleanString(record.updatedAt, now),
    createdBy: "mongodb",
    updatedBy: "mongodb"
  };
}

export async function fetchToolCatalogSnapshot(settings, revision = 0, fetchImpl = fetch) {
  if (!settings?.getToolsWebhookUrl) {
    throw new Error("getToolsWebhookUrl is not configured in onejarc-config.json.");
  }

  let response;
  try {
    response = await fetchImpl(settings.getToolsWebhookUrl, {
      method: "GET",
      headers: { "Accept": "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(settings.timeoutMs || 60000)
    });
  } catch (error) {
    throw new Error(error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "Loading tools from MongoDB timed out."
      : "Could not load tools from MongoDB. Check the get-tools webhook and its CORS settings.");
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The get-tools webhook returned invalid JSON.");
  }

  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `get-tools failed with HTTP ${response.status}.`);
  }

  // Your current n8n workflow returns an array directly. This also accepts
  // { tools: [...] } so the frontend remains compatible if n8n is wrapped later.
  const records = Array.isArray(body) ? body : Array.isArray(body?.tools) ? body.tools : null;
  if (!records) throw new Error("The get-tools webhook must return an array of tools or an object with a tools array.");

  const entries = records.map(toCatalogEntry);
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`Duplicate tool id returned by get-tools: ${entry.id}`);
    seen.add(entry.id);
  }
  const categories = [...new Set(entries.map((entry) => entry.draft.category))].sort((a, b) => a.localeCompare(b));

  return {
    version: 1,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    categories,
    entries
  };
}
