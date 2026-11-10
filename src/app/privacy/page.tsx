import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/public/PublicShell";
export const metadata: Metadata = { title: "Ringtools – privacy", description: "Gegevens, gevoelige informatie, bewaartermijnen en accountverwijdering." };
export default function PrivacyPage() {
  return <PublicShell><section className="glass-card space-y-3">
    <h1 className="text-xl font-semibold">Privacy</h1>
    <p>Versie 10 november 2026. Verwerkingsverantwoordelijke en contact: Raphael Gout, <a className="underline" href="mailto:raphael@ringapeldoorn.nl">raphael@ringapeldoorn.nl</a>.</p>
    <p>Ringtools is een onafhankelijk hulpmiddel voor roepingen en ontheffingen, geen officiële app van De Kerk van Jezus Christus van de Heiligen der Laatste Dagen. Toegang wordt op uitnodiging verleend. Het is geen blijvend ledenregister; er worden geen persoonsgegevens uit LCR geïmporteerd.</p>
    <h2 className="font-semibold">Gegevens en doelen</h2>
    <ul className="list-disc space-y-2 pl-5">
      <li>Naam, e-mailadres, gebruikers-ID, rol, kerkelijke functie, ring en wijk/gemeente: account, toegangscontrole en werkverdeling.</li>
      <li>Namen van kandidaten en betrokkenen, functies, ondersteuning, negatieve reacties, vergaderbesluiten, aanwezigen, taken, tijdstippen, notities en proceshistorie: behandeling van roepingen en vertrouwelijke ontheffingen. Ook gegevens over personen zonder account kunnen hierin staan. Deze context kan religieuze overtuiging of betrokkenheid onthullen en is daarmee gevoelige informatie.</li>
      <li>Sessiegegevens, toestel-/installatie-ID, platform, user-agent/toestellabel, publieke sleutels, versleutelde TOTP-geheimen, gehashte herstelcodes, beveiligingsgebeurtenissen en notificatiestatus: beveiliging en functionele meldingen. Reviewwachtwoorden worden alleen als bcrypt-hash opgeslagen.</li>
      <li>Pushregistraties bij Apple/Google, interne meldingen, uitnodigingsgegevens en gehashte eenmalige codes: communicatie en activering. Verwijderverzoeken en statusbewijzen: behandeling en controle van verwijdering.</li>
    </ul>
    <p>Biometrie en toestelcodes worden uitsluitend door iOS/Android verwerkt. Ringtools ontvangt geen gezicht, vingerafdruk of toestelcode. Er zijn geen advertenties, advertentie-ID’s, tracking, verkoop van gegevens of analytics van derden. De app vraagt geen locatie, contacten, camera, microfoon of fotobibliotheek.</p>
    <p>Functionele e-mails en pushmeldingen bevatten uitsluitend een generieke actieboodschap, geen persoonsnamen, functies, ringen of dossierdetails. Open de beveiligde app om de handeling te bekijken. Login-, uitnodigings- en beveiligingsmail bevat alleen de noodzakelijke informatie voor dat doel. Vooraf administratief toegewezen uitvoeringstaken geven pas rechten en meldingen na definitief akkoord en expliciete uitvoeringsvrijgave.</p>
    <h2 className="font-semibold">Toegang en ontvangers</h2>
    <p>De eigen PostgreSQL-server bewaart de gegevens. Alleen bevoegde gebruikers binnen dezelfde ring hebben toegang volgens hun rol en de actuele procedure. Een expliciet gekoppelde betrokkene is uitgesloten van het eigen ontheffingsdossier. Technisch beheer heeft beheerrechten. Apple APNs en Google FCM verzorgen push met generieke tekst zonder namen/functies; de geconfigureerde SMTP-dienst verwerkt e-mail. De demoring bevat uitsluitend fictieve gegevens en verstuurt geen externe uitnodigingen, e-mail of push.</p>
    <p>De verantwoordelijke moet vóór publieke release de feitelijke hosting- en SMTP-leveranciers, verwerkersafspraken, eventuele internationale doorgiften en bijbehorende waarborgen vaststellen en deze verklaring daarop aanvullen.</p>
    <h2 className="font-semibold">Bewaren en verwijderen</h2>
    <ul className="list-disc space-y-2 pl-5">
      <li>Accountgegevens zolang het account bestaat, ook na alleen deactiveren; volledige verwijdering is aan te vragen. Deactiveren wist geen account.</li>
      <li>Verwerkte roepingen en ontheffingen: automatische opruiming na 30 dagen. Concepten: na 30 dagen. Lopende dossiers worden niet automatisch gewist; ontheffingen krijgen na 30 dagen een herinnering en na 90 dagen een beoordeling.</li>
      <li>Sessies: maximaal 60 dagen inactiviteit en 180 dagen absoluut. Uitnodigingen: 90 dagen na activering, verlopen of intrekking. Tijdelijke codes en challenges vervallen volgens hun korte geldigheidsduur.</li>
      <li>Beveiligingsmethoden, toestelregistraties, pushregistraties en eigen meldingen verdwijnen bij volledige accountverwijdering. Push kan eerder worden uitgezet. Verwijdercodes worden binnen een dag na vervallen opgeruimd; afgeronde ontvangstbewijzen na 90 dagen.</li>
      <li>Historische procesregistraties worden bij accountverwijdering uitsluitend met concrete motivering ontdaan van de accountidentiteit en tijdelijk aan een niet-toegankelijk auditobject gekoppeld. Dit is pseudonimisering, geen gegarandeerde anonimisering. De normale dossiertermijnen blijven gelden. Zonder grondslag moet beheer eerst het dossier verwijderen of de gegevens verder wissen.</li>
    </ul>
    <p>Dit zijn technische producttermijnen, geen gestelde wettelijke bewaarplichten. De juridische grondslag voor gewone persoonsgegevens én de uitzondering voor bijzondere persoonsgegevens (religieuze context), eventuele wettelijke uitzonderingen, bewaartermijnen van beveiligingslogs, e-mail en back-ups en het wissen na back-upherstel zijn nog door de verantwoordelijke vast te stellen. Deze punten moeten vóór publieke release zijn afgerond.</p>
    <h2 className="font-semibold">Jouw rechten en keuzes</h2>
    <p>Vraag inzage, correctie, beperking, bezwaar of toepasselijke overdraagbaarheid aan bij het bovenstaande contact. Als toestemming de vastgestelde grondslag is, kan die worden ingetrokken. Je kunt een klacht indienen bij de Autoriteit Persoonsgegevens. Workflow-e-mail en push zijn uit te zetten; noodzakelijke verificatiemail blijft nodig voor normale aanmelding.</p>
    <p><Link href="/accountverwijdering" className="underline">Accountverwijdering aanvragen en status bekijken</Link> kan ook vanuit de app bij Profiel → Account en privacy, zonder verplicht te mailen of bellen. Het verzoek geldt voor alle ringen; na identiteitscontrole en noodzakelijke overdracht verwijdert beheer het volledige account. Streeftermijn 14 dagen, status en voltooiing via je ontvangstbewijs. Niet meer kunnen inloggen, ook bij een gedeactiveerd account, verhindert een verzoek niet.</p>
  </section></PublicShell>;
}
