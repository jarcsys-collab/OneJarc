import { postToolAction } from './tool-webhook-client.js';
// Same-origin OneJarc server path; the server forwards to the n8n URL in
// N8N_URL_PUBLISH_TOOL and answers 501 until it is set (see PATCHES.md).
export const WEBHOOK_URL = "/api/n8n/publish-tool";
export function submit(payload, fetchImpl = fetch) {
 return postToolAction(WEBHOOK_URL, 'publish', payload, fetchImpl);
}
