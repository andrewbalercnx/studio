import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

// Lazily initialized Graph client
let graphClient: Client | null = null;

// The sender email address (must be a valid mailbox in the tenant)
const SENDER_EMAIL = 'andrew.bale@rcnx.io';

function getGraphClient(): Client | null {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    return null;
  }

  if (!graphClient) {
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    });

    graphClient = Client.initWithMiddleware({
      authProvider,
    });
  }

  return graphClient;
}

export type SendEmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
};

/**
 * Send an email using Microsoft Graph API.
 * Requires AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET environment variables.
 * If credentials aren't configured, logs a warning and returns silently.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const client = getGraphClient();

  if (!client) {
    console.warn('[Email] Microsoft Graph credentials not configured (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET), skipping email');
    return;
  }

  const recipients = Array.isArray(options.to) ? options.to : [options.to];

  const message = {
    subject: options.subject,
    body: {
      contentType: 'HTML',
      content: options.html,
    },
    toRecipients: recipients.map((email) => ({
      emailAddress: {
        address: email,
      },
    })),
  };

  try {
    await client
      .api(`/users/${SENDER_EMAIL}/sendMail`)
      .post({ message, saveToSentItems: false });

    console.log(`[Email] Sent: "${options.subject}" to ${recipients.join(', ')}`);
  } catch (error: any) {
    console.error(`[Email] Failed to send: ${error.message}`);
    throw error;
  }
}
