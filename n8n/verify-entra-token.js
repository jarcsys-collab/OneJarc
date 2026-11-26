// OneJarc — check the Microsoft (Entra ID) sign-in token sent by the browser.
//
// Where: an n8n Code node placed right after every OneJarc Webhook node.
// Mode:  "Run Once for All Items", language JavaScript.
// Output: the original webhook item, plus an `auth` object:
//   { ok: true,  oid, email, name, roles: ['user' | 'admin', ...] }
//   { ok: false, reason: '...' }
// Follow it with an IF node on {{ $json.auth.ok }}; the false branch goes to a
// "Respond to Webhook" node that returns HTTP 401. See n8n/README.md.
//
// Fill in the two IDs from the OneJarc app registration (Entra admin centre,
// App registrations > OneJarc > Overview). They are public IDs, not secrets.

const TENANT_ID = 'PASTE_DIRECTORY_TENANT_ID';
const ONEJARC_CLIENT_ID = 'PASTE_APPLICATION_CLIENT_ID';
const REQUIRED_SCOPE = 'access_as_user';

const CLOCK_SKEW_SECONDS = 120;
const KEYS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;
const KEYS_CACHE_HOURS = 12;

const crypto = require('crypto');

const fromBase64Url = (part) => Buffer.from(part, 'base64url');
const decodeJson = (part) => JSON.parse(fromBase64Url(part).toString('utf8'));

// Microsoft rotates its signing keys, so they are fetched from Microsoft and
// cached in the workflow's static data (kept between production executions).
const cache = $getWorkflowStaticData('global');

const loadKeys = async (force) => {
  const fresh = cache.entraKeys && Date.now() - cache.entraKeysAt < KEYS_CACHE_HOURS * 3600e3;
  if (fresh && !force) return cache.entraKeys;
  const response = await this.helpers.httpRequest({ method: 'GET', url: KEYS_URL, json: true });
  cache.entraKeys = response.keys || [];
  cache.entraKeysAt = Date.now();
  return cache.entraKeys;
};

const findKey = async (kid) => {
  let key = (await loadKeys(false)).find((k) => k.kid === kid);
  if (!key) key = (await loadKeys(true)).find((k) => k.kid === kid);
  return key;
};

const check = async (headers) => {
  const header = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header);
  if (!match) return { ok: false, reason: 'Missing or malformed Authorization header.' };
  const [, headPart, bodyPart, sigPart] = match;

  let head, claims;
  try {
    head = decodeJson(headPart);
    claims = decodeJson(bodyPart);
  } catch {
    return { ok: false, reason: 'Token is not readable.' };
  }
  if (head.alg !== 'RS256' || !head.kid) return { ok: false, reason: 'Unexpected token algorithm.' };

  const jwk = await findKey(head.kid);
  if (!jwk) return { ok: false, reason: 'Token was not signed by a JARC Microsoft key.' };
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signed = Buffer.from(`${headPart}.${bodyPart}`);
  if (!crypto.verify('sha256', signed, publicKey, fromBase64Url(sigPart))) {
    return { ok: false, reason: 'Token signature is invalid.' };
  }

  const now = Math.floor(Date.now() / 1000);
  const issuers = [
    `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
    `https://sts.windows.net/${TENANT_ID}/`
  ];
  const audiences = [ONEJARC_CLIENT_ID, `api://${ONEJARC_CLIENT_ID}`];
  const scopes = String(claims.scp || '').split(' ');

  if (claims.tid !== TENANT_ID || !issuers.includes(claims.iss)) return { ok: false, reason: 'Token is not from the JARC tenant.' };
  if (!audiences.includes(claims.aud)) return { ok: false, reason: 'Token is not meant for OneJarc.' };
  if (!scopes.includes(REQUIRED_SCOPE)) return { ok: false, reason: 'Token lacks the OneJarc scope.' };
  if (typeof claims.exp !== 'number' || claims.exp < now - CLOCK_SKEW_SECONDS) return { ok: false, reason: 'Token has expired.' };
  if (typeof claims.nbf === 'number' && claims.nbf > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'Token is not valid yet.' };

  return {
    ok: true,
    oid: claims.oid,
    email: String(claims.preferred_username || claims.upn || claims.email || '').toLowerCase(),
    name: claims.name || '',
    roles: Array.isArray(claims.roles) ? claims.roles : []
  };
};

const results = [];
for (const item of $input.all()) {
  let auth;
  try {
    auth = await check(item.json.headers || {});
  } catch (error) {
    auth = { ok: false, reason: `Token check failed: ${error.message}` };
  }
  results.push({ json: { ...item.json, auth } });
}
return results;
