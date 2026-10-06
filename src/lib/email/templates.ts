import 'server-only';
import { serverEnv } from '@/lib/env';
import type { Receipt } from '@/lib/receipts/data';

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
      <b style="color:#64748B;">Bite Wise</b> · Eat well, waste less · United States &amp; Canada<br>
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

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: serverEnv.timeZone });

// The restaurant's plan, for the welcome email: a Pioneer Member number, or the prices and Pioneer spots left.
export type WelcomePlan = { founding: number | null; hasPlan: boolean; pioneerSpotsLeft: number; monthlyCents: number; annualCents: number };

function planBox(p: WelcomePlan, planUrl: string) {
  if (p.founding) {
    return `<div style="background:#E8F5E1;border-radius:18px;padding:18px 22px;margin:0 0 20px;">
      <p style="margin:0;font:800 17px ${FONT};color:#2F6B24;">🎉 You're Pioneer Member #${p.founding}</p>
      <p style="margin:6px 0 0;font:15px/1.55 ${FONT};color:#334155;">Your subscription is <b>FREE</b>: each invoice shows your plan price, minus the Pioneer Members Discount, for a total of $0.00. No card needed.</p>
    </div>`;
  }
  if (p.hasPlan) return '';
  const saving = p.monthlyCents * 12 - p.annualCents;
  if (p.pioneerSpotsLeft > 0) {
    return `<div style="background:#E8F5E1;border-radius:18px;padding:18px 22px;margin:0 0 20px;">
      <p style="margin:0;font:800 17px ${FONT};color:#2F6B24;">⭐ Choose your plan: it's FREE for Pioneer Members</p>
      <p style="margin:6px 0 14px;font:15px/1.55 ${FONT};color:#334155;">Only ${p.pioneerSpotsLeft} Pioneer spot${p.pioneerSpotsLeft === 1 ? '' : 's'} left. Pick the monthly or annual plan now and you pay $0.00, every period, with no card needed.</p>
      ${button(planUrl, 'Choose my free plan', '#3E8230')}
    </div>`;
  }
  return `<div style="background:#FFF7E6;border-radius:18px;padding:18px 22px;margin:0 0 20px;">
    <p style="margin:0;font:800 17px ${FONT};color:#92400E;">⭐ One last step: choose your plan</p>
    <p style="margin:6px 0 14px;font:15px/1.55 ${FONT};color:#334155;"><b>${usd(p.monthlyCents)} a month</b>, or <b>${usd(p.annualCents)} a year</b>${saving > 0 ? ` (you save ${usd(saving)})` : ''}.
      No commission on your sales. Plans renew automatically, and you can turn that off any time.</p>
    ${button(planUrl, 'Choose my plan', '#D97706')}
  </div>`;
}

