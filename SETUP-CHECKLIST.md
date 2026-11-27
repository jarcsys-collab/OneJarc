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
- [ ] **Optional: an Anthropic API key** for the chat assistant (step 6). Without it the chat answers "coming soon".
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
   | `https://<your-railway-domain>/auth/callback` | After step 4.4, once you have the domain |
   | `https://<your-railway-domain>/auth/signed-out` | After step 4.4, once you have the domain |

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
   ```
   - Leave everything else at its default.
   - `MONGODB_URI` empty means the catalog and sessions live in memory and are lost when the server stops. The catalog starts with 4 example tools. To keep data, run a local MongoDB and set `MONGODB_URI=mongodb://127.0.0.1:27017`.
   - `ANTHROPIC_API_KEY` empty means the chat answers "coming soon".
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
   - **Replicas:** `1`. Sessions and the catalog are in MongoDB, so more would work, but the chat rate limit is per replica. Depending on the UI version, the setting is in **Deploy** or **Scale**.
2. If you don't see these fields, search the settings page for "Healthcheck" or "Replicas".

### 4.4 Public domain

1. Go to **Settings** → **Networking** → **Public Networking** → **Generate Domain**.
   - If Railway asks for a port, leave the suggested one. The server listens on Railway's `PORT`.
2. Copy the domain, for example `<something>.up.railway.app`. This is `<your-railway-domain>`.

### 4.5 MongoDB

1. On the project canvas (with `staging` selected): **+ Create** → **Database** → **MongoDB**. Railway names the service `MongoDB`.
2. Leave its public TCP proxy **off**. The app reaches it over Railway's private network (`mongodb.railway.internal`), which works only at runtime, not during the build.

### 4.6 Variables

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
   MONGODB_URI=${{MongoDB.MONGO_URL}}
   ANTHROPIC_API_KEY=<optional: your Anthropic API key>
   ```
   - `MONGODB_URI` is a **reference** to the MongoDB service, typed exactly as shown. Railway fills in the real connection string. The server refuses to start in production without it.
   - `APP_BASE_URL` must be `https://` plus the generated domain, with **no trailing slash**.
   - Don't add `PORT`; Railway sets it.
   - Use a different `SESSION_SECRET` from your local one.
3. **Seal the secrets.** For each of `SESSION_SECRET`, `ENTRA_CLIENT_SECRET` and `ANTHROPIC_API_KEY` (leave `MONGODB_URI` as a reference):
   - Click the variable's **⋮** (3-dot) menu → **Seal**.
   - **What sealed means:**
     - The app still receives the value.
     - Nobody can view it again: not in the dashboard, the API, or `railway variables` / `railway run`.
     - It isn't copied when an environment or service is duplicated.
     - Sealing **can't be undone**.
     - To change a sealed value, use **⋮** → **Edit**. The Raw Editor can't update sealed variables.
4. **Apply the changes.** Variable and setting changes are *staged*. A banner appears on the canvas; click **Details** to review, then click **Deploy**.

### 4.7 Tell Entra about the Railway domain

- [ ] Go back to **step 1.2** and add `https://<your-railway-domain>/auth/callback` and `https://<your-railway-domain>/auth/signed-out`. Click **Save**.

### 4.8 Check the deploy

1. Open the service → **Deployments** tab, then the latest deployment → **View logs** (Build and Deploy logs).
   - The deployment becomes **Active** only after `/health` answers.
   - If the healthcheck fails, the old deployment (if any) keeps serving.
2. Open `https://<your-railway-domain>/health`. You should see `{"ok":true,"build":"...","db":"ok"}`. If MongoDB is down it answers 503 with `"db":"down"`.
3. Open `https://<your-railway-domain>/` and sign in.

### 4.9 Good to know

- **Sessions survive redeploys.** They are stored in MongoDB (`sessions` collection, removed automatically when they expire).
- **First start seeds the catalog** with 3 example tools and 1 draft Power BI example, once, if the `tools` collection is empty. Edit or delete them in the admin console.
- **Railway does not read `.railway/railway.ts` automatically.** The dashboard settings above are all you need.
  - Optional, from your machine with the Railway CLI: `railway link` (pick the project, `staging` and the service), then `railway config plan` to preview the file's settings and `railway config apply` to apply them.
- Pushes to `railway-entra` redeploy `staging` automatically.

---

## 5. Power BI reports

Reports open with **each person's own Power BI sign-in** (the report's secure-embed URL in the OneJarc viewer). There is nothing to set up on the server. Each viewer needs access to the report in Power BI and a license that allows it.

To add a report as an admin:
1. In Power BI, open the report and copy its URL from the address bar: `https://app.powerbi.com/groups/<workspace-id>/reports/<report-id>/...`.
2. In the OneJarc admin console, create a tool with category **Power BI**. Paste the URL as the application URL, enter the workspace ID, and choose the roles that may open it.

---

## 6. Chat assistant (optional)

The chat recommends tools from the catalog, using Claude.
1. Create an API key at https://platform.claude.com → **Settings** → **API keys**.
2. In Railway, set `ANTHROPIC_API_KEY` (seal it), then **Deploy**. Without it, the chat answers "The OneJarc assistant is coming soon."
3. Optional: `CHAT_MODEL` (default `claude-opus-5-5`) and `CHAT_RATE_PER_MINUTE` (default 10 messages per user per minute).
- What is sent to Anthropic: the user's message and the names, categories and descriptions of the live tools. No names, emails or ids.

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
