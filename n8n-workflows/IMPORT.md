# n8n workflows for the admin tool actions

These nine workflows handle the admin console's tool actions. The OneJarc server forwards each action as `POST` with the browser's JSON body unchanged. Each workflow then reads or writes the same MongoDB collection that `get-tools` reads and `create-tool` writes.

Request path: browser → `POST /api/n8n/<action>` (OneJarc server, admins only) → n8n webhook `<action>` → MongoDB.

| File | Webhook path | What it does in MongoDB | Railway variable |
|---|---|---|---|
| `delete-tool.json` | `delete-tool` | Deletes the document | `N8N_URL_DELETE_TOOL` |
| `edit-tool.json` | `edit-tool` | Writes the edited definition (`entry.draft`) to the stored fields and `draft`. Sets `published` (see below) and `updatedAt` | `N8N_URL_EDIT_TOOL` |
| `duplicate-tool.json` | `duplicate-tool` | Inserts a new document from `entry.draft` with `published:null`, `enabled:true` and `archived:false`. Returns the new `id` | `N8N_URL_DUPLICATE_TOOL` |
| `publish-tool.json` | `publish-tool` | `published:true`, `archived:false`, `updatedAt` | `N8N_URL_PUBLISH_TOOL` |
| `unpublish-tool.json` | `unpublish-tool` | `published:null`, `updatedAt` | `N8N_URL_UNPUBLISH_TOOL` |
| `enable-tool.json` | `enable-tool` | `enabled:true`, `updatedAt` | `N8N_URL_ENABLE_TOOL` |
| `disable-tool.json` | `disable-tool` | `enabled:false`, `updatedAt` | `N8N_URL_DISABLE_TOOL` |
| `archive-tool.json` | `archive-tool` | `archived:true`, `published:null`, `updatedAt` | `N8N_URL_ARCHIVE_TOOL` |
| `restore-tool.json` | `restore-tool` | `archived:false`, `published:null` (it comes back as a draft), `updatedAt` | `N8N_URL_RESTORE_TOOL` |

Every workflow answers with JSON:

- **200** `{"success":true,"id":"<tool id>"}`. For duplicate, `id` is the **new** document's id and `sourceId` is the original.
- **400** `{"success":false,"error":"..."}`: the id is missing or empty, or for edit/duplicate `entry.draft` is not an object or has no name.
- **403**: the `X-OneJarc-User-Is-Admin: true` header is missing. The OneJarc server always sends it, so this only blocks direct calls that don't.
- **404**: no document has that id.
- **500**: a MongoDB error such as a connection failure, a credential problem or a failed write. The details are in the n8n execution log.

The admin console shows the `error` text. After a success it reloads the catalog through `get-tools`.

## Import and connect (repeat for each of the 9 files)

1. In n8n, go to **Workflows → Create workflow**. In the ⋮ menu at the top right, choose **Import from File…** and pick the `.json` file. Or drag the file onto an empty canvas.
2. **Attach the credential.** Open every **MongoDB** node (green leaf icon) and set **Credential to connect with** to the MongoDB credential your `get-tools` / `create-tool` workflows already use. The files carry a placeholder (`REPLACE_ME` / "MongoDB account"), so n8n flags these nodes until you choose one.
   - `delete-tool`: **Delete tool**
   - `duplicate-tool`: **Insert tool**
   - all the others: **Find tool** and **Update tool**
3. **Check the collection name.** It is set to `tools`, and it appears only in the **Collection** field of the MongoDB nodes listed in step 2. If your `get-tools` workflow reads another collection, type that name into those same nodes. No Code node mentions the collection.
4. **Save**, then turn the workflow **Active** (on newer n8n versions this is **Publish**).
5. Open the **Webhook** node, switch to **Production URL** and copy it. It ends in `/webhook/<action>`, for example `/webhook/publish-tool`. Do not use the Test URL.
6. In Railway, open the OneJarc service → **Variables**. Paste the URL into the variable from the table above, for example `N8N_URL_PUBLISH_TOOL`.

After all nine variables are set, **redeploy** the service (Railway usually asks you to deploy the variable changes). Until a variable is set, the server answers that action with 501 "This action is not connected to n8n yet."

**Testing without curl:** sign in to OneJarc as an admin and open the admin console. Try each action on a throwaway tool, for example duplicate a tool and then publish, unpublish, disable, enable, archive, restore, edit and delete the copy. If one fails, the message in the console comes from the workflow. The workflow's **Executions** tab in n8n shows which node failed and why.

## How it is built

Each workflow uses the same nodes: **Webhook** (POST, path = action name, Respond: "Using 'Respond to Webhook' node", no authentication) → **Validate input** (Code) → **Input valid?** (If) → MongoDB node(s) → result Code node → one **Respond** node. All error paths end at that **Respond** node. It reads the status code and the JSON body from the item it receives, so n8n always answers with JSON.

