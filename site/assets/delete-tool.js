// OneJarc Delete Tool webhook helper.
// Replace ONLY the URL below with your production n8n delete webhook.
const DELETE_TOOL_WEBHOOK_URL = "PASTE_YOUR_DELETE_WEBHOOK_HERE";

export async function submitDeleteTool(toolId, fetchImpl = fetch) {
  if (!DELETE_TOOL_WEBHOOK_URL || DELETE_TOOL_WEBHOOK_URL === "PASTE_YOUR_DELETE_WEBHOOK_HERE") {
    throw new Error("Delete Tool webhook is not configured. Open assets/delete-tool.js and paste your n8n webhook URL.");
  }

  const response = await fetchImpl(DELETE_TOOL_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    redirect: "error",
    body: JSON.stringify({ id: toolId })
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Delete webhook returned an invalid JSON response.");
  }

  if (!response.ok || result?.success !== true) {
    throw new Error(result?.error || `Delete webhook failed with HTTP ${response.status}.`);
  }

  return result;
}
