'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { applyLook, saveModePref, savedModePref, type ModePref, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ModePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match my device', icon: Monitor },
];

// Light or dark mode for every part of the site, remembered in this browser. Until someone chooses, each part keeps
// its own default (light for customers and the admin team, dark for restaurants).
export function ModeToggle() {
  const [pref, setPref] = useState<ModePref | null>(null);
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () => setMode(document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the browser's saved choice once
    setPref(savedModePref());
    read();
    const watch = new MutationObserver(read);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const choose = (p: ModePref) => {
    saveModePref(p);
    setPref(p);
    applyLook(document.documentElement.dataset.theme as Theme, p);
    setOpen(false);
  };
  const Icon = mode === 'dark' ? Moon : Sun;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={`Appearance: ${mode} mode`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Light or dark mode"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <Icon className="size-[18px]" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-[600] mt-2 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          {OPTIONS.map(({ value, label, icon: I }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={pref === value}
              onClick={() => choose(value)}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink', pref === value && 'text-ink')}
            >
              <I className="size-4" /> <span className="flex-1">{label}</span> {pref === value && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
