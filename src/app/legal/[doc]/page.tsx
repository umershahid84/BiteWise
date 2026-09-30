import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LegalProse } from '@/components/app/legal-prose';
import { PrintButton } from '@/components/app/print-button';
import { buttonVariants } from '@/components/ui/button';
import { Paper } from '@/components/ui/card';
import { legalDocument } from '@/lib/legal/company';
import { DOCUMENTS } from '@/lib/legal/documents';
import { cn } from '@/lib/utils';

export async function generateMetadata({ params }: PageProps<'/legal/[doc]'>): Promise<Metadata> {
  const { doc } = await params;
  return { title: DOCUMENTS[doc as keyof typeof DOCUMENTS]?.title ?? 'Legal' };
}

const NAV = [['customer-terms', 'Customer Terms'], ['restaurant-agreement', 'Restaurant Partner Agreement'], ['privacy', 'Privacy Policy']];

export default async function LegalPage({ params }: PageProps<'/legal/[doc]'>) {
  const { doc: id } = await params;
  const doc = await legalDocument(id);
  if (!doc) notFound();
  return (
    <main className="container-page max-w-[860px] py-8">
      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        {NAV.map(([key, label]) => (
          <Link key={key} href={`/legal/${key}`} className={cn(buttonVariants({ size: 'sm', variant: key === doc.id ? 'primary' : 'ghost' }))}>
            {label}
          </Link>
        ))}
        <span className="flex-1" />
        <PrintButton />
      </div>
      <Paper>
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e3eae6] pb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="Rescue Bites" className="h-11" />
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
