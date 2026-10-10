'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { themeForPath } from '@/lib/theme';

// The root layout sets the theme for the first page; this keeps it right when moving between parts of the site
// without a full page load (the root layout doesn't render again then). It leaves the first page alone, where the
// server already chose (and the log-in / sign-up slider may have changed it).
export function ThemeSync() {
  const path = usePathname();
  const first = useRef(path);
  useEffect(() => {
    if (path === first.current) return;
    first.current = path;
    document.documentElement.dataset.theme = themeForPath(path);
  }, [path]);
  return null;
}
