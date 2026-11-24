import { ConfidentialClientApplication, LogLevel as MsalLogLevel } from "@azure/msal-node";
import type { AccountInfo, AuthenticationResult, AuthorizationCodeRequest, AuthorizationUrlRequest } from "@azure/msal-node";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";

/** The subset of ConfidentialClientApplication the sign-in routes use (fakeable in tests). */
export interface MsalAuthClient {
  getAuthCodeUrl(request: AuthorizationUrlRequest): Promise<string>;
  acquireTokenByCode(request: AuthorizationCodeRequest): Promise<AuthenticationResult>;
  getTokenCache(): { removeAccount(account: AccountInfo): Promise<void> };
}

export function createMsalClient(config: Config, logger: Logger): MsalAuthClient {
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.entra.clientId,
      authority: config.entra.cloudInstance + config.entra.tenantId,
      clientSecret: config.entra.clientSecret,
    },
    system: {
      loggerOptions: {
        piiLoggingEnabled: false,
        logLevel: MsalLogLevel.Warning,
        loggerCallback: (level, message) => {
          if (level === MsalLogLevel.Error) logger.error("msal", { detail: message });
          else if (level === MsalLogLevel.Warning) logger.warn("msal", { detail: message });
        },
      },
    },
  });
}
