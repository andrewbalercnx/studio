import nodemailer from 'nodemailer';

// Create transporter lazily to avoid issues when env vars aren't set
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    return null;
  }

  if (!transporter) {
    // Microsoft 365 / Outlook SMTP configuration
    transporter = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false, // Use STARTTLS
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false,
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
 * Send an email using Microsoft 365 SMTP.
 * Requires SMTP_USER and SMTP_PASSWORD environment variables.
 * If credentials aren't configured, logs a warning and returns silently.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const mailer = getTransporter();

  if (!mailer) {
    console.warn('[Email] SMTP credentials not configured (SMTP_USER, SMTP_PASSWORD), skipping email');
    return;
  }

  try {
    await mailer.sendMail({
      from: `"StoryPic Kids" <${process.env.SMTP_USER}>`,
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
