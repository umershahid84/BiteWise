'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { applyLook, type Theme, savedModePref, themeForPath } from '@/lib/theme';

// The root layout sets the theme for the first page; this keeps it right when moving between parts of the site
// without a full page load (the root layout doesn't render again then). It leaves the first page alone, where the
// server already chose (and the log-in / sign-up slider may have changed it).
export function ThemeSync() {
  const path = usePathname();
  const first = useRef(path);
  useEffect(() => {
    if (path === first.current) return;
    first.current = path;
    applyLook(themeForPath(path));
  }, [path]);
  // "Match my device": follow the device when it switches between light and dark.
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (savedModePref() === 'system') applyLook(document.documentElement.dataset.theme as Theme);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return null;
}
