# Web/PWA gelijk trekken met de iOS-app – fase 1: verschillen en architectuurvoorstel

Status: **alleen analyse en voorstel; er is niets geïmplementeerd.** Basis: `main` op `aa071a6`. Uitgangspunt is de iOS-app (`mobile/src`); de webomgeving is `src/app/(app)` (Next.js, Server Actions, sessiecookie).

## 1. Samenvatting

De iOS-app en de webomgeving zijn twee los van elkaar ontwikkelde gebruikersinterfaces op dezelfde backend. De web is functioneel blijven staan op de stand van vóór de fasen C2–C5 en de UX-/iOS 26-rondes: ze mist hele onderdelen (ontheffingen, concepten met catalogus, uitnodigingen, ringinrichting) en gebruikt andere termen, navigatie en vormgeving. De beveiliging van de web (HttpOnly-sessiecookie, e-mailcode, MFA, herverificatie) is op orde en blijft.

Voorstel in één zin: **laat de bestaande React-client van de app (`mobile/src`) ook in de browser draaien als de beveiligde webomgeving, met de sessiecookie in plaats van een token**, zodat er één gebruikersinterface is die niet meer uit elkaar kan groeien. Inloggen, MFA, de publieke pagina's en de webmin blijven de bestaande Next.js-pagina's.

## 2. Verschillenoverzicht

Legenda: ✅ gelijk · ◐ aanwezig maar anders · ✗ ontbreekt op de web.

### 2.1 Navigatie en opbouw

| Onderdeel | iOS-app | Web nu | |
|---|---|---|---|
| Hoofdnavigatie | 5 tabs: Overzicht, Voorstellen, Beheer (alleen ringbeheerder), Meldingen, Profiel | Bovenbalk + onderbalk: Dashboard, Roepingen (alleen staf), Gebruikers, Ringen, Instellingen, Profiel | ◐ andere namen, volgorde en iconen (tekens ⌂ ☰ ⚇) |
| Meldingen | eigen tab met teller | bel in de bovenbalk met paneel | ◐ |
| Voorstellen voor hogeraadsleden | tab Voorstellen voor iedereen (eigen zichtbaarheid) | geen lijst; alleen via het dashboard | ✗ |
| Diepere schermen | navigatiebalk met terugknop, titel | geen terugknop; browser-terug | ◐ |
| Ringwisselaar | in Profiel | in de bovenbalk | ◐ |
| Uitloggen | Profiel, met bevestiging | knop in de bovenbalk, zonder bevestiging | ◐ |
| Secundaire acties | contextmenu (⋯) bij rij/kaart | knoppen en formulieren op de pagina, deels onderaan | ◐ |
| Bevestigen | één app-dialoog | losse bevestigknoppen (`ConfirmSubmitButton`) | ◐ |
| Formulier bij een rij | sheet | uitklappend formulier in de lijst | ◐ |

### 2.2 Schermen en functies

