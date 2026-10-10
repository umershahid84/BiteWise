import { redirect } from 'next/navigation';

// Restaurants log in on the main log-in page (the "Log in as a restaurant" side). Old links are sent there.
export default async function RestaurantLoginPage({ searchParams }: PageProps<'/restaurant/login'>) {
  const q = new URLSearchParams({ as: 'restaurant' });
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') q.set(k, v);
  redirect(`/login?${q}`);
}
