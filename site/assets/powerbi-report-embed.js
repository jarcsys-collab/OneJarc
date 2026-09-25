/**
 * OneJarc Power BI User-Owns-Data embed helper.
 *
 * This is the static/GitHub-Pages equivalent of the React component version:
 * - receives report metadata from n8n
 * - obtains the signed-in user's Microsoft Entra token through MSAL
 * - embeds the report with Power BI's JavaScript SDK using TokenType.Aad
 */

import { msalConfig, powerBiRequest, assertMsalConfigReady } from './msal-config.js';

let msalInstancePromise = null;

function requireMsalBrowser() {
  if (!window.msal?.PublicClientApplication) {
    throw new Error('Microsoft Authentication Library (MSAL) is not loaded.');
  }
  return window.msal;
}

function requirePowerBiSdk() {
  if (!window.powerbi?.embed) {
    throw new Error('Power BI JavaScript SDK is not loaded.');
  }
  return window.powerbi;
}

async function getMsalInstance() {
  assertMsalConfigReady();
  const msal = requireMsalBrowser();

  if (!msalInstancePromise) {
    msalInstancePromise = (async () => {
      const instance = new msal.PublicClientApplication(msalConfig);
      if (typeof instance.initialize === 'function') {
        await instance.initialize();
      }

      // Complete a redirect flow if one ever occurred and restore its account.
      if (typeof instance.handleRedirectPromise === 'function') {
        try {
          const redirectResult = await instance.handleRedirectPromise();
          if (redirectResult?.account && typeof instance.setActiveAccount === 'function') {
            instance.setActiveAccount(redirectResult.account);
          }
        } catch (error) {
          console.warn('MSAL redirect processing failed:', error);
        }
      }

      return instance;
    })();
  }

  return msalInstancePromise;
}

async function acquirePowerBiUserToken() {
  const instance = await getMsalInstance();
  let account = typeof instance.getActiveAccount === 'function'
    ? instance.getActiveAccount()
    : null;

  if (!account) {
    const accounts = typeof instance.getAllAccounts === 'function'
      ? instance.getAllAccounts()
      : [];
    account = accounts?.[0] || null;
  }

  if (account) {
    try {
      const tokenResponse = await instance.acquireTokenSilent({
        ...powerBiRequest,
        account
      });
      if (tokenResponse?.accessToken) return tokenResponse;
    } catch (silentError) {
      console.warn('Silent Power BI token acquisition failed; using popup.', silentError);
    }
  }

  const popupResponse = await instance.acquireTokenPopup(powerBiRequest);
  if (popupResponse?.account && typeof instance.setActiveAccount === 'function') {
    instance.setActiveAccount(popupResponse.account);
  }
  if (!popupResponse?.accessToken) {
    throw new Error('Microsoft sign-in completed but no Power BI access token was returned.');
  }
  return popupResponse;
}

function getPowerBiModels() {
  return window['powerbi-client']?.models || window.powerbi?.models || null;
}

/**
 * Embed a report into an existing DOM element.
 *
 * Expected metadata from n8n:
 *   {
 *     reportId: 'GUID',
 *     embedUrl: 'https://app.powerbi.com/reportEmbed?...' // preferred
 *     targetUrl: '...'                                    // fallback
 *   }
 */
export async function embedPowerBiUserReport(container, n8nMetadata) {
  if (!container) {
    throw new Error('Power BI embed container was not provided.');
  }

  const reportId = String(n8nMetadata?.reportId || '').trim();
  const embedUrl = String(n8nMetadata?.embedUrl || n8nMetadata?.targetUrl || '').trim();

  if (!reportId || !embedUrl) {
    throw new Error('Missing valid Power BI report metadata from n8n (reportId and embedUrl/targetUrl are required).');
  }

  const powerbi = requirePowerBiSdk();
  const tokenResponse = await acquirePowerBiUserToken();
  const models = getPowerBiModels();

  const embedConfig = {
    type: 'report',
    id: reportId,
    embedUrl,
    accessToken: tokenResponse.accessToken,
    tokenType: models?.TokenType?.Aad ?? 0,
    settings: {
      panes: {
        filters: { expanded: false, visible: false },
        pageNavigation: {
          visible: true,
          ...(models?.PageNavigationPosition?.Bottom !== undefined
            ? { position: models.PageNavigationPosition.Bottom }
            : {})
        }
      },
      ...(models?.BackgroundType?.Transparent !== undefined
        ? { background: models.BackgroundType.Transparent }
        : {})
    }
  };

  try {
    powerbi.reset(container);
  } catch (_) {
    // A new container may not have an existing embed instance yet.
  }

  const report = powerbi.embed(container, embedConfig);
  if (report?.on) {
    report.on('error', (event) => {
      console.error('Power BI Embed Error:', event?.detail || event);
    });
  }

  return {
    report,
    tokenResponse,
    reset() {
      try { powerbi.reset(container); } catch (_) {}
    }
  };
}
