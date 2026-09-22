/**
 * OneJarc tool launcher.
 * Checks the signed-in user's access through n8n before opening the returned URL.
 */
export async function launchTool(toolName, userEmail, userRole) {
  const response = await fetch('https://jarc-juno.app.n8n.cloud/webhook/get-tool-creds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolName: toolName,
      email: userEmail, // e.g., "systems@jarcgroup.ph"
      role: userRole
    })
  });

  const data = await response.json();

  if (data.authorized && data.targetUrl) {
    // Perform redirection
    window.open(data.targetUrl, '_blank');
  } else {
    alert('Unauthorized access');
  }
}
