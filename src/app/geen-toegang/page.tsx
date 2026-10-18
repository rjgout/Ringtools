export default function GeenToegangPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold">Geen toegang</h1>
        <p className="mt-3 text-[var(--text-muted)]">
          Je account heeft geen bevoegdheid om deze pagina te bekijken.
        </p>
        <a href="/dashboard" className="btn-primary mt-6 w-full">
          Naar dashboard
        </a>
      </div>
    </main>
  );
}
