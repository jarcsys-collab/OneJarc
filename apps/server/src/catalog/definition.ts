/**
 * Tool catalog records, as stored in MongoDB and returned by GET /api/tools.
 *
 * The stored shape is the one the frontend reader expects (site/assets/get-tools.js
 * `toCatalogEntry`): flat fields (toolName, link, tab, ...) plus `draft`, `published`,
 * `enabled` and `archived`. `published` is:
 *   - true   -> the live version is the draft
 *   - object -> the live version is this definition (a draft with unpublished changes exists)
 *   - null   -> not live (draft only)
 *
 * The rules below repeat the frontend's own checks (tool-categories.js, and
 * validateDefinition / isSafeToolUrl in the bundle), because the server must not trust them.
 */

export const TOOL_CATEGORIES = [
  "Power BI",
  "Agents",
  "Microsoft Hub",
  "Sales and Marketing Tools",
  "Finance Tools",
  "JARCET Tools",
  "HR and Admin Tools",
  "JARC Technologies Tools",
  "Supply Chain Tools",
  "Legal Tools",
] as const;
export const ICON_KEYS = [
  "dashboard",
  "people",
  "support",
  "documents",
  "chat",
  "security",
  "finance",
  "creative",
  "analytics",
  "purchasing",
  "globe",
  "business",
] as const;
export const STATUSES = ["Operational", "Degraded", "Maintenance", "Outage", "Coming Soon"] as const;
export const OPEN_BEHAVIORS = ["new-tab", "same-tab", "embedded"] as const;
export const ROLES = ["user", "admin"] as const;
export const POWER_BI = "Power BI";

const DEFAULT_COLOR = "#29b7aa";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEFINITION_BYTES = 4 * 1024 * 1024;
const MAX_ICON_CHARS = 3 * 1024 * 1024;

/** The frontend's ToolDefinition: known fields are validated, the rest is kept as-is. */
export type Definition = Record<string, unknown>;

export interface ToolFields {
  toolName: string;
  category: string;
  description: string;
  link: string;
  owner: string;
  tab: string;
  iconImage: string;
  iconKey: string;
  color: string;
  status: string;
  workspaceId: string;
  allowedRoles: string[];
}

export interface ToolDoc extends ToolFields {
  id: string;
  draft: Definition;
  published: true | Definition | null;
  enabled: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export type NewToolDoc = Omit<ToolDoc, "id">;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Navigation-only URLs: https, or http on localhost outside production. No credentials. */
export function isSafeToolUrl(value: string, allowLocalHttp: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return allowLocalHttp && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Rejects keys MongoDB would treat as operators or paths, and non-JSON values. */
function assertStorable(value: unknown, depth = 0): void {
  if (depth > 20) throw new ValidationError("The tool definition is nested too deeply.");
  if (Array.isArray(value)) {
    for (const item of value) assertStorable(item, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("$") || key.includes(".") || key === "__proto__") {
        throw new ValidationError(`Unsupported field name "${key}".`);
      }
      assertStorable(item, depth + 1);
    }
    return;
  }
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  throw new ValidationError("The tool definition contains an unsupported value.");
}

export interface ValidateOptions {
  /** Publishing needs the complete employee-facing definition. */
  publish: boolean;
  allowLocalHttp: boolean;
}

/** Validates and normalizes a ToolDefinition. Throws ValidationError with a user-facing message. */
export function validateDefinition(input: unknown, opts: ValidateOptions): Definition {
  if (!isPlainObject(input)) throw new ValidationError("The tool definition is missing.");
  assertStorable(input);
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_DEFINITION_BYTES) {
    throw new ValidationError("The tool definition is too large.");
  }
  const errors: string[] = [];
  const def: Definition = { ...input };

  const name = str(def.name);
  if (!name) errors.push("Enter a tool name.");
  else if (name.length > 120) errors.push("The tool name must be 120 characters or fewer.");
  def.name = name;

  const category = str(def.category);
  if (!(TOOL_CATEGORIES as readonly string[]).includes(category)) errors.push("Select a predefined category before saving.");
  def.category = category;

  for (const [key, max] of [
    ["description", 2000],
    ["owner", 200],
  ] as const) {
    const v = def[key] === undefined ? "" : def[key];
    if (typeof v !== "string" || v.length > max) errors.push(`${key} must be text of at most ${max} characters.`);
    else def[key] = v.trim();
  }

  for (const key of ["applicationUrl", "documentationUrl", "supportUrl", "statusUrl"] as const) {
    const v = def[key] === undefined ? "" : def[key];
    if (typeof v !== "string" || v.length > 2048) {
      errors.push(`${key} must be a URL.`);
      continue;
    }
    const trimmed = v.trim();
    if (trimmed && !isSafeToolUrl(trimmed, opts.allowLocalHttp)) errors.push(`${key}: use an https:// URL without credentials.`);
    def[key] = trimmed;
  }

  const openBehavior = def.openBehavior === undefined ? "new-tab" : def.openBehavior;
  if (!(OPEN_BEHAVIORS as readonly unknown[]).includes(openBehavior)) errors.push("Choose how the tool opens.");
  def.openBehavior = openBehavior;

  const iconKey = def.iconKey === undefined ? "globe" : def.iconKey;
  if (!(ICON_KEYS as readonly unknown[]).includes(iconKey)) errors.push("Choose an approved icon.");
  def.iconKey = iconKey;

