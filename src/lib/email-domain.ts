import 'server-only';
import { resolveMx, resolve4, resolve6 } from 'node:dns/promises';

// Checks that a sign-up email address belongs to a real mail domain:
//   1. not a throwaway ("disposable") inbox service,
//   2. not a reserved or test domain (example.com, *.test, *.local, ...),
//   3. the domain exists and accepts mail: it has MX records (or, as the email standard allows, an address record).
// A DNS lookup that times out doesn't block anyone: only a definite "this domain doesn't exist or takes no mail" does.

// Throwaway inbox services. Lowercase; subdomains are matched too (e.g. anything.mailinator.com).
const DISPOSABLE = new Set(`
10minutemail.com 10minutemail.net 10minutemail.co.uk 10minemail.com 20minutemail.com 33mail.com
anonbox.net anonymbox.com armyspy.com binkmail.com bobmail.info bugmenot.com burnermail.io byom.de
chacuo.net cool.fr.nf correo.blogos.net crazymailing.com cuvox.de dayrep.com deadaddress.com discard.email
discardmail.com discardmail.de disposableaddress.com disposableemailaddresses.com disposableinbox.com dispostable.com
dodgeit.com dodgit.com dropmail.me dudmail.com e4ward.com emailondeck.com emailfake.com emailtemporanea.com
emailtemporanea.net emailtemporar.ro emailwarden.com emltmp.com fakeinbox.com fakemail.net fakemailgenerator.com
fastacura.com fleckens.hu getairmail.com getnada.com gishpuppy.com guerrillamail.biz guerrillamail.com
guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org guerrillamailblock.com gustr.com
harakirimail.com hidemail.de hmamail.com hulapla.de inboxalias.com inboxbear.com incognitomail.com incognitomail.org
instant-mail.de jetable.com jetable.fr.nf jetable.net jetable.org jourrapide.com kasmail.com killmail.com
klzlk.com koszmail.pl kurzepost.de linshiyouxiang.net lroid.com mail-temporaire.fr mail.tm mail7.io
mailcatch.com maildrop.cc mailexpire.com mailforspam.com mailfreeonline.com mailimate.com mailinator.com
mailinator.net mailinator.org mailinator2.com mailmetrash.com mailmoat.com mailnesia.com mailnull.com
mailpoof.com mailsac.com mailshell.com mailtemp.info mailtothis.com meltmail.com mintemail.com moakt.com
mohmal.com mt2014.com mt2015.com mvrht.com mytemp.email mytrashmail.com nada.email nada.ltd neverbox.com
no-spam.ws nobulk.com noclickemail.com nogmailspam.info nomail.xl.cx nowmymail.com objectmail.com
obobbo.com one-time.email onewaymail.com opayq.com owlpic.com pookmail.com proxymail.eu punkass.com
putthisinyourspamdatabase.com quickinbox.com rcpt.at receiveee.com rhyta.com rmqkr.net s0ny.net
safetymail.info sharklasers.com shieldemail.com shortmail.net sneakemail.com sofimail.com sogetthis.com
spam.la spam4.me spamavert.com spambob.com spambog.com spambox.us spamcero.com spamday.com spamex.com
spamfree24.org spamgourmet.com spamhole.com spamify.com spaml.com spammotel.com spamobox.com spamspot.com
spamthis.co.uk spamthisplease.com supergreatmail.com superrito.com suremail.info teleworm.us temp-mail.io
temp-mail.org temp-mail.ru tempail.com tempemail.co tempemail.com tempemail.net tempinbox.co.uk tempinbox.com
tempmail.de tempmail.dev tempmail.net tempmail.plus tempmailaddress.com tempmailo.com tempomail.fr
temporarily.de temporaryemail.net temporaryinbox.com tempr.email tempsky.com thankyou2010.com thisisnotmyrealemail.com
throwam.com throwawayemailaddress.com throwawaymail.com tmail.ws tmailinator.com tmpmail.net tmpmail.org
trash-mail.at trash-mail.com trash-mail.de trash2009.com trashdevil.com trashemail.de trashmail.at
trashmail.com trashmail.de trashmail.io trashmail.me trashmail.net trashmail.org trashmail.ws trashmailer.com
trashymail.com trbvm.com trialmail.de tyldd.com uggsrock.com upliftnow.com uroid.com veryrealemail.com
vomoto.com wegwerfemail.de wegwerfmail.de wegwerfmail.net wegwerfmail.org wh4f.org yepmail.net
yopmail.com yopmail.fr yopmail.net you-spam.com zetmail.com zippymail.info zoemail.org
`.split(/\s+/).filter(Boolean));

// Reserved for documentation and testing (RFC 2606, RFC 6761) or local networks: never real inboxes.
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost', 'local', 'internal', 'lan', 'home', 'corp', 'onion']);
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);

export type EmailCheck = { ok: true } | { ok: false; reason: string };

const parentDomains = (domain: string) => domain.split('.').map((_, i, parts) => parts.slice(i).join('.')).slice(0, -1);

export function isDisposable(domain: string) {
  return parentDomains(domain.toLowerCase()).some((d) => DISPOSABLE.has(d));
}

type Dns = { mx: typeof resolveMx; a: typeof resolve4; aaaa: typeof resolve6 };
const systemDns: Dns = { mx: resolveMx, a: resolve4, aaaa: resolve6 };

const NO_DOMAIN = new Set(['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN', 'EBADNAME']);

// Resolves to true / false, or null when DNS couldn't give an answer (timeout, no network).
async function lookup(fn: () => Promise<unknown[]>) {
  try {
    return (await fn()).length > 0;
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    return NO_DOMAIN.has(code) ? false : null;
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms).unref?.())]);

export async function checkEmailDomain(email: string, dns: Dns = systemDns): Promise<EmailCheck> {
  const domain = email.split('@').pop()?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  const invalid = { ok: false as const, reason: 'Please use a real email address: we couldn\'t find that email domain.' };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return invalid;
  if (isDisposable(domain)) {
    return { ok: false, reason: 'Temporary or disposable email addresses can\'t be used. Please use your personal or work email.' };
  }
  const tld = domain.split('.').at(-1)!;
  if (RESERVED_TLDS.has(tld) || RESERVED_DOMAINS.has(domain) || /^\d+$/.test(tld)) return invalid;

  return withTimeout((async (): Promise<EmailCheck> => {
    try {
      const mx = await dns.mx(domain);
      // A "null MX" (RFC 7505: a single record with an empty exchange) means the domain accepts no email.
      if (mx.length && mx.every((r) => !r.exchange || r.exchange === '.')) return invalid;
      if (mx.length) return { ok: true };
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (!NO_DOMAIN.has(code)) return { ok: true }; // DNS trouble on our side: don't block the sign-up
    }
    // No MX records: mail goes to the domain's own address, if it has one.
    const [a, aaaa] = await Promise.all([lookup(() => dns.a(domain)), lookup(() => dns.aaaa(domain))]);
    if (a || aaaa) return { ok: true };
    if (a === null && aaaa === null) return { ok: true };
    return invalid;
  })(), 5000, { ok: true });
}
