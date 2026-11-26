#!/usr/bin/env bash
# Register OneJarc in the JARC Microsoft tenant (Entra ID) — Phase 1 of the SSO plan.
#
# Run as a JARC admin, easiest in Azure Cloud Shell (https://shell.azure.com, Bash):
# it already has the Azure CLI and is signed in. Elsewhere: install the Azure CLI,
# then `az login --allow-no-subscriptions` first.
#
#   bash register-onejarc-entra.sh
#
# Optional: set ONEJARC_URL to OneJarc's address if it is not the GitHub Pages one:
#   ONEJARC_URL=https://onejarc.example.com/ bash register-onejarc-entra.sh
#
# What it creates:
#   - App registration "OneJarc": JARC accounts only, single-page app sign-in
#   - API scope access_as_user (what n8n checks), access token version 2
#   - App roles: user, admin
#   - Admin consent for the scope and basic sign-in (User.Read)
#   - "Assignment required" on, and you assigned as OneJarc Admin
# It stops without changing anything if an app named OneJarc already exists.

set -euo pipefail

APP_NAME="OneJarc"
ONEJARC_URL="${ONEJARC_URL:-https://jarcsys-collab.github.io/OneJarc/}"
LOCAL_DEV_URL="http://localhost:5173/"
GRAPH="https://graph.microsoft.com/v1.0"
MS_GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

new_id() { (uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid) | tr 'A-Z' 'a-z'; }

# Microsoft can take a few seconds to make a new app visible everywhere, so retry.
graph() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if az rest --only-show-errors "$@" 2>"$WORK/err"; then return 0; fi
    echo "  (waiting for Microsoft, attempt $attempt)" >&2
    sleep $((attempt * 5))
  done
  cat "$WORK/err" >&2
  return 1
}

echo "Checking sign-in..."
TENANT_ID="$(az account show --query tenantId -o tsv)"
ME_ID="$(az ad signed-in-user show --query id -o tsv)"
ME_NAME="$(az ad signed-in-user show --query userPrincipalName -o tsv)"
echo "  Tenant: $TENANT_ID"
echo "  You:    $ME_NAME"

if [ -n "$(az ad app list --display-name "$APP_NAME" --query '[].appId' -o tsv)" ]; then
  echo "An app named $APP_NAME already exists in this tenant. Nothing was changed." >&2
  echo "Check it in Entra admin centre > App registrations, or delete it first." >&2
  exit 1
fi

SCOPE_ID="$(new_id)"
USER_ROLE_ID="$(new_id)"
ADMIN_ROLE_ID="$(new_id)"

cat > "$WORK/app.json" <<JSON
{
  "displayName": "$APP_NAME",
  "signInAudience": "AzureADMyOrg",
  "spa": { "redirectUris": ["$ONEJARC_URL", "$LOCAL_DEV_URL"] },
  "api": {
    "requestedAccessTokenVersion": 2,
    "oauth2PermissionScopes": [{
      "id": "$SCOPE_ID",
      "value": "access_as_user",
      "type": "User",
      "isEnabled": true,
      "adminConsentDisplayName": "Access OneJarc as the signed-in user",
      "adminConsentDescription": "Lets OneJarc call its services as the signed-in JARC user.",
      "userConsentDisplayName": "Access OneJarc as you",
      "userConsentDescription": "Lets OneJarc call its services as you."
    }]
  },
  "appRoles": [
    {
      "id": "$USER_ROLE_ID",
      "allowedMemberTypes": ["User"],
      "value": "user",
      "displayName": "OneJarc User",
      "description": "Can sign in to OneJarc and open the apps allowed for them.",
      "isEnabled": true
    },
    {
      "id": "$ADMIN_ROLE_ID",
      "allowedMemberTypes": ["User"],
      "value": "admin",
      "displayName": "OneJarc Admin",
      "description": "Can add, edit, switch off and remove apps in OneJarc.",
      "isEnabled": true
    }
  ]
}
JSON

echo "1/6 Creating the $APP_NAME app registration..."
# Not retried: a repeat could create a second app.
read -r CLIENT_ID APP_OBJECT_ID < <(az rest --only-show-errors --method POST --uri "$GRAPH/applications" \
  --body "@$WORK/app.json" --query '[appId, id]' -o tsv)
if [ -z "${CLIENT_ID:-}" ] || [ -z "${APP_OBJECT_ID:-}" ]; then
  echo "Creating the app registration failed. Nothing else was changed." >&2
  exit 1
fi
echo "  Client ID: $CLIENT_ID"

cat > "$WORK/app-patch.json" <<JSON
{
  "identifierUris": ["api://$CLIENT_ID"],
  "requiredResourceAccess": [
    { "resourceAppId": "$CLIENT_ID", "resourceAccess": [{ "id": "$SCOPE_ID", "type": "Scope" }] },
    { "resourceAppId": "$MS_GRAPH_APP_ID", "resourceAccess": [{ "id": "e1fe6dd8-ba31-4d61-89e7-88639da4683d", "type": "Scope" }] }
  ]
}
JSON

echo "2/6 Setting the API address and permissions..."
graph --method PATCH --uri "$GRAPH/applications/$APP_OBJECT_ID" --body "@$WORK/app-patch.json" > /dev/null

echo "3/6 Creating the enterprise application..."
cat > "$WORK/sp.json" <<JSON
{ "appId": "$CLIENT_ID", "appRoleAssignmentRequired": true }
JSON
SP_ID="$(graph --method POST --uri "$GRAPH/servicePrincipals" --body "@$WORK/sp.json" --query id -o tsv)"
GRAPH_SP_ID="$(graph --method GET --uri "$GRAPH/servicePrincipals(appId='$MS_GRAPH_APP_ID')" --query id -o tsv)"

echo "4/6 Granting admin consent..."
cat > "$WORK/grant-api.json" <<JSON
{ "clientId": "$SP_ID", "consentType": "AllPrincipals", "resourceId": "$SP_ID", "scope": "access_as_user" }
JSON
cat > "$WORK/grant-graph.json" <<JSON
{ "clientId": "$SP_ID", "consentType": "AllPrincipals", "resourceId": "$GRAPH_SP_ID", "scope": "openid profile offline_access User.Read" }
JSON
graph --method POST --uri "$GRAPH/oauth2PermissionGrants" --body "@$WORK/grant-api.json" > /dev/null
graph --method POST --uri "$GRAPH/oauth2PermissionGrants" --body "@$WORK/grant-graph.json" > /dev/null

echo "5/6 Making you a OneJarc Admin..."
cat > "$WORK/assign.json" <<JSON
{ "principalId": "$ME_ID", "resourceId": "$SP_ID", "appRoleId": "$ADMIN_ROLE_ID" }
JSON
graph --method POST --uri "$GRAPH/servicePrincipals/$SP_ID/appRoleAssignedTo" --body "@$WORK/assign.json" > /dev/null

echo "6/6 Done."
cat <<SUMMARY

OneJarc is registered. Send these two IDs (public, not secrets):

  Application (client) ID: $CLIENT_ID
  Directory (tenant) ID:   $TENANT_ID

Sign-in addresses registered: $ONEJARC_URL and $LOCAL_DEV_URL
API scope: api://$CLIENT_ID/access_as_user

To let other people in: Entra admin centre > Enterprise applications > OneJarc >
Users and groups > Add user/group, and pick the OneJarc User or OneJarc Admin role.
SUMMARY
