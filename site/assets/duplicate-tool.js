import { postToolAction } from './tool-webhook-client.js';
// Same-origin OneJarc server path; the server writes the change to MongoDB (see PATCHES.md).
export const WEBHOOK_URL = "/api/tools/duplicate";
export function submit(payload, fetchImpl = fetch) {
 return postToolAction(WEBHOOK_URL, 'duplicate', payload, fetchImpl);
}
