/**
 * OneJarc form variable map.
 * Edit this file when you need to change/add the field keys used by the UI/backend.
 * Runtime user values still live in the form's `definition` object.
 */
export const TOOL_INPUTS = Object.freeze({
  TOOL_NAME: 'name',
  CATEGORY: 'category',
  DESCRIPTION: 'description',
  OWNER: 'owner',
  OPEN_BEHAVIOR: 'openBehavior',
  APPLICATION_URL: 'applicationUrl',
  WORKSPACE_ID: 'workspaceId',
  ALLOWED_ROLES: 'allowedRoles'
});

export const BACKEND_FIELDS = Object.freeze({
  TOOL_NAME: 'toolName',
  CATEGORY: 'category',
  DESCRIPTION: 'description',
  OWNER: 'owner',
  TAB: 'tab',
  LINK: 'link',
  WORKSPACE_ID: 'workspaceId',
  ALLOWED_ROLES: 'allowedRoles'
});

export const POWER_BI_INPUTS = Object.freeze({
  WORKSPACE_ID: TOOL_INPUTS.WORKSPACE_ID,
  ALLOWED_ROLES: TOOL_INPUTS.ALLOWED_ROLES
});

export function getToolInput(definition, field) {
  return definition?.[field];
}

export function setToolInput(definition, field, value) {
  return { ...definition, [field]: value };
}
