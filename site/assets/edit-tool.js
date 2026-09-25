import { assertToolConfiguration, withoutInactivePowerBI } from "./tool-categories.js";
import { postToolAction } from './tool-webhook-client.js';
// PASTE your production n8n edit webhook URL here.
// Contract and MongoDB instructions: ../WEBHOOKS.md
export const WEBHOOK_URL = "PASTE_YOUR_EDIT_WEBHOOK_HERE";
export function submit(payload, fetchImpl = fetch) {
 assertToolConfiguration(payload.entry.draft);
 payload = {...payload, entry:{...payload.entry, draft:withoutInactivePowerBI(payload.entry.draft), published:payload.entry.published ? withoutInactivePowerBI(payload.entry.published) : null}};
 return postToolAction(WEBHOOK_URL, 'edit', payload, fetchImpl);
}
