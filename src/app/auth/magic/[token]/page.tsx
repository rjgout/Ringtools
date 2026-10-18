import { previewMagicLinkAction, confirmMagicLinkAction } from "@/lib/actions/auth.actions";

export default async function MagicLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { token } = await params;
  const { redirect: redirectTo } = await searchParams;
  const preview = await previewMagicLinkAction(token);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold">Ringtools</h1>

        {preview.valid ? (
          <>
            <p className="mt-3 text-[var(--text-muted)]">
              Welkom, {preview.name}. Klik op de knop om veilig in te loggen.
            </p>
            <form action={confirmMagicLinkAction} className="mt-6">
              <input type="hidden" name="token" value={token} />
              {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}
              <button type="submit" className="btn-primary w-full">
                Inloggen
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-3 text-[var(--text-muted)]">
              Deze inloglink is ongeldig, al gebruikt of verlopen. Vraag op de inlogpagina een nieuwe link aan.
            </p>
            <a href="/login" className="btn-primary mt-6 w-full">
              Naar inlogpagina
            </a>
          </>
        )}
      </div>
    </main>
  );
}
