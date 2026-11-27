import { assertToolConfiguration, withoutInactivePowerBI } from "./tool-categories.js";
import { postToolAction } from './tool-webhook-client.js';
// Same-origin OneJarc server path; the server writes the change to MongoDB (see PATCHES.md).
export const WEBHOOK_URL = "/api/tools/edit";
export function submit(payload, fetchImpl = fetch) {
 assertToolConfiguration(payload.entry.draft);
 payload = {...payload, entry:{...payload.entry, draft:withoutInactivePowerBI(payload.entry.draft), published:payload.entry.published ? withoutInactivePowerBI(payload.entry.published) : null}};
 return postToolAction(WEBHOOK_URL, 'edit', payload, fetchImpl);
}
