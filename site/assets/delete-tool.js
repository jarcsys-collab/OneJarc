// OneJarc Delete Tool helper.
// Same-origin server path; the server deletes the tool in MongoDB (see PATCHES.md).
import { apiFetch } from "./api-fetch.js";
const DELETE_TOOL_PATH = "/api/tools/delete";

export async function submitDeleteTool(toolId, fetchImpl = fetch) {
  let response;
  try {
    response = await apiFetch(DELETE_TOOL_PATH, { method: "POST", body: { id: toolId }, fetchImpl });
  } catch {
    throw new Error("Could not confirm the delete. Check your connection, and check the database before retrying.");
  }

  const result = response.data;
  if (response.ok && result === null) {
    throw new Error("Delete webhook returned an invalid JSON response.");
  }

  if (!response.ok || result?.success !== true) {
    throw new Error(result?.error || `Delete webhook failed with HTTP ${response.status}.`);
  }

  return result;
}
