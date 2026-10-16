import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LegalProse } from '@/components/app/legal-prose';
import { PrintButton } from '@/components/app/print-button';
import { buttonVariants } from '@/components/ui/button';
import { Paper } from '@/components/ui/card';
import { legalDocument } from '@/lib/legal/company';
import { COUNTERPART, DOCUMENTS, type DocumentId } from '@/lib/legal/documents';
import { cn } from '@/lib/utils';

export async function generateMetadata({ params }: PageProps<'/legal/[doc]'>): Promise<Metadata> {
  const { doc } = await params;
  return { title: DOCUMENTS[doc as keyof typeof DOCUMENTS]?.title ?? 'Legal' };
}

const NAV = [['customer-terms', 'Customer Terms'], ['restaurant-agreement', 'Restaurant Partner Agreement'], ['privacy', 'Privacy Policy']];
const suffix = (country: 'US' | 'CA') => (country === 'CA' ? '-ca' : '');

export default async function LegalPage({ params }: PageProps<'/legal/[doc]'>) {
  const { doc: id } = await params;
  const doc = await legalDocument(id);
  if (!doc) notFound();
  return (
    <main className="container-page max-w-[860px] py-8">
      {/* The United States and Canada each have their own set of documents. */}
      <div className="no-print mb-3 inline-flex rounded-full border border-line bg-surface p-1">
        {(['US', 'CA'] as const).map((c) => (
          <Link key={c} href={`/legal/${c === doc.country ? doc.id : COUNTERPART[doc.id as DocumentId]}`}
            className={cn('rounded-full px-4 py-1.5 text-sm font-bold no-underline', c === doc.country ? 'bg-primary-soft text-primary-ink' : 'text-muted hover:text-ink')}>
            {c === 'US' ? 'United States' : 'Canada'}
          </Link>
        ))}
      </div>
      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        {NAV.map(([key, label]) => (
          <Link key={key} href={`/legal/${key}${suffix(doc.country)}`} className={cn(buttonVariants({ size: 'sm', variant: `${key}${suffix(doc.country)}` === doc.id ? 'primary' : 'ghost' }))}>
            {label}
          </Link>
        ))}
        <span className="flex-1" />
        <PrintButton />
      </div>
      <Paper>
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e3eae6] pb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="ResDish" className="h-14" />
          <div className="text-right">
            <h1 className="m-0 text-2xl font-extrabold">{doc.title}</h1>
            <div className="text-sm text-[#6b7b73]">Effective {doc.effective} · Version {doc.version}</div>
          </div>
        </div>
        <LegalProse html={doc.html} />
      </Paper>
    </main>
  );
}
