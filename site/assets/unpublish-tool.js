import { postToolAction } from './tool-webhook-client.js';
// PASTE your production n8n unpublish webhook URL here.
// Contract and MongoDB instructions: ../WEBHOOKS.md
export const WEBHOOK_URL = "PASTE_YOUR_UNPUBLISH_WEBHOOK_HERE";
export function submit(payload, fetchImpl = fetch) {
 return postToolAction(WEBHOOK_URL, 'unpublish', payload, fetchImpl);
}