| Functie | iOS-app | Web nu | |
|---|---|---|---|
| Overzicht | "Wacht op jouw reactie", "Stand van zaken", "Aandachtspunten", "Jouw taken"; geen knoppen | "Welkom, naam"; 8 tegels met filters; "Vraagt aandacht"; zwevende knop "+ Nieuwe roeping"; apart hogeraadsoverzicht | ◐ |
| Voorstellenlijst | voorstellen én ontheffingen in één lijst met typelabel; concepten; knoppen Nieuw voorstel / Nieuwe ontheffing | "Roepingen" met 9 filterchips; geen ontheffingen, geen concepten | ◐ |
| Nieuw voorstel | concept: naam → organisatie → roeping uit catalogus/eigen roeping → verantwoordelijken (voorgesteld en bevoegdheid door de server gecontroleerd) → indienen | één formulier met vrije tekst voor de functie en een vinkje "procedure gecontroleerd"; geen catalogus, geen concept | ✗ belangrijkste functionele gat |
| Voorsteldetail | status, rondes, ondersteunen/niet ondersteunen, herinneren, opnieuw vragen, deelnemer verwijderen, vrijgeven aan hoge raad, vrijgeven uitvoering, gezamenlijk besluit, taken, verwerken, verwijderen | dezelfde handelingen aanwezig (Server Actions), andere indeling en termen; extra: tijdlijn "Voortgang" en WhatsApp-deelknop | ◐ |
| Ontheffingen (lijst, formulier, detail, kennisgeving, beoordeling, vrijgave, stemmen, gezamenlijk besluit) | volledig | niet aanwezig | ✗ |
| Meldingen | lijst, gelezen markeren, openen | paneel, gelezen markeren | ◐ |
| Gebruikersbeheer | uitnodigen (status, opnieuw versturen, intrekken, wijzigen), inlogmail opnieuw sturen, rol/functie/machtiging, toegangsstatus | "Gebruiker toevoegen" (direct, zonder uitnodiging) en bewerken | ✗ uitnodigingen ontbreken; direct toevoegen wijkt af van de app-regel |
| Ringinrichting (wijken/gemeenten, hogeraadskoppeling, eigen roepingen, catalogusoverzicht, kerkelijke functies, aanstellingsbevoegdheid) | volledig (tab Beheer → Inrichting) | niet aanwezig | ✗ |
| Profiel | naam, ring(wisselaar), pushmeldingen, "Aanmelden en beveiliging", aangemelde toestellen, account en privacy | Profiel + aparte pagina Beveiliging (TOTP, passkeys, herstelcodes, vertrouwde toestellen, sessies), installatiekaart, webpush, e-mailvoorkeur | ◐ web heeft meer beveiligingsbeheer; app heeft de eenvoudigere indeling |
| Herverificatie voor gevoelige acties | in-app (`Reauth`) | aparte pagina `/profiel/beveiliging/herverifieer` | ◐ |
| Uitnodiging openen | automatisch na inloggen met e-mailcode | landingspagina `/uitnodiging/<token>` (informatief) | ◐ |
| Koppeling uit e-mail/push (`/open/<token>`) | opent het juiste scherm | webpagina `/open/<token>` | ✅ |
| Accountverwijdering / privacy | in de app | `/accountverwijdering` | ✅ |

### 2.3 Terminologie

| iOS-app | Web nu |
|---|---|
| Overzicht | Dashboard |
| Voorstellen / Voorstel | Roepingen / Roeping ("+ Nieuwe roeping", "Geen roepingen in dit overzicht") |
| Wacht op jouw reactie / Jouw reactie | Jouw openstaande ondersteuningsverzoeken / Ondersteuning uitbrengen |
| Aandachtspunten | Vraagt aandacht |
| Beheer (Gebruikers, Inrichting) | Gebruikers / Gebruikersbeheer |
| Statuslabels met symbool (✓ ! ✕) | gekleurde badges zonder symbool |

### 2.4 Vormgeving

De web gebruikt Tailwind-klassen met een oudere set tokens (`src/app/globals.css`, 287 regels); de app het iOS 26-designsysteem (`mobile/src/styles.css`, 436 regels: glas voor bediening, effen inhoud, capsules, schakelaars, statussymbolen, verhoogd contrast, minder transparantie/beweging). Componenten als `ActionMenu`, `Sheet`, de bevestigingsdialoog, `StatusLabel`, `PageHead` en `Segmented` bestaan alleen in de app.

### 2.5 Wat alleen op de web bestaat (keuze nodig, zie §6)

- Webmin: Ringen en Instellingen (blijft apart; valt buiten deze opdracht).
- Beveiligingsbeheer: TOTP instellen, passkeys beheren, herstelcodes, koppelcode voor een vertrouwd toestel.
- Tijdlijn "Voortgang" op het voorsteldetail, filterchips op de lijst, WhatsApp-deelknop.
- PWA-installatiekaart, webpush (VAPID) met apparatenlijst, e-mailvoorkeur.

### 2.6 Wat alleen in de app kan en op de web niet eerlijk te bieden is

Face ID/Touch ID-appvergrendeling, afscherming in de app-switcher, snel aanmelden met een toestelsleutel, native push (APNs). De web krijgt hiervoor geen nabootsing: de browser biedt geen screenshotblokkering en geen betrouwbare biometrische appvergrendeling. Passkeys (WebAuthn) blijven op de web de sterke tweede factor.

## 3. Architectuuropties

