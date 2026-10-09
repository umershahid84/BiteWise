import type { Metadata } from 'next';
import { AppInstall, type Device } from '@/components/app-install/app-install';

export const metadata: Metadata = {
  title: 'Get Bite Wise on your phone',
  description: 'Put Bite Wise on your Android phone, iPhone or Windows computer: deals near you, one tap away.',
};

// "Add to Home screen" guide for customers, linked from the welcome email (?device=android|iphone|windows).
export default async function AppPage({ searchParams }: PageProps<'/app'>) {
  const { device } = await searchParams;
  const initial: Device | null = device === 'android' || device === 'iphone' || device === 'windows' ? device : null;
  return <AppInstall initial={initial} />;
}