Every MongoDB node has **Settings → On Error = Continue (using error output)**. Its error output goes to **Database error**, which answers 500. The result Code nodes also catch the `{error: ...}` items that older MongoDB node versions emit instead of using the error output.

The update actions look the tool up first (**Find tool**), so a missing id gets a 404 rather than a false "success". The MongoDB node's Update operation does not report how many documents it matched.

### How `_id` is handled

I checked the MongoDB node's source (`packages/nodes-base/nodes/MongoDb/` in n8n-io/n8n):

- **Find / Aggregate** convert a top-level string `_id` in the query to an ObjectId.
- **Delete** does not convert anything. The query is parsed as plain JSON (not Extended JSON), so `{"_id":"64b..."}` would match nothing for an ObjectId `_id`, and `{"_id":{"$oid":"..."}}` fails as an unknown operator.
- **Update** with **Update Key** = `_id` converts the item's `_id` string to an ObjectId. The string must be a valid 24-character ObjectId, or the node errors.

So the workflows do the following:

- **Find tool** (Aggregate) and **Delete tool** match with `{"$or":[{"$expr":{"$eq":[{"$toString":"$_id"},{"$literal":"<id>"}]}},{"id":"<id>"}]}`. This matches an ObjectId `_id`, a string `_id`, or a separate string `id` field, which are the forms `get-tools.js` accepts. `$literal` keeps an id that starts with `$` from being read as a field path. The **Validate input** Code node builds the query with `JSON.stringify`, so the id can't inject structure. The Aggregate wraps the match in `$facet`, so it always returns one document and the workflow can answer 404 when the tool doesn't exist. This needs MongoDB 4.0 or newer (`$toString`). Because `$expr` can't use an index, each lookup scans the collection, which is fine at catalog size.
- **Update tool** uses **Update Key** `_id` with the `_id` string that **Find tool** returned. The node turns it back into an ObjectId.
  - Limitation: if a document's `_id` is a plain string that is not an ObjectId, updates answer 500 and nothing is changed. Delete still works. Documents created by MongoDB or by the n8n Insert operation always have ObjectId ids.

### How fields are stored (edit and duplicate)

The **Prepare update** / **Prepare insert** Code nodes reverse `toCatalogEntry()` in `site/assets/get-tools.js`. The top-level fields are the same ones `create-tool` writes (`toolPayload()` in `create-tool.js`):

| ToolDefinition (`entry.draft`) | Stored field |
|---|---|
| `name` (trimmed) | `toolName` |
| `category` | `category` |
| `description` | `description` |
| `applicationUrl` | `link` |
| `owner` | `owner` |
| `openBehavior` (`new-tab` / `same-tab` / `embedded`) | `tab` |
| `iconImage`, `iconKey`, `color`, `status` | same names |
| `workspaceId`, `allowedRoles` (Power BI only) | same names. Set to `""` / `[]` for other categories, so changing the category leaves no old values behind |
| the whole definition | `draft`. `get-tools.js` merges `record.draft` over the top-level fields, so fields like subtitle, slug and keywords survive a reload |

Timestamps are stored as ISO strings, because `get-tools.js` reads `createdAt`/`updatedAt` as strings. Do not use the node's "Date Fields" option.

How `edit-tool` sets `published`, using the same reading as `get-tools.js`:

- **Save & publish** (`publish: true`): `published: true`, so the live version is the draft.
- **Save draft** on a tool that is live: `published` is set to the live definition the console sends (`entry.published`, an object). The live version stays unchanged until the tool is published again.
- **Save draft** on a tool that is not live: `published: null`.

## Check against your real get-tools / create-tool export

- **Collection name**: it is `tools` here. Change it in the MongoDB nodes listed in step 2 if your collection is called something else.
- **Field names**: `get-tools` must return documents with the fields listed above (`toolName`, `link`, `tab`, …). It must also return `draft`, `published`, `enabled` and `archived` as stored. If your get-tools workflow projects or renames fields, edit and duplicate changes may not show up after a reload.
- **Id form**: the id the console sends is whatever `get-tools` returned as `id` or `_id`. If get-tools rewrites `_id` into something else, the lookup won't find it.
- **Published semantics**: these workflows write `true`, `null` or an object to `published`. Check that nothing else (create-tool, other workflows or reports) expects only `true`/`false`.
- **Archive lifecycle**: archive/restore change only `archived`/`published`. The definition's `lifecycle` label ("Archived"/"Active") is not stored.

## Versions and security notes

- Node versions: Webhook 2, Code 2, If 2, MongoDB 1.2, Respond to Webhook 1.1. Current n8n still runs all of them, and older instances can import them (the newest MongoDB 1.4/1.5 and Respond 1.4/1.5 only exist on recent releases). You can swap a node for a newer version later. Behaviour is the same for these single-item requests.
- The webhooks have no authentication yet, and the admin header check can be faked by anyone who knows the URL. Before going wider, add **Header Auth** to each Webhook node and have the OneJarc server send the secret.
