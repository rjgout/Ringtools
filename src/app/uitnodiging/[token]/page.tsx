import type { Metadata } from "next";

// Het token in de URL wordt hier nooit gelezen, gecontroleerd of verbruikt: deze pagina is uitsluitend informatief.
// De activatie gebeurt in de Ringtools-app; er wordt bewust niets naar derden gelekt (geen referrer, niet indexeren).
export const metadata: Metadata = {
  title: "Ringtools – uitnodiging",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Landingspagina voor de link in een uitnodigingsmail (/uitnodiging/<token>). Heeft iemand de app geïnstalleerd en zijn
 * universele links/app-links actief, dan opent de app direct en ziet hij deze pagina niet. Anders legt deze pagina
 * rustig uit wat er moet gebeuren; de website zelf activeert niets en toont geen gegevens.
 */
export default function InvitationLandingPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Ringtools</h1>
          <p className="text-sm text-[var(--text-muted)]">Je bent uitgenodigd</p>
        </div>
        <p className="text-sm">Je account activeer je in de Ringtools-app op je telefoon.</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Installeer de Ringtools-app als je die nog niet hebt.</li>
          <li>Tik daarna in je e-mail nogmaals op de link: de app opent en je account wordt geactiveerd.</li>
          <li>
            Opent de app niet? Open de app zelf, kies <strong>Ik heb een uitnodiging</strong> en vul je e-mailadres en de
            activeringscode uit de e-mail in.
          </li>
        </ol>
        <p className="text-xs text-[var(--text-muted)]">
          Heb je deze uitnodiging niet verwacht? Dan kun je hem negeren; er gebeurt niets zonder jouw activatie.
        </p>
      </div>
    </main>
  );
}
