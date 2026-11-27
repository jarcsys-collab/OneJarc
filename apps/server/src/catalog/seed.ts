import { fieldsFromDefinition, validateDefinition, type Definition, type NewToolDoc } from "./definition.js";

const NOTE = "Example tool added on first start. Edit or delete it in the admin console.";

const EXAMPLES: { def: Definition; live: boolean }[] = [
  {
    live: true,
    def: {
      name: "Microsoft 365",
      category: "Microsoft Hub",
      description: `Start page for Word, Excel, PowerPoint, Teams and the rest of Microsoft 365. ${NOTE}`,
      applicationUrl: "https://www.microsoft365.com/",
      openBehavior: "new-tab",
      owner: "IT",
      iconKey: "business",
      color: "#579ee9",
      status: "Operational",
      keywords: ["office", "word", "excel", "teams"],
    },
  },
  {
    live: true,
    def: {
      name: "Outlook on the web",
      category: "Microsoft Hub",
      description: `Company email and calendar in the browser. ${NOTE}`,
      applicationUrl: "https://outlook.office.com/mail/",
      openBehavior: "new-tab",
      owner: "IT",
      iconKey: "chat",
      color: "#5778d9",
      status: "Operational",
      keywords: ["email", "mail", "calendar"],
    },
  },
  {
    live: true,
    def: {
      name: "Microsoft Learn",
      category: "JARC Technologies Tools",
      description: `Free training and documentation for Microsoft products. ${NOTE}`,
      applicationUrl: "https://learn.microsoft.com/",
      openBehavior: "new-tab",
      owner: "JARC Tech",
      iconKey: "documents",
      color: "#29b7aa",
      status: "Operational",
      keywords: ["training", "docs", "how-to"],
    },
  },
  {
    // A draft, so only admins see it: it shows how a Power BI tool is set up.
    live: false,
    def: {
      name: "Example Power BI report",
      category: "Power BI",
      description:
        "Draft example. Paste the report link (https://app.powerbi.com/groups/<workspace>/reports/<report>) and the workspace ID, then publish.",
      applicationUrl: "https://app.powerbi.com/",
      openBehavior: "embedded",
      owner: "Finance",
      iconKey: "analytics",
      color: "#df9643",
      status: "Operational",
      workspaceId: "00000000-0000-0000-0000-000000000000",
      allowedRoles: ["user", "admin"],
    },
  },
];

export function seedTools(now = new Date()): NewToolDoc[] {
  const at = now.toISOString();
  return EXAMPLES.map(({ def, live }) => {
    const valid = validateDefinition(def, { publish: live, allowLocalHttp: false });
    return {
      ...fieldsFromDefinition(valid),
      draft: valid,
      published: live ? true : null,
      enabled: true,
      archived: false,
      createdAt: at,
      updatedAt: at,
      createdBy: "seed",
      updatedBy: "seed",
    };
  });
}
