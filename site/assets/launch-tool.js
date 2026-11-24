/**
 * OneJarc authorized tool launcher.
 * Asks the OneJarc server (which forwards to n8n) for authorization and supports:
 *   1) Power BI App-Owns-Data embedding when n8n returns category=Power BI + accessToken
 *   2) Standard embedded web/SaaS tools using targetUrl
 * The server adds the signed-in user's email and role itself (see PATCHES.md).
 */
import { apiFetch, apiErrorMessage } from './api-fetch.js';

const GET_TOOL_CREDS_PATH = '/api/n8n/get-tool-creds';
const EMBED_TOKEN_PATH = '/api/powerbi/embed-token';
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const DEFAULT_REFRESH_MS = 50 * 60 * 1000;
const RETRY_REFRESH_MS = 60 * 1000;

// Usage: launchTool(toolName, { toolId }).
// The old form launchTool(toolName, email, role[, toolId]) still works; email and role are ignored.
export async function launchTool(toolName, options = {}, _legacyRole, legacyToolId) {
  const toolId = options && typeof options === 'object' ? options.toolId : legacyToolId;
  try {
    const response = await apiFetch(GET_TOOL_CREDS_PATH, {
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

    // Power BI embedding using the Service Principal / Embed token returned by n8n.
    if (data.category === 'Power BI' && data.accessToken) {
      showPowerBIReport(data, toolName, toolId);
      return data;
    }

    // Standard web application / SaaS fallback.
    if (data.targetUrl) {
      showEmbeddedTool(data.targetUrl, toolName);
      return data;
    }

    throw new Error('Authorization succeeded, but no target URL or Power BI embed configuration was returned.');
  } catch (error) {
    console.error('Authorization error:', error);
    alert('An error occurred during tool authorization.');
    throw error;
  }
}

// Power BI embed-token refresh: one active report at a time (one viewer overlay).
let activeReport = null;
let refreshTimer = null;
let refreshDueAt = 0;
let refreshTask = null;

function stopTokenRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  refreshDueAt = 0;
  refreshTask = null;
  activeReport = null;
}

function scheduleTokenRefresh(delayMs) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const delay = Math.max(10000, delayMs);
  refreshDueAt = Date.now() + delay;
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshTask?.(); }, delay);
}

function refreshDelayFor(expiration) {
  const expiresAt = typeof expiration === 'string' && expiration ? Date.parse(expiration) : NaN;
  return Number.isFinite(expiresAt) ? expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS : DEFAULT_REFRESH_MS;
}

function startTokenRefresh(report, toolName, toolId, expiration) {
  stopTokenRefresh();
  activeReport = report;
  refreshTask = async () => {
    if (activeReport !== report) return;
    try {
      const response = await apiFetch(EMBED_TOKEN_PATH, { method: 'POST', body: { toolId, toolName } });
      if (activeReport !== report) return;
      if (response.status === 401) { console.warn('Power BI token refresh stopped:', response.data.error); return; }
      if (!response.ok || !response.data?.accessToken) {
        throw new Error(apiErrorMessage(response.data, `Embed token refresh failed (${response.status}).`));
      }
      await report.setAccessToken(response.data.accessToken);
      if (activeReport === report) scheduleTokenRefresh(refreshDelayFor(response.data.expiration));
    } catch (error) {
      console.error('Power BI token refresh failed; retrying in 1 minute:', error);
      if (activeReport === report) scheduleTokenRefresh(RETRY_REFRESH_MS);
    }
  };
  scheduleTokenRefresh(refreshDelayFor(expiration));
}

// Background tabs throttle timers; refresh as soon as the tab is visible again if a refresh is overdue.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && refreshTask && refreshDueAt && Date.now() >= refreshDueAt) {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
      refreshDueAt = 0;
      refreshTask();
    }
  });
}

function createViewerShell(toolName, externalUrl) {
  stopTokenRefresh();
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
    stopTokenRefresh();
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

function showPowerBIReport(data, toolName, toolId) {
  const embedUrl = data.embedUrl || data.targetUrl;
  if (!embedUrl || !data.reportId) {
    throw new Error('Power BI authorization response is missing reportId or embedUrl/targetUrl.');
  }

  if (!window.powerbi) {
    throw new Error('Power BI JavaScript SDK is not loaded.');
  }

  const overlay = createViewerShell(toolName, data.targetUrl || embedUrl);
  const pbiReportContainer = document.createElement('div');
  pbiReportContainer.id = 'powerbi-container';
  Object.assign(pbiReportContainer.style, {
    width: '100%',
    flex: '1',
    minHeight: '0',
    background: '#fff'
  });
  overlay.appendChild(pbiReportContainer);

  const config = {
    type: 'report',
    id: data.reportId,
    embedUrl: embedUrl,
    accessToken: data.accessToken,
    tokenType: 1, // models.TokenType.Embed (App-Owns-Data)
    settings: {
      panes: {
        filters: { expanded: false, visible: false },
        pageNavigation: { visible: true }
      }
    }
  };

  window.powerbi.reset(pbiReportContainer);
  const report = window.powerbi.embed(pbiReportContainer, config);
  if (report && typeof report.setAccessToken === 'function') {
    startTokenRefresh(report, toolName, toolId, data.expiration ?? data.tokenExpiration ?? null);
  }
  return report;
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