export function welcomeEmail(o: { restaurant: string; kioskUrl: string; androidUrl: string; appleUrl: string; windowsUrl: string; dashboardUrl: string; plan: WelcomePlan }) {
  const r = esc(o.restaurant);
  const planUrl = `${o.dashboardUrl}?tab=plan`;
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
        ${planBox(o.plan, planUrl)}
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:18px;padding:22px 22px 18px;">
          <h2 style="margin:0 0 6px;font:800 19px ${FONT};color:#14284B;">📲 Your restaurant kiosk</h2>
          <p style="margin:0 0 16px;font:15px/1.55 ${FONT};color:#475569;">Put this on the tablet at your counter. It shows new orders with a bell, and staff hand them
            over by typing the customer's PIN. No password needed: the link below is your kiosk's key, so only share it with your staff.</p>
          <p style="margin:0 0 18px;font:14px ${FONT};"><a href="${esc(o.kioskUrl)}" style="color:#2563EB;word-break:break-all;">${esc(o.kioskUrl)}</a></p>
          <p style="margin:0 0 10px;font:700 14px ${FONT};color:#14284B;">Open this email on the tablet or computer and tap your device:</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="33%" style="padding:0 4px 8px 0;">${button(o.androidUrl, '🤖 Android', '#3E8230')}</td>
            <td width="34%" style="padding:0 4px 8px;">${button(o.appleUrl, '📱 iPad / iPhone', '#14284B')}</td>
            <td width="33%" style="padding:0 0 8px 4px;">${button(o.windowsUrl, '🖥️ Windows PC', '#0F6CBD')}</td>
          </tr></table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
            ${step(1, 'The kiosk opens with an install guide for your device.')}
            ${step(2, 'Confirm, and a <b>Bite Wise Kiosk</b> icon appears on the tablet\'s home screen (or in the Start menu and on the desktop on Windows).')}
            ${step(3, 'Open the icon any time to start your kiosk.')}
          </table>
        </div>
        <p style="margin:22px 0 10px;">Next steps: post your first offer, and connect Stripe in the <b>Payouts</b> tab so you're paid at every pickup.</p>
        <div style="padding:6px 0 0;">${button(o.dashboardUrl, 'Open my dashboard', '#14284B')}</div>`,
    }),
    text: `Welcome to Bite Wise, ${o.restaurant}! You're approved and live.
Your electronically signed Restaurant Partner Agreement is attached.
${o.plan.founding ? `You're Pioneer Member #${o.plan.founding}: your subscription is FREE ($0.00 invoices).` : o.plan.hasPlan ? '' : `Choose your plan (${usd(o.plan.monthlyCents)} a month or ${usd(o.plan.annualCents)} a year${o.plan.pioneerSpotsLeft ? `; FREE for the next ${o.plan.pioneerSpotsLeft} Pioneer Members` : ''}): ${planUrl}`}

Your restaurant kiosk (open it on your counter tablet; share it only with your staff):
${o.kioskUrl}
Android tablet: ${o.androidUrl}
iPad / iPhone: ${o.appleUrl}
Windows PC: ${o.windowsUrl}

Dashboard: ${o.dashboardUrl}`,
  };
}

const PLAN_NAMES = { monthly: 'Monthly', annual: 'Annual' } as const;

// The invoice for each plan period (a payment, or a Pioneer Member's free period): plan price, any discount, total.
export function subscriptionReceiptEmail(o: {
  restaurant: string; plan: 'monthly' | 'annual'; amountCents: number; invoiceNumber: string; cardLabel: string; periodStart?: string;
  periodEnd: string; autoRenew: boolean; renewal: boolean; planUrl: string; listPriceCents?: number; discountCents?: number; discountLabel?: string;
  invoiceUrl?: string; taxCents?: number; taxRateBps?: number;
}) {
  const row = (k: string, v: string, strong = false, color?: string) => `<tr><td style="padding:7px 0;color:${color ?? '#64748B'};font:${strong ? '800 15px' : '14px'} ${FONT};">${k}</td><td align="right" style="padding:7px 0;font:${strong ? '800 16px' : '700 14px'} ${FONT};color:${color ?? '#1E293B'};">${v}</td></tr>`;
  const discount = o.discountCents ?? 0;
  const free = o.amountCents === 0 && discount > 0;
  const tax = o.taxCents ?? 0;
  const list = o.listPriceCents ?? o.amountCents + discount - tax;
  const taxLabel = `WA sales tax (${((o.taxRateBps ?? 0) / 100).toFixed(2).replace(/\.?0+$/, '')}%)`;
  const period = `${o.periodStart ? `${date(o.periodStart)} – ` : 'through '}${date(o.periodEnd)}`;
  const next = free ? `Your next free period starts on ${date(o.periodEnd)}` : o.autoRenew ? `Renews automatically on ${date(o.periodEnd)}` : `Ends on ${date(o.periodEnd)} (auto-renewal is off)`;
  return {
    subject: free
      ? `Your Bite Wise invoice ${o.invoiceNumber}: $0.00 (FREE Pioneer membership)`
      : `${o.renewal ? 'Your Bite Wise plan renewed' : 'Your Bite Wise plan is active'}: ${usd(o.amountCents)} (${o.invoiceNumber})`,
    html: layout({
      preview: free ? `${PLAN_NAMES[o.plan]} plan, ${usd(list)} − ${o.discountLabel} = $0.00.` : `${PLAN_NAMES[o.plan]} plan, ${usd(o.amountCents)}. ${next}.`,
      emoji: free ? '🎉' : '🧾',
      title: free ? 'Your subscription is FREE' : o.renewal ? 'Your plan renewed' : 'Your plan is active',
      subtitle: `${esc(o.restaurant)} · ${PLAN_NAMES[o.plan]} plan`,
      body: `<p style="margin:0 0 16px;">${free ? 'Thank you for being a Pioneer Member! Here is your invoice for this period.' : 'Thank you! Here is your receipt.'}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E2E8F0;margin:0 0 4px;">
          ${row('Invoice', esc(o.invoiceNumber))}${row('Period', period)}
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E2E8F0;border-bottom:1px solid #E2E8F0;margin:0 0 18px;">
          ${row(`${PLAN_NAMES[o.plan]} plan`, usd(list))}
          ${discount ? row(esc(o.discountLabel || 'Discount'), `−${usd(discount)}`, false, '#3E8230') : ''}
          ${tax ? `${row('Subtotal', usd(list - discount))}${row(taxLabel, usd(tax))}` : ''}
          ${row(free ? 'Total due' : 'Amount paid', free ? `${usd(0)} <span style="color:#3E8230;">FREE</span>` : usd(o.amountCents), true)}
          ${free ? '' : row('Card', esc(o.cardLabel))}
        </table>
        <p style="margin:0 0 18px;font-size:15px;color:#475569;">${next}.${free ? ' Nothing to pay, and no card needed.' : ' You can change your plan, card or auto-renewal in the Plan tab.'}${o.invoiceUrl ? ' Your invoice is attached as a PDF.' : ''}</p>
        ${o.invoiceUrl ? button(o.invoiceUrl, 'View my invoice', '#14284B') : button(o.planUrl, 'View my plan', '#14284B')}`,
    }),
    text: `Bite Wise invoice ${o.invoiceNumber} for ${o.restaurant} (${period})
${PLAN_NAMES[o.plan]} plan: ${usd(list)}${discount ? `\n${o.discountLabel || 'Discount'}: -${usd(discount)}` : ''}${tax ? `\nSubtotal: ${usd(list - discount)}\n${taxLabel}: ${usd(tax)}` : ''}
${free ? 'Total due: $0.00 (FREE)' : `Amount paid: ${usd(o.amountCents)} with ${o.cardLabel}`}
${next}.
${o.invoiceUrl ? `Your invoice: ${o.invoiceUrl}\n` : ''}Your plan: ${o.planUrl}`,
  };
}

// A subscription payment was declined: the account is delinquent and the restaurant can't post until it pays.
export function paymentFailedEmail(o: { restaurant: string; amountCents: number; error: string; planUrl: string }) {
  return {
    subject: `Your Bite Wise account is delinquent: please renew your plan`,
    html: layout({
      preview: 'Your payment was declined. You can\'t post new offers until your plan is paid.',
      emoji: '⚠️',
      title: 'Your account is now delinquent',
      subtitle: esc(o.restaurant),
      body: `<p style="margin:0 0 14px;">We couldn't charge <b>${usd(o.amountCents)}</b> for your Bite Wise plan${o.error ? `: ${esc(o.error)}` : ''}.</p>
        <p style="margin:0 0 14px;">Your account is now <b>delinquent</b>. Your live offers are paused, and you <b>won't be able to post new offers until the payment is made</b>.</p>
        <p style="margin:0 0 18px;">Renew now with the card on file or another card. As soon as the payment goes through, you can post offers again.</p>
        ${button(o.planUrl, `Renew now: ${usd(o.amountCents)}`, '#D97706')}
        <p style="margin:16px 0 0;font:13px/1.5 ${FONT};color:#64748B;">Renewal link: <a href="${esc(o.planUrl)}" style="color:#2563EB;word-break:break-all;">${esc(o.planUrl)}</a></p>`,
    }),
    text: `Your Bite Wise account (${o.restaurant}) is now delinquent: we couldn't charge ${usd(o.amountCents)}${o.error ? ` (${o.error})` : ''}.
Your offers are paused and you won't be able to post new offers until the payment is made.
Renew now: ${o.planUrl}`,
  };
}

// Sent before a plan renews (30 days ahead for annual plans, 7 for monthly by default): the card on file will be
// charged this amount on this date.
export function renewalReminderEmail(o: { restaurant: string; plan: 'monthly' | 'annual'; amountCents: number; renewsOn: string; cardLabel: string; planUrl: string }) {
  const when = date(o.renewsOn);
  const plan = o.plan === 'annual' ? 'annual' : 'monthly';
  return {
    subject: `Your Bite Wise plan renews on ${when}: ${usd(o.amountCents)} will be charged`,
    html: layout({
      preview: `${usd(o.amountCents)} will be charged to ${o.cardLabel} on ${when}.`,
      emoji: '🔔',
      title: 'Your plan renews soon',
      subtitle: esc(o.restaurant),
      body: `<p style="margin:0 0 16px;">This is a friendly reminder that your Bite Wise ${plan} plan renews automatically on <b>${when}</b>.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:16px;margin:0 0 18px;">
          <tr><td style="padding:16px 20px;font:15px/1.7 ${FONT};color:#334155;">
            <b style="color:#14284B;">Amount:</b> ${usd(o.amountCents)} (including WA sales tax)<br>
            <b style="color:#14284B;">Charged on:</b> ${when}<br>
            <b style="color:#14284B;">Card on file:</b> ${esc(o.cardLabel)}
          </td></tr>
        </table>
        <p style="margin:0 0 18px;">Nothing to do if you'd like to continue. To change your card, switch plans or turn off auto-renewal, open the Plan tab before then.</p>
        ${button(o.planUrl, 'Manage my plan', '#14284B')}`,
    }),
    text: `Your Bite Wise ${plan} plan for ${o.restaurant} renews automatically on ${when}.
Your card on file (${o.cardLabel}) will be charged ${usd(o.amountCents)} (including WA sales tax) on ${when}.
Manage your plan: ${o.planUrl}`,
  };
}

// Announces a change of subscription fees. The subject and message come from an editable template, already filled in.
export function feeChangeEmail(o: {
  subject: string; body: string; effective: string; oldMonthlyCents: number; newMonthlyCents: number; oldAnnualCents: number; newAnnualCents: number; planUrl: string;
}) {
  const paragraphs = o.body.trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const row = (name: string, before: number, after: number) => `<tr>
    <td style="padding:8px 0;font:15px ${FONT};color:#334155;">${name}</td>
    <td align="right" style="padding:8px 0;font:15px ${FONT};color:#94A3B8;text-decoration:line-through;">${usd(before)}</td>
    <td align="right" style="padding:8px 0 8px 14px;font:800 16px ${FONT};color:#14284B;">${usd(after)}</td></tr>`;
  return {
    subject: o.subject,
    html: layout({
      preview: `Subscription fees change on ${o.effective}.`,
      emoji: '📣',
      title: 'Subscription fee update',
      subtitle: `Effective ${esc(o.effective)}`,
      body: `${paragraphs}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:16px;margin:6px 0 18px;">
          <tr><td style="padding:14px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${row('Monthly plan (per month)', o.oldMonthlyCents, o.newMonthlyCents)}
              ${row('Annual plan (per year)', o.oldAnnualCents, o.newAnnualCents)}
            </table>
            <p style="margin:8px 0 0;font:13px ${FONT};color:#64748B;">New prices from ${esc(o.effective)}. Prices exclude Washington sales tax, which is added at your location's rate.</p>
          </td></tr>
        </table>
        ${button(o.planUrl, 'View my plan', '#14284B')}`,
    }),
    text: `${o.body.trim()}

Monthly plan: ${usd(o.oldMonthlyCents)} → ${usd(o.newMonthlyCents)} per month
Annual plan: ${usd(o.oldAnnualCents)} → ${usd(o.newAnnualCents)} per year
New prices from ${o.effective}. Prices exclude Washington sales tax, which is added at your location's rate.

Your plan: ${o.planUrl}`,
  };
}

// A customer's invoice, sent the moment the order is paid (charged at pickup), with the PDF receipt attached.
export function orderInvoiceEmail(rc: Receipt, o: { receiptUrl: string }) {
  const row = (k: string, v: string, o2: { strong?: boolean; color?: string; sub?: string } = {}) =>
    `<tr><td style="padding:7px 0;font:${o2.strong ? '800 15px' : '14px'} ${FONT};color:${o2.color ?? (o2.strong ? '#1E293B' : '#64748B')};">${k}${o2.sub ? `<div style="font:12px ${FONT};color:#94A3B8;">${o2.sub}</div>` : ''}</td>
      <td align="right" valign="top" style="padding:7px 0;font:${o2.strong ? '800 16px' : '700 14px'} ${FONT};color:${o2.color ?? '#1E293B'};">${v}</td></tr>`;
  const it = rc.item;
  const r = rc.restaurant;
  const charged = rc.amountChargedCents;
  const paid = (card: string) => [charged > 0 && `${usd(charged)} on ${card}`, rc.creditAppliedCents > 0 && `${usd(rc.creditAppliedCents)} in Bite Wise credit`].filter(Boolean).join(' + ');
  const paidWith = paid(esc(rc.card));
  return {
    subject: `Your Bite Wise invoice ${rc.receiptNumber}: ${usd(rc.totalCents)} at ${r.name}`,
    html: layout({
      preview: `Paid ${usd(rc.totalCents)} for ${it.quantity} × ${it.title}. You saved ${usd(it.savingsCents)}.`,
      emoji: '🧾',
      title: 'Thanks for rescuing food!',
      subtitle: `${esc(r.name)} · Order #${rc.orderId}`,
      body: `<p style="margin:0 0 16px;">Here is your invoice for the order you picked up${rc.pickedUpAtText ? ` on ${esc(rc.pickedUpAtText)}` : ''}.${it.savingsCents > 0 ? ` You saved <b style="color:#3E8230;">${usd(it.savingsCents)}</b> and kept good food from going to waste. 💚` : ''}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E2E8F0;margin:0 0 4px;">
          ${row('Invoice', esc(rc.receiptNumber))}
          ${row('Restaurant', esc(r.name), { sub: `${esc(r.address)}, ${esc(r.city)} ${esc(r.zip)}` })}
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #E2E8F0;border-bottom:1px solid #E2E8F0;margin:0 0 18px;">
          ${row(`${it.quantity} × ${esc(it.title)}`, usd(it.lineOriginalCents), { sub: `${usd(it.originalUnitCents)} each` })}
          ${it.savingsCents > 0 ? row(`Bite Wise discount (${it.discountPct}% off)`, `−${usd(it.savingsCents)}`, { color: '#3E8230' }) : ''}
          ${row('Subtotal', usd(rc.subtotalCents))}
          ${rc.serviceFeeCents ? row(`Service fee (${rc.serviceFeePct}%)`, usd(rc.serviceFeeCents)) : ''}
          ${row(`Sales tax (${(rc.taxRateBps / 100).toFixed(2).replace(/\.?0+$/, '')}%)`, usd(rc.taxCents))}
          ${row('Total paid', usd(rc.totalCents), { strong: true })}
          ${paidWith ? row('Paid with', paidWith) : ''}
        </table>
        <p style="margin:0 0 18px;font-size:14px;color:#475569;">Your receipt is attached as a PDF. You can also view or print it any time:</p>
        ${button(o.receiptUrl, 'View my receipt', '#14284B')}`,
    }),
    text: `Bite Wise invoice ${rc.receiptNumber} (order #${rc.orderId})
${r.name}, ${r.address}, ${r.city} ${r.zip}

${it.quantity} x ${it.title}: ${usd(it.lineOriginalCents)}${it.savingsCents > 0 ? `\nBite Wise discount (${it.discountPct}% off): -${usd(it.savingsCents)}` : ''}
Subtotal: ${usd(rc.subtotalCents)}${rc.serviceFeeCents ? `\nService fee (${rc.serviceFeePct}%): ${usd(rc.serviceFeeCents)}` : ''}
Sales tax: ${usd(rc.taxCents)}
Total paid: ${usd(rc.totalCents)}${paidWith ? `\nPaid with: ${paid(rc.card)}` : ''}

Your receipt: ${o.receiptUrl}`,
  };
}

