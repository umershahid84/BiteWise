import Link from 'next/link';
import { DemoVideoShowcase } from '@/components/app/demo-video';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STEPS = [
  ['🔎', 'Browse nearby deals', 'Discounted meals from restaurants around you, with pickup times and how many are left.'],
  ['🧾', 'See the full total', 'Food, a small service fee and any applicable taxes are all shown before you order. No surprises.'],
  ['🔢', 'Get your PIN', 'We place a hold on your card and give you a 4-digit PIN to show at the counter.'],
  ['🥡', 'Pick up & enjoy', 'The restaurant enters your PIN. Only then is your card charged.'],
];

export default function LandingPage() {
  return (
    <main>
      <section className="relative overflow-hidden pt-16 pb-14 md:pt-[72px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[-10%] top-[-20%] h-[700px] [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
          style={{
            background:
              'radial-gradient(520px 360px at 12% 30%, rgba(251,146,60,.18), transparent 70%), radial-gradient(460px 320px at 85% 20%, rgba(253,224,71,.24), transparent 70%), radial-gradient(400px 300px at 60% 90%, rgba(78,159,61,.12), transparent 70%)',
          }}
        />
        <div className="container-page relative grid items-center gap-12 md:grid-cols-[1.15fr_.85fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-[0.8rem] font-bold text-primary-ink">
              🌱 Launching across the United States &amp; Canada
            </span>
            <h1 className="my-[18px] text-[clamp(2.4rem,5.6vw,4.1rem)] leading-[1.05] font-extrabold tracking-[-0.035em]">
              Rescue great food.
              <br />
              <span className="grad-text">Save up to 70%.</span>
            </h1>
            <p className="mb-7 max-w-[40ch] text-[1.18rem] text-ink-2">
              Wrong orders, late deliveries, meals nobody picked up. Local restaurants post them on Bite Wise at a discount, and you grab them
              before they go to waste.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className={buttonVariants({ size: 'lg' })}>Find deals near me →</Link>
              <Link href="/restaurant/signup" className={buttonVariants({ size: 'lg', variant: 'ghost' })}>I&apos;m a restaurant</Link>
            </div>
            <a href="#video" className="mt-4 inline-flex items-center gap-1.5 text-[0.95rem] font-bold text-primary-ink hover:underline">▶ Watch the 90-second video</a>
            <div className="mt-7 flex flex-wrap gap-5 text-[0.9rem] font-semibold text-muted">
              {['Free account', 'Pay only at pickup', 'Secure 4-digit PIN'].map((t) => (
                <span key={t}><b className="mr-1.5 text-primary">✓</b>{t}</span>
              ))}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[380px]" aria-hidden>
            <div className="group -rotate-2 overflow-hidden rounded-[28px] border border-line bg-surface shadow-pop transition duration-300 hover:-translate-y-1 hover:rotate-0">
              <div className="relative grid h-[150px] place-items-center text-[72px]" style={{ background: 'linear-gradient(135deg, hsl(28 var(--tile-s) var(--tile-l1)), hsl(68 var(--tile-s) var(--tile-l2)))' }}>
                <span className="drop-shadow-lg transition duration-300 group-hover:scale-110 group-hover:-rotate-6">🍜</span>
                <span className="absolute top-3 left-3 rounded-full bg-accent px-3 py-1 font-heading text-sm font-extrabold text-on-accent">-50%</span>
                <span className="absolute top-3 right-3 rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-on-accent">2 left</span>
              </div>
              <div className="p-5">
                <h3 className="m-0 text-lg font-bold">Large Beef Pho</h3>
                <div className="text-sm text-muted">Harbor Pho House · 0.4 mi away</div>
                <div className="mt-2 flex gap-4 text-sm text-ink-2"><span>🕒 Today 5:00 – 8:00 PM</span><span>📍 0.4 mi</span></div>
                <div className="mt-3 flex gap-2">
                  <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent-ink">Wrong order</span>
                  <span className="rounded-full border border-primary/30 px-2.5 py-0.5 text-xs font-bold text-primary-ink">dairy-free</span>
                </div>
                <div className="mt-4 flex items-center gap-2 border-t border-dashed border-line pt-3">
                  <span className="font-heading text-2xl font-extrabold">$8.48</span>
                  <span className="text-muted line-through">$16.95</span>
                  <span className="flex-1" />
                  <span className={buttonVariants({ size: 'sm' })}>Order</span>
                </div>
              </div>
            </div>
            <div className="absolute -right-3 -bottom-14 rotate-3 rounded-[22px] bg-grad px-5 py-4 text-center text-on-primary shadow-pop">
              <small className="block text-[0.72rem] font-semibold tracking-[0.08em] uppercase opacity-70">Your pickup PIN</small>
              <b className="ml-[0.25em] font-heading text-[1.9rem] leading-tight font-extrabold tracking-[0.25em]">4827</b>
            </div>
          </div>
        </div>
      </section>

      <section className="pt-6 pb-10">
        <div className="container-page grid gap-4 md:grid-cols-3">
          {[
            ['30–70%', 'typical savings on restaurant meals', true],
            ['$0', 'to join, for customers and restaurants', false],
            ['1 minute', 'for a restaurant to post surplus food', false],
          ].map(([big, text, grad]) => (
            <div key={String(big)} className="rounded-card border border-line bg-surface p-[22px]">
              <b className={cn('block font-heading text-[2rem] font-extrabold tracking-[-0.03em]', grad && 'grad-text')}>{big}</b>
              <span className="text-muted">{text}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="scroll-mt-24 py-14">
        <div className="container-page">
          <div className="mb-8 text-center">
            <span className="inline-flex rounded-full bg-primary-soft px-3 py-1.5 text-[0.8rem] font-bold text-primary-ink">How it works</span>
            <h2 className="mt-3.5 text-[clamp(1.4rem,2.6vw,2rem)] font-extrabold">
              Order in seconds. Pay only when you pick&nbsp;up.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([icon, title, text], i) => (
              <div key={title} className="rounded-card border border-line bg-surface p-6 transition hover:-translate-y-0.5 hover:shadow-card">
                <div className={cn('mb-4 grid size-12 place-items-center rounded-[14px] text-2xl', i % 2 ? 'bg-accent-soft' : 'bg-primary-soft')}>{icon}</div>
                <h3 className="text-lg font-bold">{title}</h3>
                <p className="text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="video" className="scroll-mt-24 py-10">
        <div className="container-page">
          <div className="mb-6 text-center">
            <span className="inline-flex rounded-full bg-primary-soft px-3 py-1.5 text-[0.8rem] font-bold text-primary-ink">▶ See it in action</span>
            <h2 className="mt-3.5 text-[clamp(1.4rem,2.6vw,2rem)] font-extrabold">Watch Bite Wise in 90 seconds</h2>
            <p className="m-0 text-muted">A quick narrated tour of ordering a meal, and of the restaurant side. Turn your sound on.</p>
          </div>
          <DemoVideoShowcase />
        </div>
      </section>

      <section id="restaurants" className="scroll-mt-24 py-6">
        <div className="container-page grid gap-5 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-[28px] bg-grad p-9 text-white">
            <h2 className="text-2xl font-extrabold">Hungry? Eat well for less.</h2>
            <p className="max-w-[42ch] opacity-90">Create a free account with your email, a user name and a password. Save your card for one-tap checkout.</p>
            <Link href="/signup" className={cn(buttonVariants(), 'relative z-10 bg-white text-[#0b1b14] shadow-none')}>Create free account</Link>
            <span aria-hidden className="absolute -right-20 -bottom-28 size-[260px] rounded-full bg-white/10" />
          </div>
          <div className="relative overflow-hidden rounded-[28px] p-9 text-white" style={{ background: 'linear-gradient(135deg, #1e1e1e, #3b2a0a)' }}>
            <h2 className="text-2xl font-extrabold">Restaurants: turn waste into revenue.</h2>
            <p className="max-w-[42ch] opacity-90">Post surplus food in under a minute, set your own discount, confirm pickups with the customer&apos;s PIN, and get paid through Stripe.</p>
            <Link href="/restaurant/signup" className={cn(buttonVariants(), 'relative z-10 bg-white text-[#0b1b14] shadow-none')}>Open restaurant portal</Link>
            <span aria-hidden className="absolute -right-20 -bottom-28 size-[260px] rounded-full bg-white/10" />
          </div>
        </div>
      </section>
    </main>
  );
}
