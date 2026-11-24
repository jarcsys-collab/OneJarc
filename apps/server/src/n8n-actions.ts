/** The fixed allow-list of n8n actions the browser may call through /api/n8n/:action. */
export interface N8nAction {
  method: "GET" | "POST";
  envVar: string;
  admin: boolean;
}

export const N8N_ACTIONS = {
  chat: { method: "POST", envVar: "N8N_URL_CHAT", admin: false },
  "get-tools": { method: "GET", envVar: "N8N_URL_GET_TOOLS", admin: false },
  "get-tool-creds": { method: "POST", envVar: "N8N_URL_GET_TOOL_CREDS", admin: false },
  "create-tool": { method: "POST", envVar: "N8N_URL_CREATE_TOOL", admin: true },
  "delete-tool": { method: "POST", envVar: "N8N_URL_DELETE_TOOL", admin: true },
  "edit-tool": { method: "POST", envVar: "N8N_URL_EDIT_TOOL", admin: true },
  "duplicate-tool": { method: "POST", envVar: "N8N_URL_DUPLICATE_TOOL", admin: true },
  "publish-tool": { method: "POST", envVar: "N8N_URL_PUBLISH_TOOL", admin: true },
  "unpublish-tool": { method: "POST", envVar: "N8N_URL_UNPUBLISH_TOOL", admin: true },
  "enable-tool": { method: "POST", envVar: "N8N_URL_ENABLE_TOOL", admin: true },
  "disable-tool": { method: "POST", envVar: "N8N_URL_DISABLE_TOOL", admin: true },
  "archive-tool": { method: "POST", envVar: "N8N_URL_ARCHIVE_TOOL", admin: true },
  "restore-tool": { method: "POST", envVar: "N8N_URL_RESTORE_TOOL", admin: true },
} as const satisfies Record<string, N8nAction>;

export type N8nActionName = keyof typeof N8N_ACTIONS;

export function getN8nAction(name: string): N8nAction | undefined {
  return Object.hasOwn(N8N_ACTIONS, name) ? N8N_ACTIONS[name as N8nActionName] : undefined;
}