// ---------------------------------------------------------------- missed pickups (src/lib/no-shows.ts)

const box = (html: string, color = '#FEF3C7', border = '#FCD34D') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${color};border:1px solid ${border};border-radius:14px;margin:0 0 18px;"><tr><td style="padding:14px 18px;font:15px/1.55 ${FONT};color:#1E293B;">${html}</td></tr></table>`;

// A customer missed a pickup: how many in a row, and what happens next.
export function noShowWarningEmail(o: { username: string; orderId: number; item: string; restaurant: string; strikes: number; limit: number; probation: boolean; ordersUrl: string }) {
  const left = Math.max(0, o.limit - o.strikes);
  const next = o.probation
    ? '<b>Your account was suspended before for missed pickups, so the next missed pickup will close your account permanently.</b>'
    : left === 1
      ? `<b>One more missed pickup in a row and your account will be suspended for 30 days.</b>`
      : `If you miss ${left} more pickups in a row, your account will be suspended for 30 days.`;
  return {
    subject: `You missed your Bite Wise pickup (order #${o.orderId})`,
    html: layout({
      preview: `Order #${o.orderId} at ${o.restaurant} wasn't picked up. You were not charged.`,
      emoji: '⏰',
      title: 'You missed your pickup',
      subtitle: `Order #${o.orderId} · ${esc(o.restaurant)}`,
      body: `<p style="margin:0 0 14px;">Hi ${esc(o.username)}, your order of <b>${esc(o.item)}</b> at <b>${esc(o.restaurant)}</b> wasn't picked up before the
        discard timer ran out. You were not charged, but the food couldn't be sold to anyone else and went to waste.</p>
        ${box(`${o.probation ? '' : `Missed pickups in a row: <b>${o.strikes} of ${o.limit}</b>.<br>`}${next}`)}
        <p style="margin:0 0 18px;font-size:15px;color:#475569;">Can't make it? Cancel the order from My Orders before the timer ends: it's free, and the food goes back on sale. A pickup resets the count.</p>
        ${button(o.ordersUrl, 'My orders', '#14284B')}`,
    }),
    text: `Hi ${o.username}, your order #${o.orderId} (${o.item}) at ${o.restaurant} wasn't picked up before the discard timer ran out. You were not charged, but the food went to waste.
${o.probation ? '' : `Missed pickups in a row: ${o.strikes} of ${o.limit}.\n`}${next.replace(/<[^>]+>/g, '')}
Can't make it? Cancel from My Orders before the timer ends: it's free. A pickup resets the count.
${o.ordersUrl}`,
  };
}

