import { config } from 'dotenv';

// Integration tests use the local Supabase started by `npm run db:start` (keys in .env.local).
config({ path: '.env.local', quiet: true });

// Sales tax rates stay as the tests set them (no lookups over the internet).
process.env.TAX_LOOKUP ??= 'off';
