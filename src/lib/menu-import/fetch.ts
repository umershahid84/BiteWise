import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '@/lib/errors';

// Fetches a page or picture from the internet for the menu import, safely: only http(s) on the standard ports,
// never addresses inside our own network (localhost, private ranges, cloud metadata), at most 3 redirects (each
// checked again), a time limit and a size limit.

const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

function privateV4(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function privateV6(ip: string) {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  if (x.startsWith('::ffff:')) return privateV4(x.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
}
export const isPrivateAddress = (ip: string) => (isIP(ip) === 6 ? privateV6(ip) : privateV4(ip));

async function checkUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'Please enter a full web address, like https://www.myrestaurant.com/menu');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new AppError(400, 'Only http and https web addresses can be imported.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new AppError(400, 'That web address can\'t be imported.');
  if (url.username || url.password) throw new AppError(400, 'That web address can\'t be imported.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new AppError(400, `We couldn't find the website ${host}. Check the address.`);
  if (addresses.some(isPrivateAddress)) throw new AppError(400, 'That web address can\'t be imported.');
  return url;
}

export async function safeFetch(raw: string, o: { maxBytes: number; accept: string }): Promise<{ url: string; type: string; body: Buffer }> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await checkUrl(current);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: o.accept, 'User-Agent': 'Mozilla/5.0 (compatible; BiteWiseMenuImport/1.0)' },
      });
    } catch {
      throw new AppError(502, `We couldn't open ${url.hostname}. Check the address, or try again in a minute.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, url).toString();
      continue;
    }
    if (!res.ok) throw new AppError(502, `${url.hostname} answered with an error (${res.status}).`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > o.maxBytes) throw new AppError(413, 'That page or file is too large to import.');
    // Read at most maxBytes.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > o.maxBytes) {
        await reader.cancel();
        throw new AppError(413, 'That page or file is too large to import.');
      }
      chunks.push(value);
    }
    return { url: url.toString(), type: res.headers.get('content-type') ?? '', body: Buffer.concat(chunks) };
  }
  throw new AppError(400, 'That web address redirects too many times.');
}
