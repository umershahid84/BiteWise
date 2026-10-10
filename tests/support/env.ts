import { config } from 'dotenv';

// Integration tests use the local Supabase started by `npm run db:start` (keys in .env.local).
config({ path: '.env.local', quiet: true });

// Sales tax rates stay as the tests set them (no lookups over the internet).
process.env.TAX_LOOKUP ??= 'off';
// The menu import's hidden browser stays off unless a test turns it on.
process.env.MENU_IMPORT_BROWSER ??= 'off';
