/**
 * OneJarc Microsoft Entra / MSAL configuration for Power BI User-Owns-Data.
 *
 * EDIT ONLY THE TWO VALUES BELOW when connecting OneJarc to your Azure App Registration.
 * These are public application identifiers, not secrets.
 * NEVER place a client secret, password, access token, or refresh token in this file.
 */

export const AZURE_CLIENT_ID = 'YOUR_AZURE_CLIENT_ID';
export const AZURE_TENANT_ID = 'YOUR_TENANT_ID';

export const msalConfig = Object.freeze({
  auth: {
    clientId: AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
    redirectUri: window.location.origin
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false
  },
  system: {
    loggerOptions: {
      loggerCallback: (_level, message, containsPii) => {
        if (!containsPii && message) console.debug('[MSAL]', message);
      },
      logLevel: 2,
      piiLoggingEnabled: false
    }
  }
});

/**
 * Power BI delegated permission requested for the signed-in Microsoft user.
 * Configure the matching delegated API permission on the Azure App Registration.
 */
export const powerBiRequest = Object.freeze({
  scopes: ['https://analysis.windows.net/powerbi/api/Report.Read.All']
});

export function assertMsalConfigReady() {
  if (!AZURE_CLIENT_ID || AZURE_CLIENT_ID === 'YOUR_AZURE_CLIENT_ID') {
    throw new Error('Power BI MSAL is not configured. Set AZURE_CLIENT_ID in assets/msal-config.js.');
  }
  if (!AZURE_TENANT_ID || AZURE_TENANT_ID === 'YOUR_TENANT_ID') {
    throw new Error('Power BI MSAL is not configured. Set AZURE_TENANT_ID in assets/msal-config.js.');
  }
}