export function noShowSuspendedEmail(o: { username: string; strikes: number; days: number; until: string }) {
  return {
    subject: `Your Bite Wise account is suspended for ${o.days} days`,
    html: layout({
      preview: `${o.strikes} missed pickups in a row: suspended until ${date(o.until)}.`,
      emoji: '⏸️',
      title: `Account suspended for ${o.days} days`,
      subtitle: `Until ${date(o.until)}`,
      body: `<p style="margin:0 0 14px;">Hi ${esc(o.username)}, you missed <b>${o.strikes} pickups in a row</b>. Each time, the food was held for you and then had
        to be thrown away. As our Customer Terms (Section 5.4) explain, your account has been <b>suspended automatically for ${o.days} days</b>, until
        <b>${date(o.until)}</b>. Any open orders were cancelled without charge.</p>
        ${box('<b>When the suspension ends, your account is reactivated automatically.</b> After that, the first missed pickup closes your account permanently.', '#FEE2E2', '#FCA5A5')}
        <p style="margin:0;font-size:15px;color:#475569;">If you think this is a mistake, reply to this email or write to <a href="mailto:${esc(serverEnv.legal.email)}">${esc(serverEnv.legal.email)}</a>.</p>`,
    }),
    text: `Hi ${o.username}, you missed ${o.strikes} pickups in a row, so your Bite Wise account is suspended automatically for ${o.days} days, until ${date(o.until)} (Customer Terms, Section 5.4). Open orders were cancelled without charge.
When the suspension ends, your account is reactivated automatically. After that, the first missed pickup closes your account permanently.
Questions: ${serverEnv.legal.email}`,
  };
}

