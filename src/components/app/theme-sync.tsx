'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { themeForPath } from '@/lib/theme';

// The root layout sets the theme for the first page; this keeps it right when moving between parts of the site
// without a full page load (the root layout doesn't render again then).
export function ThemeSync() {
  const path = usePathname();
  useEffect(() => {
    document.documentElement.dataset.theme = themeForPath(path);
  }, [path]);
  return null;
}
