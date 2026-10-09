import 'server-only';
import { randomBytes } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Food photos in the public food-photos bucket (menu items, offers).
export const MAX_PHOTO = 3 * 1024 * 1024;

// Only JPEG, PNG or WebP, checked by file signature (not just the name or declared type).
export function detectImage(buf: Buffer): { ext: string; type: string } | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

// Saves a photo for a restaurant and returns its public URL.
export async function storePhoto(restaurantId: number, buf: Buffer) {
  if (buf.length > MAX_PHOTO) throw new AppError(400, 'Photo is too large (max 3 MB).');
  const kind = detectImage(buf);
  if (!kind) throw new AppError(400, 'Please choose a JPEG, PNG or WebP photo.');
  const path = `${restaurantId}/${randomBytes(12).toString('hex')}.${kind.ext}`;
  const storage = supabaseAdmin().storage.from('food-photos');
  const { error } = await storage.upload(path, buf, { contentType: kind.type, cacheControl: '31536000', upsert: false });
  if (error) throw new AppError(500, 'Could not save the photo. Please try again.');
  return storage.getPublicUrl(path).data.publicUrl;
}