export function noShowBannedEmail(o: { username: string }) {
  return {
    subject: 'Your Bite Wise account has been closed',
    html: layout({
      preview: 'Another missed pickup after a suspension: your account is closed permanently.',
      emoji: '🚫',
      title: 'Your account has been closed',
      subtitle: 'Missed pickup after a suspension',
      body: `<p style="margin:0 0 14px;">Hi ${esc(o.username)}, your account was suspended earlier for missed pickups, and you have missed another one. As our
        Customer Terms (Section 5.4) explain, your Bite Wise account has been <b>closed permanently</b>. Any open orders were cancelled without
        charge, and this email address can't be used to open a new account.</p>
        <p style="margin:0;font-size:15px;color:#475569;">If you think this is a mistake, write to <a href="mailto:${esc(serverEnv.legal.email)}">${esc(serverEnv.legal.email)}</a>.</p>`,
    }),
    text: `Hi ${o.username}, your account was suspended earlier for missed pickups and you have missed another one, so your Bite Wise account has been closed permanently (Customer Terms, Section 5.4). Open orders were cancelled without charge.
Questions: ${serverEnv.legal.email}`,
  };
}

// Tells the admins the platform suspended or banned a customer.
export function adminAlertEmail(o: { title: string; message: string; customer: string; email: string; noShowsTotal: number; consoleUrl: string }) {
  return {
    subject: `Bite Wise alert: ${o.title}`,
    html: layout({
      preview: o.message,
      emoji: '🚨',
      title: o.title,
      subtitle: `${esc(o.customer)} · ${esc(o.email)}`,
      body: `<p style="margin:0 0 14px;">${esc(o.message)}</p>
        ${box(`Missed pickups in total: <b>${o.noShowsTotal}</b>. This was done automatically by the platform; you can review it, or lift it, in the owner console.`)}
        ${button(o.consoleUrl, 'Open alerts', '#14284B')}`,
    }),
    text: `${o.title}\n${o.message}\nCustomer: ${o.customer} (${o.email}). Missed pickups in total: ${o.noShowsTotal}.\nDone automatically by the platform. Review it in the owner console: ${o.consoleUrl}`,
  };
}
