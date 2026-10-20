import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { resolveOpenLink } from "@/lib/openLinks";
import { sendOpenLinkPushAction, sendOpenLinkLoginMailAction } from "@/lib/actions/openlink.actions";

const RESULTATEN: Record<string, { ok: boolean; text: string }> = {
  sent: {
    ok: true,
    text: "Er is een melding naar je apparaten gestuurd. Tik erop om Ringtools te openen. Komt er niets binnen (bijvoorbeeld omdat je apparaat offline is), log dan hieronder in via de browser.",
  },
  "no-devices": {
    ok: false,
    text: "Er zijn geen apparaten gevonden waarop meldingen voor Ringtools aan staan. Log in via de browser, of zet meldingen aan via Profiel in de app.",
  },
  "push-unavailable": { ok: false, text: "Meldingen zijn op deze server niet ingeschakeld. Log in via de browser." },
  throttled: { ok: false, text: "Er is zojuist al een bericht verstuurd. Wacht een paar minuten voordat je het opnieuw probeert." },
  invalid: { ok: false, text: "Deze koppeling is niet meer geldig." },
  "mail-sent": { ok: true, text: "Er is een inloglink naar je e-mailadres gestuurd. Open die link in de browser; daarna kom je direct bij het verzoek." },
  "mail-failed": { ok: false, text: "De inloglink kon niet worden verstuurd. Probeer het later opnieuw of log in via de inlogpagina." },
};

/**
 * Landingspagina voor de persoonlijke koppeling uit een e-mail. Toont bewust GEEN
 * gegevens over het voorstel: wie niet is ingelogd ziet alleen de keuzemogelijkheden.
 */
export default async function OpenLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ resultaat?: string }>;
}) {
  const { token } = await params;
  const { resultaat } = await searchParams;
  const info = await resolveOpenLink(token);

  if (info.valid) {
    // Al ingelogd in deze browser: direct naar het voorstel (rechten worden daar gecontroleerd).
    const user = await getCurrentUser();
    if (user) redirect(info.path);
  }

  const result = resultaat ? RESULTATEN[resultaat] : undefined;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Ringtools</h1>
        </div>

        {!info.valid ? (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              Deze koppeling is ongeldig of verlopen. Log in om je openstaande verzoeken te bekijken.
            </p>
            <a href="/login" className="btn-primary w-full">
              Naar inlogpagina
            </a>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--text-muted)]">
              Er staat een verzoek voor je klaar in Ringtools. Kies hoe je verdergaat.
            </p>

            <a href={`/login?next=${encodeURIComponent(info.path)}`} className="btn-primary w-full" data-testid="open-in-browser">
              Inloggen en openen in de browser
            </a>

            <form action={sendOpenLinkLoginMailAction}>
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="btn-ghost w-full" data-testid="send-login-mail">
                Stuur mij een inloglink per e-mail
              </button>
            </form>

            <form action={sendOpenLinkPushAction} className="space-y-2">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="btn-ghost w-full" data-testid="send-app-notification">
                Stuur een melding naar mijn Ringtools-app
              </button>
              <p className="text-xs text-[var(--text-muted)]">
                Heb je Ringtools als app op je beginscherm staan? Een browser kan die app niet rechtstreeks voor je openen
                (op een iPhone of iPad is dat technisch niet mogelijk). Daarom sturen we een melding zonder persoonlijke
                gegevens naar je apparaten; tik erop om het verzoek in de app te openen. Je moet daar zelf zijn ingelogd.
              </p>
            </form>

            {result && (
              <p role="status" className={`text-sm ${result.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                {result.text}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
