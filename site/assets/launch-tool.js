/**
 * OneJarc authorized embedded tool launcher.
 * Calls n8n for authorization and embeds the returned targetUrl inside OneJarc.
 */
export async function launchTool(toolName, userEmail, userRole) {
  const response = await fetch('https://jarc-juno.app.n8n.cloud/webhook/get-tool-creds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolName: toolName,
      email: userEmail,
      role: userRole
    })
  });

  if (!response.ok) {
    throw new Error(`Authorization request failed (${response.status}).`);
  }

  const data = await response.json();

  if (data.authorized && data.targetUrl) {
    showEmbeddedTool(data.targetUrl, toolName);
    return data;
  }

  alert('Access Denied: You do not have permission to view this tool.');
  return data;
}

function showEmbeddedTool(targetUrl, toolName) {
  const existing = document.getElementById('onejarc-embedded-tool-viewer');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'onejarc-embedded-tool-viewer';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    background: '#0b0f14',
    display: 'flex',
    flexDirection: 'column'
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    height: '56px',
    minHeight: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '0 16px',
    background: '#111820',
    borderBottom: '1px solid rgba(255,255,255,.10)',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif'
  });

  const title = document.createElement('strong');
  title.textContent = toolName || 'OneJARC Tool';

  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', gap: '8px' });

  const openExternal = document.createElement('button');
  openExternal.type = 'button';
  openExternal.textContent = 'Open in new tab';
  Object.assign(openExternal.style, buttonStyle());
  openExternal.addEventListener('click', () => window.open(targetUrl, '_blank', 'noopener,noreferrer'));

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  Object.assign(close.style, buttonStyle());
  close.addEventListener('click', () => overlay.remove());

  actions.append(openExternal, close);
  header.append(title, actions);

  const iframe = document.createElement('iframe');
  iframe.src = targetUrl;
  iframe.title = toolName || 'OneJARC Tool';
  iframe.allowFullscreen = true;
  iframe.setAttribute('allow', 'fullscreen; clipboard-read; clipboard-write');
  Object.assign(iframe.style, {
    width: '100%',
    flex: '1',
    border: '0',
    background: '#fff'
  });

  overlay.append(header, iframe);
  document.body.appendChild(overlay);
}

function buttonStyle() {
  return {
    border: '1px solid rgba(255,255,255,.18)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,.08)',
    color: '#fff',
    padding: '8px 12px',
    cursor: 'pointer',
    font: 'inherit'
  };
}
