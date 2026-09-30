'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { acceptUpdatedTerms, signOut } from '@/app/actions/auth';
import { AgreementDialog } from './agreement-dialog';

// Existing users must accept updated terms before continuing; declining signs them out.
export function TermsGate({ role }: { role: 'customer' | 'restaurant' }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [busy, start] = useTransition();
  return (
    <AgreementDialog
      open={open}
      role={role}
      title="Our terms have been updated"
      intro="Please review and accept the updated terms to keep using Rescue Bites. If you decline, you will be signed out."
      acceptLabel="Accept & continue"
      declineLabel="Decline & sign out"
      busy={busy}
      onResult={(accepted) =>
        start(async () => {
          if (!accepted) {
            setOpen(false);
            await signOut();
            return;
          }
          const res = await acceptUpdatedTerms(accepted);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          setOpen(false);
          router.refresh();
        })
      }
    />
  );
}
