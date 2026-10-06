'use client';

import { useEffect, useState } from 'react';
import { Copy, ExternalLink, FileSignature, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getKiosk, newKioskLink } from '@/app/actions/restaurant';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/misc';

type Kiosk = { kioskUrl: string; androidUrl: string; appleUrl: string; windowsUrl: string; qr: string };

// The restaurant's counter kiosk: its private link, a QR code to open it on the tablet, how to add it to the
// tablet's home screen, and the signed Restaurant Partner Agreement.
export function KioskPanel({ approved }: { approved: boolean }) {
  const [kiosk, setKiosk] = useState<Kiosk | null>(null);
  const [loading, setLoading] = useState(approved);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!approved) return;
    getKiosk().then((res) => {
      setLoading(false);
      if (res.ok) setKiosk(res.data);
      else setError(res.error);
    });
  }, [approved]);

  const rotate = async () => {
    if (!confirm('Get a new kiosk link? The current link stops working right away, so you will need to open the new one on your tablet (and add it to the home screen again).')) return;
    const res = await newKioskLink();
    if (!res.ok) return toast.error(res.error);
    setKiosk(res.data);
    toast.success('New kiosk link ready. The old one no longer works.');
  };

  const agreement = (
    <a href="/api/restaurant/agreement" className={buttonVariants({ variant: 'ghost', size: 'sm' })}><FileSignature /> Download signed agreement (PDF)</a>
  );

  if (!approved) {
    return (
      <Card className="p-6">
        <h2 className="mt-0 text-xl font-extrabold">Your counter kiosk</h2>
        <p className="text-ink-2">Once Bite Wise approves your restaurant, you get your own kiosk link here (and by email): a full-screen page for the tablet at your counter that shows new orders and lets staff hand them over with the customer&apos;s PIN.</p>
        {agreement}
      </Card>
    );
  }
  if (loading) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (error || !kiosk) return <Alert tone="error">{error ?? 'Could not load your kiosk link.'}</Alert>;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Card className="p-6">
        <h2 className="mt-0 text-xl font-extrabold">Your counter kiosk</h2>
        <p className="text-ink-2">A full-screen page for the tablet at your counter: new orders appear with a bell, and staff hand them over by typing the customer&apos;s PIN. No password needed, so <b>only share this link with your staff</b>.</p>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-field border border-line bg-bg-2 p-2 pl-4">
          <code className="min-w-0 flex-1 truncate text-sm">{kiosk.kioskUrl}</code>
          <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(kiosk.kioskUrl).then(() => toast.success('Kiosk link copied'))}><Copy /> Copy</Button>
          <a href={kiosk.kioskUrl} target="_blank" rel="noopener" className={buttonVariants({ size: 'sm' })}><ExternalLink /> Open kiosk</a>
        </div>
        <h3 className="mb-2 text-base font-extrabold">Put it on your tablet or computer</h3>
        <ol className="mt-0 space-y-2 pl-5 text-ink-2">
          <li>On the tablet, scan the QR code with the camera (or open the link from your welcome email).</li>
          <li><b>Android tablet</b> (Chrome): tap <b>Add to home screen</b> on the kiosk, then <b>Install</b>.</li>
          <li><b>iPad</b> (Safari): tap the Share button, then <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          <li><b>Windows computer</b> (Edge or Chrome): open <a href={kiosk.windowsUrl} target="_blank" rel="noopener">the kiosk on the computer</a> and click <b>Install on this computer</b> (Edge: menu → <b>Apps</b> → <b>Install this site as an app</b>).</li>
          <li>Open the kiosk any time from the <b>Bite Wise Kiosk</b> icon on the home screen (or the Start menu on Windows). It opens full-screen.</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          {agreement}
          <Button variant="ghost" size="sm" onClick={rotate}><RefreshCw /> Get a new link</Button>
        </div>
      </Card>
      <Card className="p-5 text-center">
        <div className="mx-auto w-full max-w-[240px] overflow-hidden rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: kiosk.qr }} />
        <p className="mb-0 text-sm text-muted">Scan with the tablet&apos;s camera to open your kiosk.</p>
      </Card>
    </div>
  );
}
