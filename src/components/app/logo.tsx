// The Bite Wise logo for the current theme: dark lettering on the light customer and admin themes, light lettering
// on the dark restaurant theme (src/app/globals.css shows the right one).
export function Logo({ className }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/logo-compact.svg" alt="Bite Wise" className={`logo-on-light ${className ?? ''}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/logo-dark-compact.svg" alt="Bite Wise" className={`logo-on-dark ${className ?? ''}`} />
    </>
  );
}
