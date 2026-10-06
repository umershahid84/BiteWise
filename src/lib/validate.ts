import { z } from 'zod';
import { formatPhoneInput, phoneDigits } from '@/lib/phone';
import { DIETARY_TAGS } from '@/lib/constants';
import { AppError } from '@/lib/errors';

// Parses input with a zod schema and throws a 400 AppError with the first problem's message.
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const res = schema.safeParse(input);
  if (!res.success) throw new AppError(400, res.error.issues[0]?.message ?? 'Invalid input.');
  return res.data;
}

const text = (field: string, min: number, max: number) =>
  z.string({ error: `${field} is required.` }).trim()
    .min(Math.max(min, 1), min > 1 ? `${field} must be at least ${min} characters.` : `${field} is required.`)
    .max(max, `${field} must be at most ${max} characters.`);

const optionalText = (field: string, max: number) =>
  z.string().trim().max(max, `${field} must be at most ${max} characters.`).optional().default('');

export const emailSchema = z.string({ error: 'Email is required.' }).trim().toLowerCase().max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Please enter a valid email address.');

export const usernameSchema = z.string({ error: 'User name is required.' }).trim()
  .regex(/^[A-Za-z0-9_.]{3,24}$/, 'User name must be 3-24 characters: letters, numbers, dots or underscores.');

export const passwordSchema = z.string({ error: 'Password is required.' })
  .min(8, 'Password must be at least 8 characters.')
  .max(200, 'Password is too long.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must include at least one letter and one number.');

export const zipSchema = z.string({ error: 'ZIP code is required.' }).trim().regex(/^\d{5}(-\d{4})?$/, 'Please enter a valid ZIP code.');

const coord = (limit: number) =>
  z.union([z.number(), z.string()]).optional().nullable()
    .transform((v) => (v === undefined || v === null || v === '' ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && Math.abs(v) <= limit), 'Location is invalid.');

export const restaurantFieldsSchema = z.object({
  name: text('Restaurant name', 2, 80),
  address: text('Street address', 3, 120),
  city: text('City', 2, 60),
  zip: zipSchema,
  // Optional; when given, a 10-digit US number, stored as (xxx) xxx-xxxx.
  phone: z.string().trim().max(30).optional().default('')
    .refine((v) => !v || phoneDigits(v).length === 10, 'Enter a 10-digit phone number, like (206) 555-0123.')
    .transform((v) => (v ? formatPhoneInput(v) : '')),
  cuisine: optionalText('Cuisine', 40),
  lat: coord(90),
  lng: coord(180),
});

export const signupSchema = z.object({
  role: z.enum(['customer', 'restaurant']).default('customer'),
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  restaurant: restaurantFieldsSchema.optional(),
  acceptedTerms: z.record(z.string(), z.string()).optional(),
});

export const restaurantProfileSchema = restaurantFieldsSchema.extend({
  description: optionalText('Description', 400),
  taxRatePct: z.coerce.number({ error: 'Sales tax rate must be between 0% and 20%.' })
    .min(0, 'Sales tax rate must be between 0% and 20%.').max(20, 'Sales tax rate must be between 0% and 20%.'),
});

export const dollars = (field: string, min: number, max: number) =>
  z.union([z.string(), z.number()])
    .transform((v) => Number(String(v).replace(/[$,\s]/g, '')))
    .refine((n) => Number.isFinite(n) && n >= min && n <= max, `${field} must be between $${min.toFixed(2)} and $${max.toFixed(2)}.`)
    .transform((n) => Math.round(n * 100));

export const menuItemSchema = z.object({
  name: text('Item name', 2, 80),
  description: optionalText('Description', 500),
  price: dollars('Menu price', 0.5, 1000),
  dietary: z.array(z.enum(DIETARY_TAGS, { error: 'Unknown dietary tag.' })).default([]),
});

export const int = (field: string, min: number, max: number) =>
  z.coerce.number({ error: `${field} must be a whole number from ${min} to ${max}.` })
    .int(`${field} must be a whole number from ${min} to ${max}.`)
    .min(min, `${field} must be a whole number from ${min} to ${max}.`)
    .max(max, `${field} must be a whole number from ${min} to ${max}.`);

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a valid date.')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Please choose a valid date.');