  const color = def.color === undefined ? DEFAULT_COLOR : def.color;
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) errors.push("Choose a valid color.");
  def.color = color;

  const iconImage = def.iconImage === undefined || def.iconImage === null ? "" : def.iconImage;
  if (
    typeof iconImage !== "string" ||
    iconImage.length > MAX_ICON_CHARS ||
    (iconImage !== "" && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(iconImage))
  ) {
    errors.push("The uploaded icon must be a PNG, JPG or WebP image under 2 MB.");
  }
  def.iconImage = iconImage;

  const status = def.status === undefined ? "Operational" : def.status;
  if (!(STATUSES as readonly unknown[]).includes(status)) errors.push("Choose a valid status.");
  def.status = status;

  if (category === POWER_BI) {
    const workspaceId = str(def.workspaceId);
    if (!GUID.test(workspaceId)) errors.push("Enter a valid Workspace ID (GUID).");
    const roles = Array.isArray(def.allowedRoles) ? [...new Set(def.allowedRoles)] : [];
    if (!roles.length || roles.some((r) => !(ROLES as readonly unknown[]).includes(r))) {
      errors.push("Select at least one supported role.");
    }
    def.workspaceId = workspaceId;
    def.allowedRoles = roles;
  } else {
    delete def.workspaceId;
    delete def.allowedRoles;
  }

  if (opts.publish) {
    if (!def.description) errors.push("Add a short description before publishing.");
    if (!def.owner) errors.push("Assign an owner before publishing.");
    if (def.demoPreview !== true && !def.applicationUrl) errors.push("Enter the application URL before publishing.");
  }

  if (errors.length) throw new ValidationError(errors.join(" "));
  return def;
}

/** The create-tool payload (create-tool.js `toolPayload`) as a ToolDefinition. */
export function definitionFromCreatePayload(body: Record<string, unknown>): Definition {
  const def: Definition = {
    name: body.toolName,
    category: body.category,
    description: body.description,
    applicationUrl: body.link,
    owner: body.owner,
    openBehavior: body.tab,
    iconImage: body.iconImage,
    iconKey: body.iconKey,
    color: body.color,
    status: body.status,
  };
  if (body.workspaceId !== undefined) def.workspaceId = body.workspaceId;
  if (body.allowedRoles !== undefined) def.allowedRoles = body.allowedRoles;
  return def;
}

/** The stored flat fields for a validated definition (the reverse of get-tools.js). */
export function fieldsFromDefinition(def: Definition): ToolFields {
  const powerBi = def.category === POWER_BI;
  return {
    toolName: str(def.name),
    category: str(def.category),
    description: str(def.description),
    link: str(def.applicationUrl),
    owner: str(def.owner),
    tab: str(def.openBehavior) || "new-tab",
    iconImage: str(def.iconImage),
    iconKey: str(def.iconKey) || "globe",
    color: str(def.color) || DEFAULT_COLOR,
    status: str(def.status) || "Operational",
    workspaceId: powerBi ? str(def.workspaceId) : "",
    allowedRoles: powerBi && Array.isArray(def.allowedRoles) ? def.allowedRoles.filter((r): r is string => typeof r === "string") : [],
  };
}

function flatAsDefinition(doc: ToolFields): Definition {
  const def: Definition = {
    name: doc.toolName,
    category: doc.category,
    description: doc.description,
    applicationUrl: doc.link,
    owner: doc.owner,
    openBehavior: doc.tab,
    iconImage: doc.iconImage,
    iconKey: doc.iconKey,
    color: doc.color,
    status: doc.status,
  };
  if (doc.category === POWER_BI) {
    def.workspaceId = doc.workspaceId;
    def.allowedRoles = doc.allowedRoles;
  }
  return def;
}

/** The current (draft) definition, the way get-tools.js builds it. */
export function draftDefinition(doc: ToolDoc): Definition {
  return { ...flatAsDefinition(doc), ...doc.draft };
}

/** The live definition, or null when the tool is not published. */
export function liveDefinition(doc: ToolDoc): Definition | null {
  if (doc.archived || doc.published === null) return null;
  if (doc.published === true) return draftDefinition(doc);
  return { ...flatAsDefinition(doc), ...doc.published };
}

/** Employees see only live, enabled, non-archived tools their role may open. */
export function visibleToEmployees(doc: ToolDoc, role: "user" | "admin"): boolean {
  const live = liveDefinition(doc);
  if (!live || !doc.enabled) return false;
  if (live.category !== POWER_BI) return true;
  const roles = Array.isArray(live.allowedRoles) ? live.allowedRoles : [];
  return roles.length === 0 || roles.includes(role);
}

/** The record an employee receives: only the live version, with no unpublished draft data. */
export function employeeRecord(doc: ToolDoc): Record<string, unknown> {
  const live = liveDefinition(doc)!;
  return {
    id: doc.id,
    ...fieldsFromDefinition(live),
    draft: live,
    published: true,
    enabled: true,
    archived: false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** The full record an admin receives (drafts, archived and disabled tools included). */
export function adminRecord(doc: ToolDoc): Record<string, unknown> {
  return { ...doc };
}

/** A small text summary of a tool for the chat assistant. */
export function chatSummary(def: Definition): string {
  const parts = [`- ${str(def.name)} (${str(def.category)})`];
  const description = str(def.description);
  if (description) parts.push(`: ${description.slice(0, 300)}`);
  const extra = ["keywords", "tags", "tasks"]
    .flatMap((k) => (Array.isArray(def[k]) ? (def[k] as unknown[]) : []))
    .filter((v): v is string => typeof v === "string")
    .slice(0, 12);
  if (extra.length) parts.push(` [${extra.join(", ")}]`);
  return parts.join("");
}
