/**
 * OneJarc login webhook adapter.
 *
 * The webhook URL is read from ../onejarc-config.json so it can be changed
 * without editing the compiled application bundle.
 *
 * Request sent to n8n:
 *   { username, password }
 *
 * Accepted successful responses:
 *   { success: true, user: { id, username, displayName, role } }
 * or
 *   { user: { id, username, displayName, role } }
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

function normalizeAuthenticatedUser(data, fallbackUsername) {
  const source = data && typeof data === 'object' && data.user && typeof data.user === 'object'
    ? data.user
    : data;

  if (!source || typeof source !== 'object') return null;

  const username = String(source.username || source.email || fallbackUsername || '').trim();
  const role = String(source.role || '').trim().toLowerCase();

  if (!username || !role) return null;

  return {
    id: String(source.id || source.userId || source._id || username),
    username,
    displayName: String(source.displayName || source.name || username),
    role,
    ...(source.email ? { email: String(source.email) } : {})
  };
}

export async function signInWithWebhook(username, password, fetchImpl = fetch) {
  const cleanUsername = String(username || '').trim().toLowerCase();

  if (!cleanUsername || !password) {
    throw new Error('Enter your username and password.');
  }

  const settings = await loadOneJarcConfig(fetchImpl);
  const url = settings.loginWebhookUrl;

  if (!url) {
    throw new Error('Login webhook is not configured in onejarc-config.json.');
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
        username: cleanUsername,
        password
      })
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('Login request timed out. Please try again.');
    }
    throw new Error('Unable to connect to the authentication service. Check the connection and webhook CORS settings.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The login webhook returned invalid JSON.');
  }

  if (!response.ok || data?.success === false || data?.authorized === false) {
    throw new Error(data?.message || data?.error || 'Incorrect username or password.');
  }

  const user = normalizeAuthenticatedUser(data, cleanUsername);
  if (!user) {
    throw new Error('Login succeeded but the webhook did not return a valid user and role.');
  }

  return user;
}
