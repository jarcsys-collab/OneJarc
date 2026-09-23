# OneJarc tool-action webhooks

This integration copy is based on OneJarc-main (2).zip. It includes the requested design changes (custom icons, category selector, removal of Popular suggestions and conditional maintenance indicators). Existing login, chat, create and catalog-read URLs are preserved. No new workflow URLs have been invented.

## Where to paste URLs

Each file below has WEBHOOK_URL near the top. Replace the placeholder with the corresponding production HTTPS n8n URL.

| Action | File | Database behavior |
|---|---|---|
| Edit / Save Draft / Publish in editor | assets/edit-tool.js | Save entry.draft; replace entry.published only when publish is true |
| Duplicate as draft | assets/duplicate-tool.js | Insert entry as a new record, using entry.id as its stable ID |
| Publish from menu | assets/publish-tool.js | Save entry.published |
| Unpublish | assets/unpublish-tool.js | Set published to null |
| Enable | assets/enable-tool.js | Set enabled to true |
| Disable | assets/disable-tool.js | Set enabled to false |
| Archive | assets/archive-tool.js | Set archived to true and published to null |
| Restore as draft | assets/restore-tool.js | Set archived to false, preserving unpublished draft |

Existing connections:
- Create and catalog read: onejarc-config.json.
- Delete: assets/delete-tool.js. The uploaded ZIP still contains a placeholder there.
- Login: N8N_LOGIN_URL in the main application bundle.
- Chat: onejarc-config.json.

## Request contract for the eight new adapters

POST with Content-Type: application/json:

```json
{
  "action": "disable",
  "id": "existing-tool-id",
  "requestId": "unique-request-key",
  "publish": false,
  "entry": {
    "id": "existing-tool-id",
    "draft": { "name": "Example", "category": "IT" },
    "published": null,
    "enabled": false,
    "archived": false
  }
}
```

The example abbreviates draft. Actual requests include the complete editor definition, including description, applicationUrl, owner, openBehavior, iconKey, color, status, discovery fields and other editor metadata. Entry also includes audit metadata. For duplicate, top-level id identifies the original and entry.id identifies the new draft. Editor Publish uses edit-tool.js with publish=true; it is one atomic save-and-publish operation.

n8n must perform the indicated database operation and then return HTTP 2xx with {"success":true}. Return an error status and {"success":false,"error":"Helpful explanation"} on failure. URL configuration alone cannot create these workflows. Do not return success before the database operation finishes.

Use requestId to deduplicate repeated requests on the server, especially duplicate. Enforce administrator authorization and validate input in your workflow; browser role checks and audit fields are not trusted authorization. Permit your site's origin and Content-Type in CORS.

## Required catalog read response

get-tools must return all administrator records, including unpublished, disabled and archived ones, as an array or {"tools":[...]}. For records managed by the new workflows, return the complete saved entry structure above. An id or string _id is required. Keep entry.id stable; if MongoDB uses a separate _id, return the application id too and resolve updates/deletes consistently.

The reader also accepts legacy records with toolName, category, description, link, owner and tab. Legacy records without explicit states default to published/enabled for compatibility. Your workflow must return saved draft, published, enabled and archived values so changes survive refresh. A published snapshot must remain separate from the draft so saving a draft does not change employee views.

Creation preserves the original six fields and adds optional iconImage, iconKey, color and status. Your create workflow must store and return these optional fields for new-tool appearance/status to survive refresh. Initialize the complete entry schema in n8n if you want new records to support draft/publication states from creation onward. Custom icon images are normalized to 128×128 PNG data URLs. Persist iconImage in draft and published definitions for editing, or at the top level for legacy records.

## Behavior and scope

Missing URLs show an actionable error; the tool action is not silently saved locally. Permission, field and revision validation runs before sending tool mutations, including delete. After a confirmed mutation the app reloads the catalog. If refresh fails, use Reload catalog rather than repeating a possibly completed action. Network timeouts are ambiguous and should be checked in n8n/MongoDB before retrying.

These adapters cover the tool menu and editor actions. Category administration, favorites, preferences, notifications and support requests retain their previous behavior. No live database mutations were performed during testing.
