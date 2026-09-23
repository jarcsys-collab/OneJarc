import { postToolAction } from './tool-webhook-client.js';
// PASTE your production n8n publish webhook URL here.
// Contract and MongoDB instructions: ../WEBHOOKS.md
export const WEBHOOK_URL = "PASTE_YOUR_PUBLISH_WEBHOOK_HERE";
export function submit(payload, fetchImpl = fetch) {
 return postToolAction(WEBHOOK_URL, 'publish', payload, fetchImpl);
}
