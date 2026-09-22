import { postToolAction } from './tool-webhook-client.js';
// PASTE your production n8n disable webhook URL here.
// Contract and MongoDB instructions: ../WEBHOOKS.md
export const WEBHOOK_URL = "PASTE_YOUR_DISABLE_WEBHOOK_HERE";
export function submit(payload, fetchImpl = fetch) {
 return postToolAction(WEBHOOK_URL, 'disable', payload, fetchImpl);
}
