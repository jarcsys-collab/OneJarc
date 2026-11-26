# OneJarc n8n workflows

These files are for the n8n workflows behind OneJarc. They are **not** part of the
website and are not published by the Pages workflow (only `site/` is).

## `verify-entra-token.js`: Microsoft sign-in check

Every OneJarc webhook must run this check first, so that only signed-in JARC
users get answers, and the user's email and role come from Microsoft rather
than from whatever the browser sends.

### 0. Test that your n8n allows it (once, about 10 seconds)

The check uses Node's built-in `crypto` module and an HTTP request from inside
a Code node. Make a throwaway workflow with a Manual Trigger and a Code node
containing:

```js
const crypto = require('crypto');
const keys = await this.helpers.httpRequest({
  method: 'GET',
  url: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  json: true
});
return [{ json: { crypto: typeof crypto.verify, keyCount: keys.keys.length } }];
```

Run it. Expected: `crypto: "function"` and a `keyCount` above 0.
If it errors with "Cannot find module 'crypto'" or "not allowed", stop and
report back: the check needs a different approach on your n8n plan.

### 1. Fill in the IDs

At the top of `verify-entra-token.js`, set `TENANT_ID` and `ONEJARC_CLIENT_ID`
from Entra admin centre > App registrations > OneJarc > Overview
("Directory (tenant) ID" and "Application (client) ID"). These are public IDs,
not secrets.

### 2. Wire it into each webhook workflow

Do this for `get-tools`, `get-tool-creds`, `create-tool`, and every new
management webhook:

```
Webhook ──► Code: Verify Microsoft token ──► IF {{ $json.auth.ok }} is true
                                               ├─ true  ──► (existing steps)
                                               └─ false ──► Respond to Webhook: 401
```

1. **Webhook node**
   - Respond: "Using 'Respond to Webhook' node".
   - Options > Allowed Origins (CORS): OneJarc's address, for example
     `https://jarcsys-collab.github.io`.
2. **Code node** ("Verify Microsoft token"): mode "Run Once for All Items",
   paste the whole file.
3. **IF node**: condition Boolean `{{ $json.auth.ok }}` is true.
4. **False branch → Respond to Webhook**: Respond With JSON, response code 401,
   body `{ "success": false, "error": "Please sign in again." }`.
5. **True branch → existing steps**, changed to use the verified identity:
   - email: `{{ $json.auth.email }}`
   - name: `{{ $json.auth.name }}`
   - roles: `{{ $json.auth.roles }}` (`user`, `admin`)
   - Ignore any `email` or `role` in `$json.body`.
   - Admin-only webhooks (create, edit, remove, …) add a second IF:
     `{{ $json.auth.roles.includes('admin') }}`, else respond 403.
6. Every path ends in a **Respond to Webhook** node (success responses too).

### 3. Test it

Until OneJarc sends the token, calls from the current site will get 401. So
switch the existing webhooks over only when the new OneJarc login is deployed.
To try it earlier, duplicate a workflow under a new webhook path (for example
`get-tools-sso`) and test there.

| Test | Expected |
|---|---|
| No `Authorization` header | 401, reason "Missing or malformed Authorization header." |
| Token from a JARC account signed in to OneJarc | Passes; `auth.email` is the JARC email |
| Expired token (older than about 1 hour) | 401, reason "Token has expired." |
| Non-admin calls an admin webhook | 403 |

The `reason` is in the Code node output (execution log), so you can see why
a call was refused without sending details to the browser.