| | A. De app-client ook als webomgeving | B. Gedeeld componentpakket, twee datalagen | C. Alleen tokens/CSS delen, web herschrijven |
|---|---|---|---|
| Wat | `mobile/src` wordt met een web-buildprofiel gebundeld en door Next.js geserveerd; praat met dezelfde `/api/mobile/v1` via de sessiecookie | componenten naar een gedeelde map; web blijft Server Components + Server Actions | Next.js-pagina's één voor één nabouwen in de nieuwe stijl |
| Eén UI | ja: zelfde schermen, teksten, volgorde | deels: componenten gelijk, schermen en datalogica dubbel | nee: groeit opnieuw uit elkaar |
| Werk | klein tot middel (platformlaag, cookie-auth op de API, hosting, webpush) | groot (elk scherm twee keer aansluiten) | groot en blijvend dubbel |
| Risico | cookie-authenticatie op de API moet zorgvuldig (CSRF); eerste weergave is client-side | veel regressierisico in bestaande webpagina's | hoogste onderhoudslast |
| iOS-contract | ongewijzigd (alleen toevoegingen) | ongewijzigd | ongewijzigd |

**Aanbeveling: optie A.** De client is al een gewone React/Vite-webbundel die uitsluitend via de API werkt; alle native onderdelen zitten achter smalle lagen (`lib/native.ts`, `storage.ts`, `appLock`, `nativeTabBar`, `push`, `buildProfile`). De webbalk, de Android-terugknop en de terugval zonder plug-ins bestaan al en zijn getest.

## 4. Uitwerking van optie A

### 4.1 Authenticatie en sessie (geen token in JavaScript)

- Inloggen, e-mailcode, magic link, MFA (TOTP/passkey), herstelcodes en herverificatie blijven de bestaande Next.js-pagina's en Server Actions; de sessie blijft de bestaande **HttpOnly, Secure, SameSite=Lax**-cookie. Er komt geen token in `localStorage`, `sessionStorage` of de serviceworker.
- `/api/mobile/v1` accepteert naast het Bearer-token ook de sessiecookie, **uitsluitend** als alle volgende voorwaarden gelden (anders 401/403):
  1. er is geen `Authorization`-header (geen vermenging van de twee wegen);
  2. `Origin` (of bij ontbreken `Sec-Fetch-Site: same-origin`) is exact `APP_BASE_URL`;
  3. een vaste eigen header (bijv. `X-Ringtools-Web: 1`) is aanwezig, zodat een formulier of afbeelding van een andere site nooit een geldig verzoek is;
  4. dezelfde sessiecontrole als de web (`getActiveSession`: MFA voltooid, niet ingetrokken, account actief).
- De webclient krijgt nooit een token terug: routes die een token uitgeven (`/auth/login`, `/auth/device/*`, `/auth/refresh`, `/invitations/activate` met sessie) zijn voor cookie-verzoeken afgesloten. Verlengen loopt via het bestaande `/api/session/refresh`.
- Het beheerdersaccount blijft op alle gewone routes geweigerd (403) en `/admin/*` blijft `410`; de webmin houdt zijn eigen pagina's.
- Herverificatie: bij `reauth-required` gaat de webclient naar de bestaande pagina `/profiel/beveiliging/herverifieer` en keert terug naar het scherm.
- Bestaande Bearer-clients (App Store-versie) merken niets: het contract in `shared/api-types.ts` en alle bestaande routes blijven ongewijzigd; alleen toevoegingen.

### 4.2 Platformlaag in de client

Eén schakelpunt "platform = ios | android | web" (bestaat al in `lib/native.ts`). Voor web:

