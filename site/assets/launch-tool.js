/**
 * OneJarc authorized tool launcher.
 * Asks the OneJarc server whether the signed-in user may open the tool
 * (POST /api/tools/launch) and opens the URL it returns:
 *   - openBehavior "new-tab":  a new browser tab (falls back to the viewer if pop-ups are blocked)
 *   - openBehavior "same-tab": this tab
 *   - otherwise ("embedded"):  the full-screen viewer below
 * Power BI reports come back as their secure-embed URL and open in the viewer
 * with the user's own Power BI sign-in. See PATCHES.md.
 */
import { apiFetch, apiErrorMessage } from './api-fetch.js';

const LAUNCH_PATH = '/api/tools/launch';

// Usage: launchTool(toolName, { toolId }).
// The old form launchTool(toolName, email, role[, toolId]) still works; email and role are ignored.
export async function launchTool(toolName, options = {}, _legacyRole, legacyToolId) {
  const toolId = options && typeof options === 'object' ? options.toolId : legacyToolId;
  try {
    const response = await apiFetch(LAUNCH_PATH, {
      method: 'POST',
      body: { toolName, ...(toolId ? { toolId } : {}) }
    });

    if (!response.ok) {
      throw new Error(apiErrorMessage(response.data, `Authorization request failed (${response.status}).`));
    }

    const data = response.data;
    if (!data || typeof data !== 'object') {
      throw new Error('Authorization response was not valid JSON.');
    }

    if (!data.authorized) {
      alert('Access Denied: You do not have permission to view this tool.');
      return data;
    }

    if (!data.targetUrl) {
      throw new Error('Authorization succeeded, but no target URL was returned.');
    }

    if (data.openBehavior === 'same-tab') {
      window.location.assign(data.targetUrl);
    } else if (data.openBehavior === 'new-tab') {
      openInNewTab(data.targetUrl, toolName);
    } else {
      showEmbeddedTool(data.targetUrl, toolName);
    }
    return data;
  } catch (error) {
    console.error('Authorization error:', error);
    alert('An error occurred during tool authorization.');
    throw error;
  }
}

function openInNewTab(targetUrl, toolName) {
  // Open blank first so a blocked pop-up can be detected (noopener always returns null).
  const tab = window.open('', '_blank');
  if (!tab) {
    showEmbeddedTool(targetUrl, toolName);
    return;
  }
  tab.opener = null;
  tab.location.href = targetUrl;
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
  close.addEventListener('click', () => overlay.remove());

  actions.appendChild(close);
  header.append(title, actions);
  overlay.appendChild(header);
  document.body.appendChild(overlay);

  return overlay;
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
