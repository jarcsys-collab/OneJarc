import { assertToolConfiguration, withoutInactivePowerBI } from "./tool-categories.js";
import { postToolAction } from './tool-webhook-client.js';
// Same-origin OneJarc server path; the server forwards to the n8n URL in
// N8N_URL_EDIT_TOOL and answers 501 until it is set (see PATCHES.md).
export const WEBHOOK_URL = "/api/n8n/edit-tool";
export function submit(payload, fetchImpl = fetch) {
 assertToolConfiguration(payload.entry.draft);
 payload = {...payload, entry:{...payload.entry, draft:withoutInactivePowerBI(payload.entry.draft), published:payload.entry.published ? withoutInactivePowerBI(payload.entry.published) : null}};
 return postToolAction(WEBHOOK_URL, 'edit', payload, fetchImpl);
}
