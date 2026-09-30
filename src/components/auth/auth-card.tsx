export function AuthCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="grid place-items-center px-4 py-12">
      <div className="w-full max-w-[480px] rounded-card border border-line bg-surface p-8 shadow-pop">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-mark.svg" alt="" className="mx-auto mb-3 size-14" />
        {title && <AuthTitle>{title}</AuthTitle>}
        {children}
      </div>
    </main>
  );
}

export function AuthTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-5 text-center text-[1.7rem] font-extrabold">{children}</h1>;
}
