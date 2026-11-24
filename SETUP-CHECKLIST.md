# OneJarc setup checklist (Entra sign-in + Railway)

This is a click-by-click guide for getting OneJarc running locally and on Railway, with Microsoft Entra ID sign-in.

> **This repository is PUBLIC.** Never write real values in this file, in an issue, or in a commit. That covers tenant IDs, client IDs, secrets, object IDs and email addresses. Real values belong in only two places: your local `.env` file (git-ignored) and Railway Variables. Values below appear as placeholders like `<tenant-id>`.

Portals change their menus often. If a button isn't where this guide says, use the portal's search box for the setting name given in quotes.

---

## 0. Before you start

- [ ] **A Microsoft Entra account that can register apps.**
  - You need at least the **Application Developer** role. Some tenants let ordinary users register apps.
  - For admin consent and "Assignment required", you need **Cloud Application Administrator** or **Application Administrator**. Being the app's owner covers most other settings.
- [ ] **A Railway account** (https://railway.com), signed in with GitHub.
- [ ] **Access to the Power BI workspaces** that hold the OneJarc reports. This is only needed for option 5b.
- [ ] **The n8n Production webhook URLs** for these 4 workflows: **chat**, **get-tools**, **create-tool**, **get-tool-creds**.
  - They are the same URLs that used to be in `site/onejarc-config.json`, which you can find in git history.
- [ ] **Node.js 24 or later and pnpm 10** installed locally, for step 3.

---

## 1. Entra app registration (one registration, test/staging)

Go to https://entra.microsoft.com and sign in. If you belong to several tenants, use the **Settings** (gear) icon in the top bar to switch to the right one.

### 1.1 Register the app

1. Go to **Entra ID** → **App registrations** → **New registration**.
2. **Name:** `OneJarc (test)`.
3. **Supported account types:** **Single tenant only - <your tenant>**. Older UI wording: "Accounts in this organizational directory only".
4. **Redirect URI:**
   - Platform: **Web**.
   - URI: `http://localhost:3000/auth/callback`.
5. Click **Register**.
6. On the **Overview** page, copy these two values into your local notes (not into the repo):
   - **Application (client) ID** → this becomes `ENTRA_CLIENT_ID`.
   - **Directory (tenant) ID** → this becomes `ENTRA_TENANT_ID`.

### 1.2 Redirect URIs (Authentication)

1. In the app, open **Authentication** under **Manage**.
   - Newer tenants may show **Authentication (Preview)**, with a **Redirect URI configuration** tab and a **Settings** tab. The fields are the same.
2. Under the **Web** platform, click **Add URI** and make sure the list contains all of these:

   | URI | When to add it |
   |---|---|
   | `http://localhost:3000/auth/callback` | Already added in 1.1 |
   | `http://localhost:3000/auth/signed-out` | Add now |
   | `https://<your-railway-domain>/auth/callback` | After step 4.6, once you have the domain |
   | `https://<your-railway-domain>/auth/signed-out` | After step 4.6, once you have the domain |

   - The `/auth/signed-out` addresses are where Microsoft sends you after logout. They **must also be registered as redirect URIs**, otherwise logout ends on a Microsoft error page.
   - `http://` is accepted only for `localhost`. Every other address must be `https://`.
3. **Front-channel logout URL:** leave it **empty**.
4. **Implicit grant and hybrid flows:** leave **Access tokens** and **ID tokens** both **unchecked**.
5. Click **Save**.

### 1.3 Client secret

1. Go to **Certificates & secrets** → **Client secrets** → **New client secret**.
2. **Description:** `onejarc-test`.
3. **Expires:**
   - Pick a period. Microsoft recommends less than 12 months, and the maximum is 24 months.
   - **Put a reminder in your calendar** a couple of weeks before the expiry date. When the secret expires, sign-in stops working.
4. Click **Add**.
5. **Copy the `Value` column right away.** It is shown only once; after you leave the page it is hidden for good.
   - Copy **Value**, not "Secret ID".
   - Paste it only into your local `.env` and into Railway as `ENTRA_CLIENT_SECRET`.
   - Never put it in chat, email or any file in the repo.
   - If you lose it, delete it and create a new one.

### 1.4 API permissions

1. Open **API permissions**. The default **Microsoft Graph → User.Read (Delegated)** is fine. The sign-in scopes `openid`, `profile` and `email` don't need to be added by hand.
2. **Grant admin consent for <tenant>** is needed only if your tenant requires it.
   - **Symptom that you need it:** after signing in, users see a consent prompt they can't accept, or a **"Need admin approval"** page.
   - **Fix:** an admin clicks **Grant admin consent for <tenant>** → **Yes**. The Status column should then show **Granted for <tenant>**.

### 1.5 Who can sign in (optional)

1. Go to **Entra ID** → **Enterprise apps** → **All applications**, open **OneJarc (test)**, then open **Properties**.
2. Set **Assignment required?**:
   - **No** (recommended for now): any user in your tenant can sign in, as a normal user.
   - **Yes**: only users you add under **Users and groups** can sign in. Users who aren't assigned get an Entra error.
3. Click **Save** if you changed anything.

Admin rights in OneJarc don't come from Entra. They come from `ADMIN_OBJECT_IDS` (step 2).

---

## 2. Find each admin's Object ID (oid)

1. Go to **Entra ID** → **Users**, select the user, and open **Overview**. Copy **Object ID**.
   - It's a GUID like `<00000000-0000-0000-0000-000000000000>`.
   - Don't confuse it with the app's client ID.
2. **To find your own Object ID**, use either of these:
   - https://myaccount.microsoft.com → **Overview** / **Account info**. Some tenants hide it there; in that case use the Users page above.
   - Once OneJarc is running (step 3), sign in and open `/api/me`. The `oid` field is your Object ID.
3. Put all the admin Object IDs in **`ADMIN_OBJECT_IDS`**, separated by commas, with no quotes. For example: `<oid-admin-1>,<oid-admin-2>`.
4. Everyone else who signs in is a normal user.

---

## 3. Run it locally

1. In the repo root, copy `.env.example` to `.env`:
   - Git Bash: `cp .env.example .env`
   - PowerShell: `Copy-Item .env.example .env`
   - `.env` is listed in `.gitignore`. **Never commit it, rename it, or paste it anywhere.** It holds your secrets.
2. Generate a session secret:
   ```
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
3. Open `.env` and fill in these values:
   ```
   APP_BASE_URL=http://localhost:3000
   ENTRA_TENANT_ID=<tenant-id>
   ENTRA_CLIENT_ID=<client-id>
   ENTRA_CLIENT_SECRET=<client-secret-value>
   SESSION_SECRET=<output of the command above>
   ADMIN_OBJECT_IDS=<your-own-oid>
   N8N_URL_CHAT=<n8n production URL for chat>
   N8N_URL_GET_TOOLS=<n8n production URL for get-tools>
   N8N_URL_CREATE_TOOL=<n8n production URL for create-tool>
   N8N_URL_GET_TOOL_CREDS=<n8n production URL for get-tool-creds>
   ```
   - Leave everything else at its default.
   - `PBI_EMBED_MODE` stays `n8n` unless you did step 5b.
   - Leave the other 9 `N8N_URL_*` empty. Those buttons will say "not connected to n8n yet".
4. Install, build and start:
   ```
   pnpm install
   pnpm build
   pnpm start
   ```
5. Open http://localhost:3000. You should be sent to the Microsoft sign-in page and then back to OneJarc.
6. Open http://localhost:3000/api/me.
   - You should see your `name`, `email`, `oid` and `"isAdmin": true`.
   - If `isAdmin` is `false`, the `oid` shown doesn't match `ADMIN_OBJECT_IDS`. Copy it from here, update `.env`, then restart.
7. If sign-in fails with "redirect URI mismatch" (`AADSTS50011`), check step 1.2. The URI must match exactly.

---

## 4. Railway (staging)

### 4.1 Project and environment

1. Go to https://railway.com/dashboard → **New** (or **New Project**) → **Empty Project**.
   - Choose Empty Project so nothing starts deploying before you've configured it.
2. Rename the project to `onejarc`. Use **Settings** → **General** → **Name**.
3. Create a `staging` environment:
   1. Open the **environment drop-down** in the top navigation (it shows `production`) → **+ New Environment**. You can also go to **Settings** → **Environments**.
   2. Choose **Empty Environment** and name it `staging`.
   3. Switch to `staging` in the drop-down. **Do all of the following steps while `staging` is selected.**
   - Why not just use `production`? Keeping `production` free means you can set it up later with its own Entra registration and the `main` branch, without renaming anything.

### 4.2 Service from GitHub

1. On the project canvas, click **+ Create** (labelled **New** in some versions; `Ctrl + K` → "new service" also works) → **GitHub Repo**.
2. If Railway asks you to install or authorize the **Railway GitHub App**:
   - On GitHub, choose **Only select repositories** → **OneJarc** → **Install & Authorize**.
   - Back in Railway, click **Refresh** if the repo isn't listed yet.
3. Pick **OneJarc**. A service tile appears. It may start a first deploy from `main`; you can ignore or cancel that.
4. Click the service → **Settings** → **Source**:
   - **Branch:** `railway-entra`. In some versions this is labelled "Branch connected to …" or "Trigger branch".
   - **Root Directory:** leave empty, which means the repo root.
   - **Wait for CI:** leave off for now.
5. You don't need to change the build. Railway's builder (Railpack) detects Node and pnpm and runs `pnpm build` and then `pnpm start`. There is no Dockerfile.

### 4.3 Deploy settings

1. Go to **Settings** → **Deploy**:
   - **Healthcheck Path:** `/health`.
   - **Healthcheck Timeout:** `60` seconds is plenty. The default is 300.
   - **Replicas:** `1`. Keep it at **exactly 1**, because sessions are stored in memory. Depending on the UI version, the setting is in **Deploy** or **Scale**.
2. If you don't see these fields, search the settings page for "Healthcheck" or "Replicas".

### 4.4 Public domain

1. Go to **Settings** → **Networking** → **Public Networking** → **Generate Domain**.
   - If Railway asks for a port, leave the suggested one. The server listens on Railway's `PORT`.
2. Copy the domain, for example `<something>.up.railway.app`. This is `<your-railway-domain>`.

### 4.5 Variables

1. Open the service's **Variables** tab → **Raw Editor**.
2. Paste the list below with your real values, then click **Update Variables** (or **Save**):
   ```
   NODE_ENV=production
   APP_BASE_URL=https://<your-railway-domain>
   ENTRA_TENANT_ID=<tenant-id>
   ENTRA_CLIENT_ID=<client-id>
   ENTRA_CLIENT_SECRET=<client-secret-value>
   SESSION_SECRET=<a NEW random value, generated with the command in step 3>
   ADMIN_OBJECT_IDS=<oid-admin-1>,<oid-admin-2>
   PBI_EMBED_MODE=n8n
   N8N_URL_CHAT=<n8n production URL for chat>
   N8N_URL_GET_TOOLS=<n8n production URL for get-tools>
   N8N_URL_CREATE_TOOL=<n8n production URL for create-tool>
   N8N_URL_GET_TOOL_CREDS=<n8n production URL for get-tool-creds>
   ```
   - `APP_BASE_URL` must be `https://` plus the generated domain, with **no trailing slash**.
   - Don't add `PORT`; Railway sets it.
   - Use a different `SESSION_SECRET` from your local one.
3. **Seal the secrets.** For each of `SESSION_SECRET`, `ENTRA_CLIENT_SECRET`, and `PBI_CLIENT_SECRET` (only if you set it, see step 5b):
   - Click the variable's **⋮** (3-dot) menu → **Seal**.
   - **What sealed means:**
     - The app still receives the value.
     - Nobody can view it again: not in the dashboard, the API, or `railway variables` / `railway run`.
     - It isn't copied when an environment or service is duplicated.
     - Sealing **can't be undone**.
     - To change a sealed value, use **⋮** → **Edit**. The Raw Editor can't update sealed variables.
4. **Apply the changes.** Variable and setting changes are *staged*. A banner appears on the canvas; click **Details** to review, then click **Deploy**.

### 4.6 Tell Entra about the Railway domain

- [ ] Go back to **step 1.2** and add `https://<your-railway-domain>/auth/callback` and `https://<your-railway-domain>/auth/signed-out`. Click **Save**.

### 4.7 Check the deploy

1. Open the service → **Deployments** tab, then the latest deployment → **View logs** (Build and Deploy logs).
   - The deployment becomes **Active** only after `/health` answers.
   - If the healthcheck fails, the old deployment (if any) keeps serving.
2. Open `https://<your-railway-domain>/health`. You should see `{"ok":true,"build":"..."}`.
3. Open `https://<your-railway-domain>/` and sign in.

### 4.8 Good to know

- **Each redeploy signs everyone out.** Sessions are kept in memory for now, so this is expected. Users just sign in again.
- **Railway does not read `.railway/railway.ts` automatically.** The dashboard settings above are all you need.
  - Optional, from your machine with the Railway CLI: `railway link` (pick the project, `staging` and the service), then `railway config plan` to preview the file's settings and `railway config apply` to apply them.
- Pushes to `railway-entra` redeploy `staging` automatically.

---

## 5. Power BI access — choose one (`PBI_EMBED_MODE`)

### 5a. `n8n` (default — nothing to change)

- [ ] Leave `PBI_EMBED_MODE=n8n`, or unset. The n8n **get-tool-creds** workflow keeps generating Power BI embed tokens exactly as it does today.

### 5b. `server` (the Railway server creates embed tokens with a service principal)

**Roles needed:**
- **Fabric Administrator** (Power BI admin) to change tenant settings.
- Entra **Groups Administrator**, or a user who is allowed to create groups, for the security group.
- **Admin** of each Power BI workspace, to add the app.

1. **Security group (Entra):**
   1. Go to **Entra ID** → **Groups** → **New group**.
   2. **Group type:** **Security**. Name: `sg-onejarc-powerbi`. Click **Create**.
   3. Open the group → **Members** → **Add members**, search for **OneJarc (test)** (the app), and add it.
2. **Tenant settings (Fabric/Power BI):**
   1. Go to https://app.powerbi.com.
   2. Open the tenant settings:
      - Newer UI: **⚙ Settings** → **Admin portal** → **Tenant settings**.
      - If you see the OneLake catalog: **Govern** → **Configurations** → **Tenant settings**.
   3. Scroll to **Developer settings** (or search "service principal") and turn on these two, each with **Apply to: Specific security groups** → `sg-onejarc-powerbi`:
      - **Embed content in apps**.
      - **Service principals can call Fabric public APIs**. The older name is "Allow service principals to use Power BI APIs".
   4. Click **Apply**. It can take up to about 15 minutes to take effect.
3. **Each workspace that holds OneJarc reports:**
   1. In the workspace list, open the workspace's **⋯ (More)** menu → **Workspace access** (or **Manage access** inside the workspace).
   2. Add **OneJarc (test)** or the group `sg-onejarc-powerbi`, with role **Member**. Click **Add**.
   3. "My workspace" doesn't work with service principals.
4. **Capacity:**
   - For production, the workspace must be on a **Fabric / Premium / Embedded capacity**. Check **Workspace settings** → **License info**.
   - On Pro-only workspaces, service-principal embed tokens are for development and testing only.
5. **Railway variables (staging):** set `PBI_EMBED_MODE=server`, then **Deploy**.
   - `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET` and `PBI_TENANT_ID` default to the `ENTRA_*` values, so you don't need to set them for now.
   - **Later improvement:** Microsoft recommends a **separate** app registration for the Power BI service principal, **with no API permissions**. When you create one, set `PBI_CLIENT_ID` and `PBI_CLIENT_SECRET` (sealed), and put that app in the security group instead.

---

## 6. n8n

- [ ] **This round, the only task is copying the 4 Production URLs** (chat, get-tools, create-tool, get-tool-creds) into `.env` and Railway.
  - In n8n: open the workflow, open its **Webhook** node, select the **Production URL** tab, and copy it. The workflow must be **active / published**.
- **Later:** the 9 tool actions need new n8n workflows: **delete, edit, duplicate, publish, unpublish, enable, disable, archive, restore**.
  - When each one exists, set its Railway variable and click **Deploy**.
  - The variables are `N8N_URL_DELETE_TOOL`, `N8N_URL_EDIT_TOOL`, `N8N_URL_DUPLICATE_TOOL`, `N8N_URL_PUBLISH_TOOL`, `N8N_URL_UNPUBLISH_TOOL`, `N8N_URL_ENABLE_TOOL`, `N8N_URL_DISABLE_TOOL`, `N8N_URL_ARCHIVE_TOOL` and `N8N_URL_RESTORE_TOOL`.
  - Until then, those buttons answer "This action is not connected to n8n yet."
- The old **onejarc-login** workflow is **no longer used**, because sign-in is now Entra. Leave it alone for now.

---

## 7. Final check (on the Railway domain)

- [ ] Sign in at `https://<your-railway-domain>/` works and returns you to OneJarc.
- [ ] `https://<your-railway-domain>/api/me` shows `"isAdmin": true` for an admin.
- [ ] `/api/me` shows `"isAdmin": false` for a normal user. Try a private window with a non-admin account.
- [ ] The tool catalog loads.
- [ ] Launching a tool works.
- [ ] A Power BI report opens.
- [ ] Chat answers.
- [ ] An admin can create a tool. A normal user can't.
- [ ] Logout ends on the "You are signed out" page, and **Sign in again** works.
