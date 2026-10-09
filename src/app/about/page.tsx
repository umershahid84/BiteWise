import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'About us',
  description: 'How three family members who grew up in Pakistan, where wasting food was never an option, started Bite Wise in the United States and Canada to rescue good restaurant food.',
};

// Photos live in public/about/. Until a photo is there, its frame shows a placeholder that says which file to add,
// so the page can go live now and the pictures can follow.
const PHOTO_DIR = path.join(process.cwd(), 'public', 'about');
function photo(name: string) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    if (fs.existsSync(path.join(PHOTO_DIR, `${name}.${ext}`))) return `/about/${name}.${ext}`;
  }
  return null;
}

function Photo({ name, label, emoji, className, tilt = 0 }: { name: string; label: string; emoji: string; className?: string; tilt?: number }) {
  const src = photo(name);
  return (
    <figure className={cn('m-0 min-w-0', className)} style={{ transform: tilt ? `rotate(${tilt}deg)` : undefined }}>
      <div className="overflow-hidden rounded-[22px] border-[6px] border-white/90 bg-surface shadow-pop">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className="aspect-[4/5] w-full object-cover" />
        ) : (
          <div
            className="grid aspect-[4/5] w-full place-items-center p-4 text-center"
            style={{ background: 'repeating-linear-gradient(135deg, rgba(52,211,153,.10) 0 14px, rgba(253,224,71,.06) 14px 28px)' }}
          >
            <div>
              <div className="text-5xl">{emoji}</div>
              <div className="mt-2 font-bold text-ink-2">{label}</div>
              <div className="mt-1 text-xs text-muted">Photo coming soon</div>
              <code className="mt-2 inline-block max-w-full rounded bg-bg-2 px-2 py-0.5 text-[11px] break-all text-muted">public/about/{name}.jpg</code>
            </div>
          </div>
        )}
      </div>
      <figcaption className="mt-2 text-center text-sm font-semibold text-muted">{label}</figcaption>
    </figure>
  );
}

const MEMORIES = [
  ['🧺', 'The dastarkhwan', 'Meals were shared on a cloth spread across the floor. Everyone sat together, and nobody stood up until every plate was clean.'],
  ['🫓', 'Every roti counts', 'A piece of roti that fell was picked up and set aside with respect, never thrown away. Food is rizq, a blessing, and you honour it.'],
  ['🥣', 'Yesterday’s roti, today’s breakfast', 'Leftover roti became sweet churi with ghee and sugar the next morning. Last night’s curry became today’s lunch. Nothing was wasted.'],
  ['🤲', 'A plate for the neighbours', 'If there was extra, a plate went next door or to someone who needed it more. Sharing was never a favour; it was simply what you did.'],
] as const;

const STEPS = [
  ['🇵🇰', 'Growing up in Pakistan', 'We grew up surrounded by family, chai, cricket in the street and mango summers, and by the reality that many families struggle to put one meal on the table. Hunger was never far away.'],
  ['✈️', 'Two new homes', 'Life took us across the world: Umer to the United States, Arham and Shaheer to Canada. Two countries, one family, and a lot of long-distance calls. Both countries gave us so much: opportunity, safety and a future. We are grateful for them every day.'],
  ['🗑️', 'The thing we couldn’t get used to', 'Good food in the bin. A wrong order, a late delivery, a meal nobody picked up, the end of the day. Strict food-safety rules mean restaurants often have to throw perfectly good food away.'],
  ['🌱', 'Bite Wise is born', 'What if that food could go to someone nearby, at a great price, before it was too late? We built Bite Wise together across the border to make that one tap away, and we are launching it in the United States and Canada at the same time.'],
] as const;

const SAVES = [
  ['🍲', 'Save food', 'Good meals get eaten instead of thrown away.'],
  ['💵', 'Save money', 'Customers get restaurant food at up to 70% off.'],
  ['🌍', 'Save the environment', 'Less food in landfills means less waste and fewer emissions.'],
  ['🏪', 'Help the economy', 'Restaurants earn revenue from food that would have been a loss.'],
] as const;

const FOUNDERS = [
  { name: 'Umer', file: 'umer', emoji: '👨🏽‍🍳', home: '🇺🇸 United States' },
  { name: 'Arham', file: 'arham', emoji: '🧑🏽‍💻', home: '🇨🇦 Canada' },
  { name: 'Shaheer', file: 'shaheer', emoji: '🧑🏽‍🚀', home: '🇨🇦 Canada' },
] as const;

