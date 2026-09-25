/**
 * Resilient MSAL Browser loader for OneJarc GitHub Pages.
 *
 * MSAL is intentionally loaded at runtime from several public CDN fallbacks.
 * This avoids making OneJarc depend on a single Microsoft CDN endpoint.
 * No credentials or secrets are stored here.
 */

const MSAL_SOURCES = Object.freeze([
  'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js',
  'https://unpkg.com/@azure/msal-browser@2.38.3/lib/msal-browser.min.js',
  'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js'
]);

let msalLoadPromise = null;

function hasMsal() {
  return Boolean(window.msal?.PublicClientApplication);
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src === src);
    if (existing) {
      if (hasMsal()) return resolve(window.msal);
      existing.addEventListener('load', () => resolve(window.msal), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.onload = () => {
      if (hasMsal()) resolve(window.msal);
      else reject(new Error(`MSAL script loaded from ${src}, but window.msal was not initialized.`));
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export async function ensureMsalBrowser() {
  if (hasMsal()) return window.msal;

  if (!msalLoadPromise) {
    msalLoadPromise = (async () => {
      const failures = [];

      for (const src of MSAL_SOURCES) {
        try {
          await loadClassicScript(src);
          if (hasMsal()) {
            console.info('[OneJarc] MSAL loaded successfully.');
            return window.msal;
          }
        } catch (error) {
          failures.push(error?.message || String(error));
          console.warn('[OneJarc] MSAL source failed:', src, error);
        }
      }

      throw new Error(
        'Microsoft Authentication Library (MSAL) could not be loaded. ' +
        'The browser or network blocked all configured MSAL sources. ' +
        failures.join(' | ')
      );
    })().catch((error) => {
      // Allow a later retry after network/privacy settings change.
      msalLoadPromise = null;
      throw error;
    });
  }

  return msalLoadPromise;
}

export function isMsalLoaded() {
  return hasMsal();
}