| Onderdeel | Web-gedrag |
|---|---|
| Sessie | geen opslag; "ingelogd" = `GET /me` slaagt met de cookie; 401 → naar `/login?redirect=…` |
| Appvergrendeling, privacyscherm, biometrie, toestelsleutel, snel aanmelden | niet gemonteerd; geen tekst die dit belooft |
| Tabbalk | React-balk (bestaat); op brede schermen een zijbalk/bovenbalk met dezelfde vijf items |
| Push | webpush via de bestaande serviceworker en VAPID, alleen na toestemming; nieuwe kleine API-routes voor aan-/afmelden (nu Server Actions) |
| Deeplinks | gewone URL's; bestaande webpaden (`/roepingen/<id>`, `/open/<token>`) verwijzen door naar het bijbehorende scherm |
| Login-/activatieschermen van de app | niet gebruikt op de web (Next.js-pagina's blijven) |

### 4.3 Hosting en routes

- Web-build van de client (`vite build` met basis `/app/`) wordt in de Docker-build meegenomen en door Next.js geserveerd; alle paden onder `/app/…` leveren dezelfde `index.html` (na servercontrole van de sessie, anders door naar `/login`).
- Achter een vlag `WEB_APP_V2_ENABLED` (standaard **uit**): zonder de vlag verandert er in productie niets, ook niet na een merge (Watchtower). Met de vlag verwijzen `/dashboard`, `/roepingen…`, `/gebruikers` en `/profiel` voor gewone gebruikers door naar de nieuwe omgeving; de oude pagina's worden pas verwijderd na acceptatie (fase 3) en jouw akkoord.
- Webmin (`/ringen`, `/instellingen`), publieke pagina's, `/login`, `/mfa/*`, `/auth/magic/*`, `/uitnodiging/*`, `/accountverwijdering` blijven ongewijzigd.

### 4.4 PWA en privacy

- Manifest: `start_url` naar de nieuwe omgeving (alleen met de vlag); installatie op het beginscherm blijft werken (Chrome op Android).
- Serviceworker blijft terughoudend: alleen statische, niet-vertrouwelijke bestanden (iconen, bundels, offlinepagina); API-antwoorden en navigaties worden nooit gecachet; API-antwoorden krijgen `Cache-Control: no-store`. Een test bewaakt dat `/api/` en paginadata nooit in de cache komen.
- Offline: duidelijke offlinemelding (bestaat in de client), geen opgeslagen gegevens.
- Responsief: telefoon (onderbalk), tablet en desktop (bredere inhoud, navigatie aan de zijkant/bovenkant), zelfde componenten.

### 4.5 Tests

- Backend: cookie-authenticatie op de API (alle weigergevallen: andere origin, ontbrekende header, Bearer + cookie, pre-MFA-sessie, ingetrokken sessie, gedeactiveerd account, beheerder), ringisolatie en rolrechten via de cookie-weg, geen token in antwoorden.
- Client: bestaande 400+ tests blijven; nieuw voor het web-profiel (geen vergrendeling, geen opslag, 401 → login, webpush, navigatie op brede schermen).
- Playwright: bestaande suites (auth, MFA, sessies, stemmen, vergadering, PWA) blijven groen; nieuw per rol (presidium, secretaris/administrateur, hogeraadslid, ringbeheerder) voor de hoofdstromen, in een Android Chrome-profiel (Pixel) en op desktop.
- iOS-compatibiliteit: contracttest (`tests/api.test.ts`) ongewijzigd groen; mobiele CI (iOS-simulator, Release-archive, Android-debug) blijft draaien.

## 5. Fasering

1. **Fase 1 (dit document).**
2. **Fase 2a – fundament:** cookie-authenticatie op de API met tests; web-buildprofiel en platformlaag; hosting achter de vlag.
3. **Fase 2b – gelijk trekken:** webpush en apparaten, herverificatie, doorverwijzingen, brede schermen; beveiligingsbeheer bereikbaar vanuit Profiel.
4. **Fase 3 – acceptatie:** rol-voor-rol vergelijking iOS ↔ web (Android Chrome en desktop), verschillenlijst nalopen, PR met resultaten. Geen merge, geen deployment, geen App Store-upload zonder jouw akkoord.

## 6. Beslissingen voor de eigenaar

1. **Architectuur:** akkoord met optie A (de app-client als webomgeving, met cookie-authenticatie op de API onder de voorwaarden van §4.1)?
2. **Web-eigen onderdelen:** vervallen de tijdlijn "Voortgang", de filterchips, de dashboardtegels en de WhatsApp-deelknop (de app is leidend), of moeten er onderdelen in beide omgevingen komen?
3. **Direct toevoegen van gebruikers** op de web vervalt voor ringbeheerders ten gunste van uitnodigen, zoals in de app (de webmin houdt direct toevoegen)?
4. **Beveiligingsbeheer** (TOTP, passkeys, herstelcodes): blijft op de bestaande webpagina, bereikbaar vanuit Profiel → "Aanmelden en beveiliging"?
5. **Vlag en overgang:** nieuwe omgeving achter `WEB_APP_V2_ENABLED` (standaard uit), oude pagina's blijven tot na acceptatie?

## 7. Niet geverifieerd in deze fase

- De schermen zijn vergeleken op basis van de code, niet op een draaiende installatie of toestel.
- "App Store-versie 1.1.2": het project staat in de repository nog op versie 1.0; welke API-aanroepen die versie precies doet is afgeleid van de huidige client. De borging is dat bestaande routes en typen ongewijzigd blijven.