export default function AboutPage() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden pt-14 pb-12 md:pt-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[-10%] top-[-20%] h-[700px]"
          style={{
            background:
              'radial-gradient(520px 360px at 10% 30%, rgba(52,211,153,.22), transparent 70%), radial-gradient(460px 320px at 88% 18%, rgba(253,224,71,.22), transparent 70%)',
          }}
        />
        <div className="container-page relative grid grid-cols-1 items-center gap-12 md:grid-cols-[1.1fr_.9fr]">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-[0.8rem] font-bold text-primary-ink">
              💚 Our story · 🇺🇸 United States &amp; 🇨🇦 Canada
            </span>
            <h1 className="my-[18px] text-[clamp(2.2rem,5vw,3.7rem)] leading-[1.05] font-extrabold tracking-[-0.03em]">
              It started with one rule:
              <br />
              <span className="grad-text">finish your plate.</span>
            </h1>
            <p className="mb-4 max-w-[46ch] text-[1.15rem] text-ink-2">
              We are <b>Umer</b>, <b>Arham</b> and <b>Shaheer</b>: family first, founders second. We grew up in Pakistan, where wasting food
              was never an option. Today Umer lives in the United States and Arham and Shaheer in Canada, and Bite Wise is how we are carrying that lesson into our new homes.
            </p>
            <p className="max-w-[46ch] text-ink-2">
              &ldquo;Put on your plate only what you can eat, and finish it.&rdquo; We heard it at every meal as children. Today it is the reason this
              platform exists.
            </p>
          </div>
          <div className="mx-auto grid w-full max-w-[460px] min-w-0 grid-cols-[1fr_.8fr] items-end gap-4">
            <Photo name="founders" label="Umer, Arham & Shaheer" emoji="📸" tilt={-2} />
            <Photo name="pakistan" label="Back home in Pakistan" emoji="🇵🇰" tilt={3} className="mb-8" />
          </div>
        </div>
      </section>

      {/* Where we come from */}
      <section className="container-page py-12">
        <div className="mx-auto max-w-[760px] text-center">
          <h2 className="m-0 text-[clamp(1.8rem,3.6vw,2.6rem)] font-extrabold tracking-tight">Where we come from</h2>
          <p className="mt-3 text-[1.08rem] text-ink-2">
            In Pakistan, hunger is real. Too many families go to bed without enough to eat, and some never get enough at all. So from the time we
            could hold a spoon, we were taught that food is precious. These are the moments we grew up with:
          </p>
        </div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MEMORIES.map(([emoji, title, text], i) => (
            <div
              key={title}
              className="rounded-card border border-line bg-surface p-5 transition duration-300 hover:-translate-y-1"
              style={{ transform: `rotate(${[-1, 0.8, -0.6, 1][i]}deg)` }}
            >
              <div className="text-4xl">{emoji}</div>
              <h3 className="mt-3 mb-1.5 text-lg font-extrabold">{title}</h3>
              <p className="m-0 text-[0.95rem] text-ink-2">{text}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 [&>*:last-child]:col-span-2 [&>*:last-child]:mx-auto [&>*:last-child]:w-1/2 sm:[&>*:last-child]:col-span-1 sm:[&>*:last-child]:w-auto">
          <Photo name="family-meal" label="Family meals around the dastarkhwan" emoji="🍛" tilt={-1.5} />
          <Photo name="childhood" label="Where we grew up" emoji="🏏" tilt={1} />
          <Photo name="family" label="Our family" emoji="👨‍👩‍👦‍👦" tilt={-0.8} />
        </div>
      </section>

      {/* Journey */}
      <section className="container-page py-12">
        <h2 className="m-0 text-center text-[clamp(1.8rem,3.6vw,2.6rem)] font-extrabold tracking-tight">From Pakistan to the United States and Canada</h2>
        <ol className="relative mx-auto mt-10 grid max-w-[880px] list-none gap-5 p-0">
          <span aria-hidden className="absolute top-4 bottom-4 left-[27px] w-[3px] rounded-full bg-grad opacity-60" />
          {STEPS.map(([emoji, title, text], i) => (
            <li key={title} className="relative grid grid-cols-[56px_1fr] items-start gap-4">
              <span className="z-10 grid size-14 place-items-center rounded-full border border-line bg-surface text-2xl shadow-pop">{emoji}</span>
              <div className="rounded-card border border-line bg-surface p-5">
                <div className="text-xs font-bold tracking-wide text-primary-ink uppercase">Chapter {i + 1}</div>
                <h3 className="mt-1 mb-1.5 text-xl font-extrabold">{title}</h3>
                <p className="m-0 text-ink-2">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <blockquote className="mx-auto mt-10 max-w-[760px] rounded-card border border-primary/30 bg-primary-soft/40 px-7 py-6 text-center text-[1.15rem] font-semibold text-ink">
          &ldquo;We love the United States and Canada and everything they have given us. The one thing we could never get used to was watching good food go to
          waste, knowing how many people back home would be grateful for a single meal.&rdquo;
        </blockquote>
      </section>

      {/* Why */}
      <section className="container-page py-12">
        <div className="mx-auto max-w-[760px] text-center">
          <h2 className="m-0 text-[clamp(1.8rem,3.6vw,2.6rem)] font-extrabold tracking-tight">Why Bite Wise</h2>
          <p className="mt-3 text-[1.08rem] text-ink-2">
            Restaurants don&apos;t want to throw food away; the rules leave them little choice. So we built a simple way to get that food to people
            nearby while it is still fresh, good and safe to enjoy. Every rescued meal is four wins at once:
          </p>
        </div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SAVES.map(([emoji, title, text]) => (
            <div key={title} className="rounded-card border border-line bg-surface p-6 text-center">
              <div className="mx-auto grid size-16 place-items-center rounded-full bg-primary-soft text-3xl">{emoji}</div>
              <h3 className="mt-4 mb-1.5 text-lg font-extrabold">{title}</h3>
              <p className="m-0 text-[0.95rem] text-ink-2">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Founders */}
      <section className="container-page py-12">
        <h2 className="m-0 text-center text-[clamp(1.8rem,3.6vw,2.6rem)] font-extrabold tracking-tight">Meet the founders</h2>
        <p className="mx-auto mt-3 max-w-[640px] text-center text-ink-2">Three family members in two countries, one dinner-table rule, and a lot of chai along the way.</p>
        <div className="mx-auto mt-9 grid max-w-[920px] grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 [&>*:last-child]:col-span-2 [&>*:last-child]:mx-auto [&>*:last-child]:w-1/2 sm:[&>*:last-child]:col-span-1 sm:[&>*:last-child]:w-auto">
          {FOUNDERS.map((f, i) => (
            <div key={f.name} className="text-center">
              <Photo name={f.file} label={f.name} emoji={f.emoji} tilt={[-2, 1.5, -1][i]} />
              <div className="mt-1 text-sm text-muted">Co-founder · {f.home}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Thanks */}
      <section className="container-page py-12">
        <div className="relative overflow-hidden rounded-[28px] border border-line bg-surface p-7 md:p-10">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-accent/15 blur-3xl" />
          <div className="relative grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 text-[0.8rem] font-bold text-accent-ink">🤍 With gratitude</span>
              <h2 className="mt-4 mb-3 text-[clamp(1.7rem,3.2vw,2.3rem)] font-extrabold tracking-tight">The two people who guided us</h2>
              <p className="text-ink-2">
                Every idea needs people who believe in it before anyone else does. Bite Wise would not be what it is without two of them.
              </p>
              <p className="text-ink-2">
                <b>Aini</b>, Umer&apos;s sister and the mother of Arham and Shaheer, whose wisdom, patience and encouragement shaped this platform
                from its first sketch.
              </p>
              <p className="text-ink-2">
                <b>Ulliya</b>, Umer&apos;s wife, whose honest feedback and steady support guided us all the way to the final product.
              </p>
              <p className="mb-0 font-semibold text-ink">Thank you both, from all three of us. 💚</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Photo name="aini" label="Aini" emoji="🌸" tilt={-2} />
              <Photo name="ulliya" label="Ulliya" emoji="🌼" tilt={2} />
            </div>
          </div>
        </div>
      </section>

      {/* Hope */}
      <section className="container-page py-12 text-center">
        <div className="text-5xl">🍽️</div>
        <h2 className="mt-4 mb-3 text-[clamp(1.8rem,3.6vw,2.6rem)] font-extrabold tracking-tight">Our hope</h2>
        <p className="mx-auto max-w-[680px] text-[1.08rem] text-ink-2">
          We hope Bite Wise helps you enjoy great food for less, helps restaurant owners earn from food that would have been thrown away, and
          helps all of us waste a little less. If our story makes you think twice before throwing away a good meal, we have already done
          something right.
        </p>
        <p className="mx-auto max-w-[680px] font-semibold text-ink">Thank you for being part of it, in the United States and in Canada. Take only what you can eat, and enjoy every bite.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className={buttonVariants({ size: 'lg' })}>Find food near me →</Link>
          <Link href="/restaurant/signup" className={buttonVariants({ size: 'lg', variant: 'ghost' })}>Partner with us</Link>
        </div>
        <p className="mt-6 text-sm text-muted">Umer, Arham &amp; Shaheer · Founders of Bite Wise</p>
      </section>
    </main>
  );
}
