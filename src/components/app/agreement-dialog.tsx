'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { Spinner } from '@/components/ui/misc';
import type { LegalDocument } from '@/lib/legal/documents';
import { cn } from '@/lib/utils';
import { LegalProse } from './legal-prose';

type Props = {
  open: boolean;
  role: 'customer' | 'restaurant';
  // Which country's terms: the person's (or the restaurant's) country.
  country?: 'US' | 'CA';
  title: string;
  intro: string;
  acceptLabel?: string;
  declineLabel?: string;
  busy?: boolean;
  // Accepted: { docId: version } for every document shown. Declined or closed: null.
  onResult: (accepted: Record<string, string> | null) => void;
};

// Shows the legal documents for a role. The "I agree" box unlocks once the text is scrolled to the end.
export function AgreementDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && !props.busy && props.onResult(null)}>
      {/* Mounted only while open, so scroll/agree state starts fresh every time. */}
      {props.open && <AgreementContent {...props} />}
    </Dialog>
  );
}

function AgreementContent({ role, country = 'US', title, intro, acceptLabel = 'Accept', declineLabel = 'Decline', busy, onResult }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['legal', role, country],
    queryFn: async () => (await (await fetch(`/api/legal?role=${role}&country=${country}`)).json()) as { documents: LegalDocument[] },
    staleTime: Infinity,
  });
  const docs = data?.documents ?? [];
  const box = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const [agree, setAgree] = useState(false);
  const [tab, setTab] = useState(0);

  const onScroll = () => {
    const el = box.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setAtEnd(true);
  };
  // Short documents may fit without scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el || !docs.length) return;
    const fits = el.scrollHeight <= el.clientHeight + 24;
    if (fits) setAtEnd(true);
  }, [docs.length]);

  const names = docs.map((d) => d.title).join(' and ');
  return (
    <DialogContent title={title} className="w-[min(860px,calc(100%-24px))]" onInteractOutside={(e) => e.preventDefault()}>
      <p className="-mt-1 mb-3 text-sm text-muted">{intro}</p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {docs.map((d, i) => (
          <button
            key={d.id}
            type="button"
            onClick={() => {
              setTab(i);
              const section = box.current?.querySelector<HTMLElement>(`#doc-${d.id}`);
              if (section && box.current) box.current.scrollTo({ top: section.offsetTop - box.current.offsetTop, behavior: 'smooth' });
            }}
            className={cn('rounded-full px-3 py-1.5 text-sm font-bold', tab === i ? 'bg-primary-soft text-primary-ink' : 'text-muted hover:text-ink')}
          >
            {d.title}
          </button>
        ))}
        <span className="flex-1" />
        {docs.map((d) => (
          <a key={d.id} href={`/legal/${d.id}`} target="_blank" rel="noopener" className="text-xs text-muted">Open {d.title} ↗</a>
        ))}
      </div>
      <div
        ref={box}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Agreement text"
        className="h-[46vh] overflow-y-auto rounded-xl border border-line bg-white"
      >
        {isLoading && <div className="grid h-full place-items-center"><Spinner /></div>}
        {docs.map((d) => (
          <section key={d.id} id={`doc-${d.id}`} className="border-b-8 border-[#e3eae6] px-6 pt-6 pb-2 text-[#0b1b14] last:border-0">
            <h1 className="mb-1 text-2xl font-extrabold">{d.title}</h1>
            <div className="mb-3 text-xs text-[#6b7b73]">Effective {d.effective} · Version {d.version}</div>
            <LegalProse html={d.html} />
          </section>
        ))}
      </div>
      <div className={cn('mt-2 text-xs', atEnd ? 'text-primary-ink' : 'text-accent-ink')}>
        {atEnd ? '✓ You have reached the end' : '↓ Scroll to the end to continue'}
      </div>
      <Checkbox
        className="mt-3"
        disabled={!atEnd}
        checked={agree}
        onChange={(e) => setAgree(e.target.checked)}
        label={`I have read and agree to the ${names}. I understand this is a legally binding agreement.`}
      />
      <div className="mt-4 flex justify-end gap-3">
        <Button variant="danger" type="button" disabled={busy} onClick={() => onResult(null)}>{declineLabel}</Button>
        <Button
          type="button"
          disabled={!agree || !docs.length || busy}
          onClick={() => onResult(Object.fromEntries(docs.map((d) => [d.id, d.version])))}
        >
          {busy ? 'Please wait…' : acceptLabel}
        </Button>
      </div>
    </DialogContent>
  );
}
