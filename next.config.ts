import path from 'node:path';
import type { NextConfig } from 'next';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

// Extra hosts allowed to call Server Actions (log in, checkout, ...) when the app is reached through a
// proxy or tunnel, e.g. "*.devtunnels.ms,localhost:3000". Next.js rejects other cross-origin calls (CSRF).
const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const nextConfig: NextConfig = {
  // scripts/server/update.sh builds into a separate folder while the live site keeps running from .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // This folder is the app: without this, Next.js looks for the workspace root higher up and warns when it finds a
  // stray package-lock.json there (e.g. in the Windows user folder).
  outputFileTracingRoot: path.resolve(import.meta.dirname),
  // pdfkit reads its font metrics from disk, so it must not be bundled.
  serverExternalPackages: ['pdfkit', 'nodemailer'],
  // Fonts and logos for PDFs (receipts, reports, agreements) and emails are read at runtime.
  outputFileTracingIncludes: {
    '/**/*': ['./assets/pdf-fonts/**/*', './public/assets/logo.png', './public/assets/email-logo.png'],
  },
  images: {
    remotePatterns: [new URL(`${supabaseUrl}/storage/v1/object/public/**`)],
  },
  // Let `next dev` serve its live-reload connection to the same trusted hosts.
  allowedDevOrigins: trustedOrigins,
  experimental: {
    // Menu photos are resized in the browser, but allow some headroom for the upload action.
    serverActions: { bodySizeLimit: '5mb', allowedOrigins: trustedOrigins },
  },
};

export default nextConfig;
