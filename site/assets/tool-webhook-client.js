// Shared transport. URLs are same-origin server paths (/api/tools/<action>) set in
// the individual action files; the server writes the change to MongoDB.
import { apiFetch } from './api-fetch.js';
export async function postToolAction(url, action, payload, fetchImpl = fetch) {
 const target = new URL(url || '/api/tools/' + action, window.location.origin);
 if(target.origin !== window.location.origin || target.username || target.password) throw new Error('Tool actions must use a same-origin OneJarc server path.');
 let response;
 try { response = await apiFetch(target.pathname, {method:'POST', body:payload, fetchImpl}); }
 catch { throw new Error('Could not confirm ' + action + '. Check your connection. Check the database before retrying; the action may have completed.'); }
 const result = response.data;
 if(response.ok && result === null) throw new Error('The '+action+' webhook returned invalid JSON. Check the database before retrying.');
 if(!response.ok || result?.success !== true) throw new Error(typeof result?.error === 'string' ? result.error : action+' was not confirmed (HTTP '+response.status+').');
 return result;
}
