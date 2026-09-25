import { postToolAction } from './tool-webhook-client.js';
// PASTE your production n8n restore webhook URL here.
// Contract and MongoDB instructions: ../WEBHOOKS.md
export const WEBHOOK_URL = "PASTE_YOUR_RESTORE_WEBHOOK_HERE";
export function submit(payload, fetchImpl = fetch) {
 return postToolAction(WEBHOOK_URL, 'restore', payload, fetchImpl);
}
