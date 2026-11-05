import Link from "next/link";

/** Gemeenschappelijke omlijsting van de publieke (informatieve) pagina's: geen gegevens, geen sessie nodig. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <Link href="/" className="text-lg font-semibold" aria-label="Ringtools – startpagina">
          Ringtools
        </Link>
        <nav aria-label="Hoofdmenu" className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/privacy" className="px-2 py-2 text-[var(--text-muted)] underline-offset-2 hover:underline">
            Privacy
          </Link>
          <Link href="/contact" className="px-2 py-2 text-[var(--text-muted)] underline-offset-2 hover:underline">
            Contact
          </Link>
          <Link href="/login" className="btn btn-primary" data-testid="login-button">
            Inloggen
          </Link>
        </nav>
      </header>
      <main className="flex-1 space-y-6 pb-10">{children}</main>
      <footer className="border-t border-black/10 py-6 text-sm text-[var(--text-muted)] dark:border-white/10">
        <nav aria-label="Voettekst" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className="underline-offset-2 hover:underline">
            Privacy
          </Link>
          <Link href="/accountverwijdering" className="underline-offset-2 hover:underline">
            Accountverwijdering
          </Link>
          <Link href="/contact" className="underline-offset-2 hover:underline">
            Contact
          </Link>
          <Link href="/login" className="underline-offset-2 hover:underline">
            Inloggen
          </Link>
        </nav>
      </footer>
    </div>
  );
}
