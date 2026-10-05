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

// Sends an email through the SMTP account in .env.local. Without SMTP_HOST (e.g. local development) the email is
// only logged, so nothing else fails. Returns whether it was actually sent.
export async function sendEmail(email: Email): Promise<boolean> {
  const { smtp } = serverEnv;
  if (!smtp.host) {
    console.info(`[email not sent: SMTP_HOST is not set] to ${email.to}: ${email.subject}`);
    return false;
  }
  transport ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  await transport.sendMail({
    from: smtp.from,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: [LOGO, ...(email.attachments ?? [])],
  });
  return true;
}
