/**
 * OneJarc tool-launch authorization adapter.
 *
 * Sends the current tool and signed-in user identity to n8n before a tool opens.
 * The webhook URL is stored in ../onejarc-config.json.
 *
 * Request:
 *   { toolName, email, role }
 *
 * Expected success response:
 *   { authorized: true, targetUrl: "https://..." }
 */

async function loadOneJarcConfig(fetchImpl = fetch) {
  const configUrl = new URL('../onejarc-config.json', import.meta.url);
  const response = await fetchImpl(configUrl, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit'
  });

  if (!response.ok) {
    throw new Error(`Could not load OneJarc configuration (HTTP ${response.status}).`);
  }

  return response.json();
}

export async function requestToolLaunch(toolName, userEmail, userRole, fetchImpl = fetch) {
  const cleanToolName = String(toolName || '').trim();
  const cleanEmail = String(userEmail || '').trim();
  const cleanRole = String(userRole || '').trim();

  if (!cleanToolName) throw new Error('The selected tool has no name.');
  if (!cleanEmail) throw new Error('The signed-in user has no email or username available for access checking.');
  if (!cleanRole) throw new Error('The signed-in user has no role available for access checking.');

  const settings = await loadOneJarcConfig(fetchImpl);
  const url = settings.getToolCredsWebhookUrl;

  if (!url) {
    throw new Error('The get-tool-creds webhook is not configured in onejarc-config.json.');
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(settings.timeoutMs || 60000),
      body: JSON.stringify({
        toolName: cleanToolName,
        email: cleanEmail,
        role: cleanRole
      })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('The tool access request timed out. Please try again.');
    }
    throw new Error('Unable to contact the tool access service. Check the webhook and CORS settings.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The get-tool-creds webhook returned invalid JSON.');
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Tool access request failed (HTTP ${response.status}).`);
  }

  return {
    authorized: data?.authorized === true,
    targetUrl: typeof data?.targetUrl === 'string' ? data.targetUrl.trim() : '',
    message: typeof data?.message === 'string' ? data.message : ''
  };
}
