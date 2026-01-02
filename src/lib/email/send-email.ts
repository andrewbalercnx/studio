import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { getServerFirestore } from '@/lib/server-firestore';
import { DEFAULT_EMAIL_CONFIG, type EmailConfig } from '@/lib/types';

// Lazily initialized Graph client
let graphClient: Client | null = null;

// Cached email config - refreshed on each email send to pick up changes
let cachedEmailConfig: EmailConfig | null = null;
let configLastFetched: number = 0;
const CONFIG_CACHE_TTL_MS = 60 * 1000; // 1 minute cache

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

/**
 * Get email configuration from Firestore with caching.
 * Falls back to default config if not found.
 */
export async function getEmailConfig(): Promise<EmailConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (cachedEmailConfig && now - configLastFetched < CONFIG_CACHE_TTL_MS) {
    return cachedEmailConfig;
  }

  try {
    const firestore = await getServerFirestore();
    const doc = await firestore.doc('systemConfig/email').get();

    if (doc.exists) {
      // Merge with defaults to ensure all fields exist
      cachedEmailConfig = {
        ...DEFAULT_EMAIL_CONFIG,
        ...doc.data(),
      } as EmailConfig;
    } else {
      cachedEmailConfig = DEFAULT_EMAIL_CONFIG;
    }

    configLastFetched = now;
    return cachedEmailConfig;
  } catch (error) {
    console.warn('[Email] Failed to fetch email config, using defaults:', error);
    return DEFAULT_EMAIL_CONFIG;
  }
}

/**
 * Clear the email config cache to force a refresh on next request.
 */
export function clearEmailConfigCache(): void {
  cachedEmailConfig = null;
  configLastFetched = 0;
}

export type SendEmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
};

/**
 * Send an email using Microsoft Graph API.
 * Requires AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET environment variables.
 * Sender address is read from systemConfig/email in Firestore.
 * If credentials aren't configured, logs a warning and returns silently.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const client = getGraphClient();

  if (!client) {
    console.warn('[Email] Microsoft Graph credentials not configured (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET), skipping email');
    return;
  }

  // Get sender email from config
  const config = await getEmailConfig();
  const senderEmail = config.senderEmail;

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
      .api(`/users/${senderEmail}/sendMail`)
      .post({ message, saveToSentItems: false });

    console.log(`[Email] Sent: "${options.subject}" to ${recipients.join(', ')} (from: ${senderEmail})`);
  } catch (error: any) {
    console.error(`[Email] Failed to send from ${senderEmail}: ${error.message}`);
    throw error;
  }
}
