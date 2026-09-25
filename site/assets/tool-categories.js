export const TOOL_CATEGORIES = [
  {
    value: "Power BI",
    label: "Power BI",
    description: "For ALL Power BI Reports"
  },
  {
    value: "Agents",
    label: "Agents",
    description: "For proprietary AI Agents (i.e., designed in JARC)"
  },
  {
    value: "Microsoft Hub",
    label: "Microsoft Hub",
    description: "For Microsoft Services (Business Central, SharePoint)"
  },
  {
    value: "Sales and Marketing Tools",
    label: "Sales and Marketing Tools",
    description: "For Tools Designed/Used by Sales and Marketing (excluding Power BI, Agents)"
  },
  {
    value: "Finance Tools",
    label: "Finance Tools",
    description: "For Tools Designed/Used by Finance (excluding Power BI, Agents)"
  },
  {
    value: "JARCET Tools",
    label: "JARCET Tools",
    description: "For Tools Designed/Used by JARCET (excluding Power BI, Agents)"
  },
  {
    value: "HR and Admin Tools",
    label: "HR and Admin Tools",
    description: "For Tools Designed/Used by HRAD (excluding Power BI, Agents)"
  },
  {
    value: "JARC Technologies Tools",
    label: "JARC Technologies Tools",
    description: "For Tools Designed/Used by JARC Tech (excluding Power BI, Agents)"
  },
  {
    value: "Supply Chain Tools",
    label: "Supply Chain Tools",
    description: "For Tools Designed/Used by Supply Chain (excluding Power BI, Agents)"
  },
  {
    value: "Legal Tools",
    label: "Legal Tools",
    description: "For Tools Designed/Used by Legal (excluding Power BI, Agents)"
  }
];

export const categoryValues = () => TOOL_CATEGORIES.map(item => item.value);
export const isValidToolCategory = category => TOOL_CATEGORIES.some(item => item.value === category);
// Same role keys used by OneJarc's existing grants table.
export const ONEJARC_ROLES = ['user', 'admin'];
export function validateToolConfiguration(definition, roles = ONEJARC_ROLES) {
 const errors = {};
 if (!isValidToolCategory(definition.category)) errors.category = 'Select a predefined category before saving.';
 if (definition.category === 'Power BI') {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(definition.workspaceId || '').trim())) errors.workspaceId = 'Enter a valid Workspace ID (GUID).';
  if (!Array.isArray(definition.allowedRoles) || !definition.allowedRoles.length || definition.allowedRoles.some(role=>!roles.includes(role))) errors.allowedRoles = 'Select at least one supported role.';
 }
 return errors;
}
export function withoutInactivePowerBI(definition) {
 const result = {...definition};
 if (result.category !== 'Power BI') {delete result.workspaceId;delete result.allowedRoles;}
 else {result.workspaceId=String(result.workspaceId || '').trim();result.allowedRoles=[...new Set(result.allowedRoles || [])];}
 return result;
}
export function assertToolConfiguration(definition) {
 const fields=validateToolConfiguration(definition);
 if(Object.keys(fields).length){const error=new Error(Object.values(fields).join(' '));error.fields=fields;throw error;}
}
