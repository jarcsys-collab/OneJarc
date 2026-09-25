// Shared transport. Configure URLs in the individual action files.
export async function postToolAction(url, action, payload, fetchImpl = fetch) {
 if (!url || url.startsWith('PASTE_')) throw new Error(action + ' webhook is not configured. Open assets/' + action + '-tool.js and paste the URL.');
 const target = new URL(url);
 if(target.protocol !== 'https:' || target.username || target.password) throw new Error('Use an HTTPS webhook URL without embedded credentials.');
 let response;
 try { response = await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(60000),body:JSON.stringify(payload)}); }
 catch { throw new Error('Could not confirm ' + action + '. Check your connection and CORS settings. Check the database before retrying; the action may have completed.'); }
 let result;try{result=await response.json()}catch{throw new Error('The '+action+' webhook returned invalid JSON. Check the database before retrying.');}
 if(!response.ok || result?.success !== true) throw new Error(typeof result?.error === 'string' ? result.error : action+' was not confirmed (HTTP '+response.status+').');
 return result;
}
