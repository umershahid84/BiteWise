import 'server-only';
import { serverEnv } from '@/lib/env';

// Bite Wise emails the app sends itself, in the same style as the sign-up email (supabase/templates/confirmation.html):
// tables and inline styles, so they look right in Gmail, Outlook and on phones.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const FONT = 'Arial,Helvetica,sans-serif';

function button(href: string, label: string, color = '#4E9F3D') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
    <td align="center" bgcolor="${color}" style="border-radius:999px;background:${color};">
      <a href="${esc(href)}" style="display:inline-block;padding:15px 30px;font:800 16px ${FONT};color:#FFFFFF;text-decoration:none;border-radius:999px;">${label}</a>
    </td></tr></table>`;
}

function layout(o: { preview: string; emoji: string; title: string; subtitle: string; body: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(o.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1F5F9;"><tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;">
    <tr><td align="center" style="padding:0 0 22px;"><img src="cid:logo" width="240" alt="Bite Wise" style="display:block;width:240px;height:auto;border:0;font:800 26px ${FONT};color:#14284B;"></td></tr>
    <tr><td style="background:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 8px 30px rgba(20,40,75,.10);">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td bgcolor="#14284B" style="background:#14284B;background-image:linear-gradient(135deg,#1F3A66 0%,#14284B 60%,#0B1730 100%);border-radius:24px 24px 0 0;padding:34px 32px 30px;text-align:center;">
          <div style="font-size:46px;line-height:1;">${o.emoji}</div>
          <h1 style="margin:14px 0 0;font:800 27px/1.25 ${FONT};color:#FFFFFF;">${o.title}</h1>
          <p style="margin:10px 0 0;font:600 16px/1.5 ${FONT};color:#BBF7D0;">${o.subtitle}</p>
        </td></tr>
        <tr><td style="padding:30px 34px 32px;font:16px/1.6 ${FONT};color:#1E293B;">${o.body}</td></tr>
      </table>
    </td></tr>
    <tr><td align="center" style="padding:22px 20px 0;font:12px/1.6 ${FONT};color:#94A3B8;">
      <b style="color:#64748B;">Bite Wise</b> · Eat well, waste less · Greater Seattle, WA<br>
      Questions? <a href="mailto:${esc(serverEnv.legal.email)}" style="color:#94A3B8;">${esc(serverEnv.legal.email)}</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

export function applicationPendingEmail(o: { restaurant: string; dashboardUrl: string }) {
  const r = esc(o.restaurant);
  return {
    subject: `We received your application, ${o.restaurant}`,
    html: layout({
      preview: 'Your email is confirmed. We are reviewing your restaurant now.',
      emoji: '⏳',
      title: 'Your application is in review',
      subtitle: 'Thanks for confirming your email.',
      body: `<p style="margin:0 0 14px;">Thanks for signing up <b>${r}</b> with Bite Wise. Your email address is confirmed, and your application
        is now <b>waiting for approval</b> by our team. This usually takes about one business day.</p>
        <p style="margin:0 0 14px;">In the meantime you can log in to set up your menu and photos. Customers will see your offers as soon as
        you're approved, and we'll email you your welcome pack: your signed Restaurant Partner Agreement and your restaurant's own kiosk link.</p>
        <div style="padding:10px 0 4px;">${button(o.dashboardUrl, 'Set up my menu')}</div>`,
    }),
    text: `Thanks for signing up ${o.restaurant} with Bite Wise. Your email is confirmed and your application is waiting for approval (usually about one business day).
Meanwhile you can set up your menu: ${o.dashboardUrl}
We'll email you once you're approved.`,
  };
}

export function welcomeEmail(o: { restaurant: string; kioskUrl: string; androidUrl: string; appleUrl: string; dashboardUrl: string }) {
  const r = esc(o.restaurant);
  const step = (n: number, html: string) => `<tr><td width="34" valign="top" style="padding:6px 0;"><div style="width:26px;height:26px;border-radius:13px;background:#E8F5E1;color:#3E8230;font:800 14px/26px ${FONT};text-align:center;">${n}</div></td><td style="padding:6px 0;font:15px/1.5 ${FONT};color:#334155;">${html}</td></tr>`;
  return {
    subject: `Welcome to Bite Wise, ${o.restaurant}! Your kiosk is ready`,
    html: layout({
      preview: 'You are approved. Your signed agreement and your kiosk link are inside.',
      emoji: '🎉',
      title: `Welcome aboard, ${r}!`,
      subtitle: 'Your restaurant is approved and live on Bite Wise.',
      body: `<p style="margin:0 0 14px;">Great news: <b>${r}</b> is approved. Customers nearby can now see and order the surplus food you post.</p>
        <p style="margin:0 0 20px;">📎 Attached is your <b>electronically signed Restaurant Partner Agreement</b> (PDF) for your records.</p>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:18px;padding:22px 22px 18px;">
          <h2 style="margin:0 0 6px;font:800 19px ${FONT};color:#14284B;">📲 Your restaurant kiosk</h2>
          <p style="margin:0 0 16px;font:15px/1.55 ${FONT};color:#475569;">Put this on the tablet at your counter. It shows new orders with a bell, and staff hand them
            over by typing the customer's PIN. No password needed: the link below is your kiosk's key, so only share it with your staff.</p>
          <p style="margin:0 0 18px;font:14px ${FONT};"><a href="${esc(o.kioskUrl)}" style="color:#2563EB;word-break:break-all;">${esc(o.kioskUrl)}</a></p>
          <p style="margin:0 0 10px;font:700 14px ${FONT};color:#14284B;">Open this email on the tablet and tap your device:</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="50%" style="padding:0 6px 0 0;">${button(o.androidUrl, '🤖 Android tablet', '#3E8230')}</td>
            <td width="50%" style="padding:0 0 0 6px;">${button(o.appleUrl, '📱 iPad / iPhone', '#14284B')}</td>
          </tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
            ${step(1, 'The kiosk opens with an <b>Add to Home screen</b> guide for your device.')}
            ${step(2, 'Confirm, and a <b>Bite Wise Kiosk</b> icon appears on the tablet\'s home screen.')}
            ${step(3, 'Tap the icon any time to open your kiosk full-screen.')}
          </table>
        </div>
        <p style="margin:22px 0 10px;">Next steps: post your first offer, and connect Stripe in the <b>Payouts</b> tab so you're paid at every pickup.</p>
        <div style="padding:6px 0 0;">${button(o.dashboardUrl, 'Open my dashboard', '#14284B')}</div>`,
    }),
    text: `Welcome to Bite Wise, ${o.restaurant}! You're approved and live.
Your electronically signed Restaurant Partner Agreement is attached.

Your restaurant kiosk (open it on your counter tablet; share it only with your staff):
${o.kioskUrl}
Android tablet: ${o.androidUrl}
iPad / iPhone: ${o.appleUrl}

Dashboard: ${o.dashboardUrl}`,
  };
}
