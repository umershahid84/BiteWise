import 'server-only';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { serverEnv } from '@/lib/env';

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

let transport: Transporter | undefined;

// The logo is attached inline (cid:logo), so it shows in every email app without hosting the image anywhere.
const LOGO = { filename: 'bite-wise.png', path: path.join(process.cwd(), 'public', 'assets', 'email-logo.png'), cid: 'logo' };

// Whether the app can send email itself (SMTP_HOST, and a password when there is a user name).
export const emailConfigured = () => Boolean(serverEnv.smtp.host && (!serverEnv.smtp.user || serverEnv.smtp.password));

// Sends an email through the SMTP account in .env.local. Without SMTP_HOST (e.g. local development) the email is
// only logged, so nothing else fails. Returns whether it was actually sent.
export async function sendEmail(email: Email): Promise<boolean> {
  const { smtp } = serverEnv;
  if (!smtp.host) {
    console.info(`[email not sent: SMTP_HOST is not set] to ${email.to}: ${email.subject}`);
    return false;
  }
  if (smtp.user && !smtp.password) {
    console.warn(`[email not sent: SMTP_PASSWORD is empty in .env.local] to ${email.to}: ${email.subject}
  Add SMTP_PASSWORD=... (for Gmail, a 16-letter app password from https://myaccount.google.com/apppasswords) and restart the app.`);
    return false;
  }
  transport ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  try {
    await transport.sendMail({
      from: smtp.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [LOGO, ...(email.attachments ?? [])],
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'EAUTH') {
      transport = undefined; // try a fresh login next time
      console.warn(`[email not sent: the SMTP server refused the login for ${smtp.user}] to ${email.to}: ${email.subject}
  Check SMTP_USER and SMTP_PASSWORD in .env.local. For Gmail, SMTP_PASSWORD must be an app password (https://myaccount.google.com/apppasswords), not your normal password.`);
      return false;
    }
    throw err;
  }
  return true;
}
