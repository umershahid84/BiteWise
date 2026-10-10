import { redirect } from 'next/navigation';

// Restaurants now log in on the main log-in page, with customers. Old links and bookmarks are sent there.
export default async function RestaurantLoginPage({ searchParams }: PageProps<'/restaurant/login'>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') q.set(k, v);
  redirect(`/login${q.size ? `?${q}` : ''}`);
}
