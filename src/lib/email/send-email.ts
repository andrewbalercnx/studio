import nodemailer from 'nodemailer';

// Create transporter lazily to avoid issues when env vars aren't set
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }

  return transporter;
}

export type SendEmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
};

/**
 * Send an email using Gmail SMTP.
 * Requires GMAIL_USER and GMAIL_APP_PASSWORD environment variables.
 * If credentials aren't configured, logs a warning and returns silently.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const mailer = getTransporter();

  if (!mailer) {
    console.warn('[Email] Gmail credentials not configured (GMAIL_USER, GMAIL_APP_PASSWORD), skipping email');
    return;
  }

  try {
    await mailer.sendMail({
      from: `"StoryPic Kids" <${process.env.GMAIL_USER}>`,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
    });

    console.log(`[Email] Sent: "${options.subject}" to ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
  } catch (error: any) {
    console.error(`[Email] Failed to send: ${error.message}`);
    throw error;
  }
}
