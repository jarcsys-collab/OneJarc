/**
 * OneJarc authorized tool launcher.
 * Calls n8n for authorization and supports:
 *   1) Power BI User-Owns-Data embedding using the signed-in user's MSAL token
 *   2) Standard embedded web/SaaS tools using targetUrl
 */

import { embedPowerBiUserReport } from './powerbi-report-embed.js';

export async function launchTool(toolName, userEmail, userRole) {
  try {
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

    const raw = await response.json();
    // Some n8n workflows return a single item wrapped in an array.
    const data = Array.isArray(raw) ? raw[0] : raw;

    if (!data || !data.authorized) {
      alert('Access Denied: You do not have permission to view this tool.');
      return data;
    }

    if (data.category === 'Power BI') {
      await showPowerBIReport(data, toolName);
      return data;
    }

    if (data.targetUrl) {
      showEmbeddedTool(data.targetUrl, toolName);
      return data;
    }

    throw new Error('Authorization succeeded, but no target URL or Power BI embed configuration was returned.');
  } catch (error) {
    console.error('Authorization error:', error);
    alert(`An error occurred during tool authorization. ${error?.message || ''}`.trim());
    throw error;
  }
}

function createViewerShell(toolName, externalUrl) {
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

  if (externalUrl) {
    const openExternal = document.createElement('button');
    openExternal.type = 'button';
    openExternal.textContent = 'Open in new tab';
    Object.assign(openExternal.style, buttonStyle());
    openExternal.addEventListener('click', () => window.open(externalUrl, '_blank', 'noopener,noreferrer'));
    actions.appendChild(openExternal);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  Object.assign(close.style, buttonStyle());
  close.addEventListener('click', () => {
    const pbiContainer = overlay.querySelector('#powerbi-container');
    if (pbiContainer && window.powerbi) {
      try { window.powerbi.reset(pbiContainer); } catch (_) {}
    }
    overlay.remove();
  });

  actions.appendChild(close);
  header.append(title, actions);
  overlay.appendChild(header);
  document.body.appendChild(overlay);

  return overlay;
}

async function showPowerBIReport(data, toolName) {
  const externalUrl = data.targetUrl || data.embedUrl || '';
  const overlay = createViewerShell(toolName, externalUrl);

  const status = document.createElement('div');
  status.textContent = 'Authenticating your Microsoft account for Power BI...';
  Object.assign(status.style, {
    padding: '20px',
    textAlign: 'center',
    color: '#d7dee7',
    fontFamily: 'system-ui, sans-serif'
  });
  overlay.appendChild(status);

  const container = document.createElement('div');
  container.id = 'powerbi-container';
  Object.assign(container.style, {
    width: '100%',
    flex: '1',
    minHeight: '0',
    background: 'transparent',
    display: 'none'
  });
  overlay.appendChild(container);

  try {
    await embedPowerBiUserReport(container, data);
    status.remove();
    container.style.display = 'block';
  } catch (error) {
    console.error('Failed to render Power BI report:', error);
    status.textContent = `Report Load Failed: ${error?.message || 'Unable to authenticate or load the report.'}`;
    status.style.color = '#ff8b8b';
    throw error;
  }
}

function showEmbeddedTool(targetUrl, toolName) {
  const overlay = createViewerShell(toolName, targetUrl);

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

  overlay.appendChild(iframe);
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
