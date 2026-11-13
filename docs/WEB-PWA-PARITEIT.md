# Web/PWA gelijk trekken met de iOS-app

Status: **fase 1 (analyse, §1–§7) en fase 2 (implementatie, §8–§11) zijn afgerond; na de koerswijziging van de eigenaar (§12) is de nieuwe webinterface de enige gebruikersomgeving – zonder featureflag.** Niets is gemerged of gedeployed zonder afzonderlijk akkoord.

Fase 1 – Basis: `main` op `aa071a6`. Uitgangspunt is de iOS-app (`mobile/src`); de webomgeving is `src/app/(app)` (Next.js, Server Actions, sessiecookie).

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

---

## 8. Fase 2 – wat is gebouwd (besluiten eigenaar verwerkt)

Besluiten: optie A; iOS-app leidend; tijdlijn "Voortgang" en de algemene deelknop behouden voor beide platforms; ringbeheerders nodigen uit zoals in de app; beveiligingsbeheer via Profiel → Aanmelden en beveiliging; alles achter `WEB_APP_V2_ENABLED` (standaard uit).

| Onderdeel | Waar |
|---|---|
| Cookie-aanmelding op de API, herkomstcontrole, geen token in JSON | `src/lib/api/auth.ts`, `src/lib/api/router.ts` |
| Webpush en e-mailvoorkeur via de API (alleen cookie) | `src/lib/webPush.ts`, routes `/web-push*`, `/me/email-notifications` |
| E-mailcode voor herverificatie van het eigen account | route `/auth/reauth/request-code` |
| Webomgeving serveren, sessiecontrole, vlag | `src/app/app/route.ts` |
| Doorverwijzen van de oude pagina's (alleen met de vlag, nooit de webmin) | `src/lib/webAppRedirect.ts`, `src/app/(app)/layout.tsx` |
| Web-build van dezelfde client | `mobile/vite.web.config.ts`, `mobile/web.html`, `npm run build:web` → `public/app` (niet in Git) |
| Aanmeldlaag zonder token | `mobile/src/web/WebAuthProvider.tsx`, `webPaths.ts` |
| Profiel in de browser (beveiligingsbeheer, webpush, installeren, e-mailvoorkeur) | `mobile/src/web/WebProfileSections.tsx` |
| Tijdlijn "Voortgang" en "Algemene herinnering delen" (app én web) | `mobile/src/lib/progress.ts`, `share.ts`, `screens/CallingDetail.tsx` |
| Tablet/desktop: hoofdnavigatie links | `mobile/src/styles.css` (`html[data-platform="web"]`) |
| Docker: bundel in de image | `Dockerfile` (stage `webapp`), `.dockerignore` |

Gedrag met de vlag **aan**: een gewone gebruiker die inlogt komt op `/app` (dezelfde schermen als de iOS-app); `/dashboard`, `/roepingen…`, `/gebruikers` en `/profiel` verwijzen door naar hetzelfde scherm; `/profiel/beveiliging`, inloggen, MFA, publieke pagina's en de webmin blijven de bestaande pagina's. Met de vlag **uit**: `/app` geeft 404, de API weigert elke cookie-aanmelding (401) en de bestaande website werkt ongewijzigd. De gebouwde bundel staat wel in de image; het bestand `/app/index.html` is een lege schil zonder gegevens (dezelfde code als in de app).

Wijzigingen die ook de iOS-app raken (in de eerstvolgende app-build, niet in 1.1.2): de tijdlijn "Voortgang" en het menu-item "Algemene herinnering delen" op het voorsteldetail, en een statuslabel dat niet meer midden in een woord afbreekt.

## 9. Beveiligingsbeoordeling cookie-aanmelding (vóór activering door de eigenaar te beoordelen)

**Wat verandert:** `/api/mobile/v1` accepteert, alleen met de vlag, naast het Bearer-token de bestaande HttpOnly-sessiecookie.

| Risico | Maatregel | Test |
|---|---|---|
| CSRF (een andere site laat de browser met de cookie een verzoek doen) | Cookie telt alleen met de eigen header `X-Ringtools-Web: 1` (kan niet door formulier/link/afbeelding; dwingt cross-origin een preflight af die nooit wordt toegestaan), exacte `Origin` = `APP_BASE_URL`, `Sec-Fetch-Site: same-origin` indien aanwezig, minstens één van beide verplicht, JSON-inhoudstype bij POST; cookie blijft `SameSite=Lax` | `tests/webCookieAuth.test.ts` "herkomst en CSRF" (7 afwijkende origins, 3 fetch-sites, ontbrekende headers, 4 inhoudstypen, afwijkende headerwaarden) |
| CORS | Er worden nergens `Access-Control-*`-headers gezet; er is geen OPTIONS-handler | zelfde bestand, "no-store en zonder CORS-headers" |
| Vermenging Bearer/cookie | Eigen header + `Authorization` (welke dan ook) → 400; zonder eigen header wordt een cookie genegeerd | "Geen vermenging" (3 tests) |
| Sessietoken in JavaScript | Cookie is HttpOnly; antwoorden op cookie-verzoeken bevatten nooit `token` (vervangen token → `Set-Cookie`); token-uitgevende en toestelroutes geven 403 `web-not-allowed`; openbare routes zijn standaard dicht | "Het sessietoken komt nooit in JavaScript" (4 tests); Playwright controleert `localStorage`, `sessionStorage` en `document.cookie` |
| MFA/herverificatie omzeilen | Zelfde `getActiveSession` (MFA voltooid); pre-MFA-sessie → 401; gevoelige acties → `reauth-required`; accounts met tweede factor herverifiëren op de bestaande webpagina | "Sessie, MFA en intrekking" (5 tests) |
| Intrekking/deactivering | Ingetrokken sessie, gedeactiveerd account/lidmaatschap, inactieve ring → direct 401/404; uitloggen wist sessie en cookie | idem + Playwright "sessie ingetrokken" en "uitloggen" |
| Rollen en ringisolatie | Ongewijzigde servercontroles; via de cookie getest voor presidium, secretaris, hogeraadslid, ringbeheerder, lid van een andere ring en de beheerder | "Rollen en ringisolatie" (3 tests) + Playwright per rol |
| Beheerdersaccount | 403 op gewone routes, 410 op `/admin/*`, ook via de cookie | 1 test |
| Open doorverwijzing | Bestemming alleen als intern pad (`safeInternalPath`/`safeAppRoute`), voorstel-id alleen als gewoon id | `tests/webAppRedirect.test.ts`, `mobile/tests/webApp.test.tsx` |
| Caches | API `Cache-Control: no-store`; schil `no-store`; serviceworker bewaart alleen iconen, bundels en de offlinepagina | Playwright "geen vertrouwelijke gegevens in caches" (leest de Cache Storage uit) |

**Restpunten voor de beoordelaar:**
1. De herkomstcontrole steunt op `APP_BASE_URL`; die moet in productie exact de publieke oorsprong zijn (schema, host, poort). Staat een reverse proxy ervoor die `Origin` herschrijft of verwijdert, dan weigert de API (fail-closed).
2. `SameSite=Lax` is ongewijzigd gelaten omdat de bestaande e-maillinks naar de website ervan afhangen; de eigen header en de herkomstcontrole zijn de eigenlijke CSRF-bescherming.
3. XSS blijft het belangrijkste restrisico van elke webapp: een script op de eigen oorsprong kan namens de gebruiker verzoeken doen (maar het token niet lezen). Maatregelen: strikte CSP in de schil (alleen eigen scripts, `connect-src 'self'`), geen inline scripts, React-escaping.
4. Aanbevolen: laat §9 en `src/lib/api/auth.ts` door een tweede persoon lezen en draai vóór activering `tests/webCookieAuth.test.ts` en `e2e/webAppV2.spec.ts` tegen een kopie van de productieconfiguratie (achter dezelfde proxy).

## 10. Testresultaten fase 2 (lokaal, synthetische gegevens, testdatabases `ringtools_test`/`ringtools_e2e`)

| Controle | Resultaat |
|---|---|
| Server: `npx vitest run` | 48 bestanden, 726 tests geslaagd (waarvan 28 nieuw voor de cookie-aanmelding, 3 voor doorverwijzen) |
| Server: `npx tsc --noEmit`, `npx eslint .`, `npx next build` | geslaagd (eslint: geen fouten) |
| Client: `npm test` in `mobile/` | 48 bestanden, 440 tests geslaagd (13 nieuw) |
| Client: `npm run typecheck`, `npm run build:web` | geslaagd |
| Playwright, vlag **uit** (bestaande suites) | 53 geslaagd, 42 overgeslagen (horen bij andere vlaggen); twee daarvan slagen alleen als de testserver pushsleutels heeft (omgeving, code ongewijzigd) |
| Playwright, vlag **aan** (`e2e/webAppV2.spec.ts`) | 10 geslaagd: telefoonprofiel (Pixel 7) en desktop (1366 px) |
| iOS-compatibiliteit | alle 62 API-aanroepen van de client van build 1.1.2 bestaan ongewijzigd; `shared/api-types.ts` en `src/lib/api` zijn sinds die build niet gewijzigd op `main`; contracttest groen |
| Docker | daemon hier niet beschikbaar; de nieuwe bouwstap is met dezelfde opdrachten nagespeeld in een schone map (geslaagd) – **de echte image-build is niet uitgevoerd** |

**Gepubliceerde iOS-build:** de TestFlight-upload met versie **1.1.2 (build 11)** is workflow-run 11 van `ios-testflight.yml` op commit **`067b669`** (11 november, "UPLOAD SUCCEEDED"). Run 12 (versie 1.1.3, commit `aa071a6`) is bij het archiveren mislukt. Of build 11 ook de build is die in de App Store staat, is alleen in App Store Connect te zien.

**Niet getest (eerlijk):**
- Geen echt Android-toestel: "Android Chrome" is het Pixel-profiel van Playwright (Chromium met Android-kenmerken). Installeren op het beginscherm, de installatieprompt en het ontvangen van een webpushmelding zijn daardoor niet werkelijk uitgevoerd; wel het manifest, de serviceworker en dat er zonder tik geen toestemming wordt gevraagd.
- Aanmelden met MFA (TOTP/passkey) is niet opnieuw via de nieuwe omgeving doorlopen; die stappen zijn de ongewijzigde webpagina's met hun bestaande tests. De terugkeer na herverificatie naar `/app?to=…` is alleen met unittests gedekt.
- Geen iOS- of Android-build lokaal; dat doet de mobiele CI.
- De openstaande inlogfout van de iOS-app is niet onderzocht en niet geraakt (de Bearer-weg is ongewijzigd).

## 11. Vervolgstappen (niet in fase 2)

1. **Fase 3 – acceptatie** door de eigenaar op een echt Android-toestel en desktop, per rol; daarna pas besluiten over activering.
2. Filters op de voorstellenlijst (de web had negen filterchips; de app heeft er geen): in beide platforms toevoegen als dat gewenst is.
3. Herverificatie met passkey/authenticator-app in de webomgeving zelf (nu: via de bestaande beveiligingspagina en terug).
4. `start_url` van het manifest naar `/app` zodra de vlag definitief aan staat; de oude pagina's in `src/app/(app)` en hun componenten verwijderen na acceptatie.
5. Webpush-tik opent nu het bestaande webadres, dat doorverwijst; rechtstreeks naar `/app` laten wijzen bij het opruimen.
6. Inlogfout iOS-app: afzonderlijk onderzoek.

---

## 12. Koerswijziging (besluit eigenaar, binnen PR #7)

Er zijn nog geen reguliere gebruikers; daarom geen testomgeving, geen tijdelijke oplossingen en **geen featureflags**: de nieuwe web/PWA-interface (dezelfde React-client als de iOS-app) vervangt de bestaande webinterface definitief. De passages hierboven over `WEB_APP_V2_ENABLED` en "vlag uit/aan" zijn daarmee vervallen; ze beschrijven de tussenstand.

| Onderwerp | Nu |
|---|---|
| Vlag `WEB_APP_V2_ENABLED` | verwijderd (code, tests, CI, `.env.example`, documentatie); er is niets in Portainer om aan te zetten |
| Gewone gebruikers | altijd in `/app`; `/login`, `/`, de magic link, MFA en `/open/<token>` leiden daar na inloggen naartoe; manifest `start_url` is `/app` |
| Vroegere adressen | `/dashboard`, `/roepingen`, `/roepingen/<id>`, `/roepingen/nieuw`, `/gebruikers`, `/profiel` blijven als doorverwijzing bestaan (e-mails, pushmeldingen, universele links `/roepingen/*` in `apple-app-site-association`, bladwijzers); elk ander adres in `(app)` gaat voor een gewone gebruiker naar het overzicht |
| Webmin | ongewijzigd: overzicht, ringen (incl. direct toevoegen van gebruikers en voorstellen verwijderen), instellingen, profiel; bovenbalk/onderbalk teruggebracht tot deze vier |
| Behouden | publieke website, `/login`, `/mfa/*`, `/profiel/beveiliging` (TOTP, passkeys, herstelcodes, sessies, vertrouwde toestellen), accountverwijdering, `/open/<token>`, `/uitnodiging/<token>` |
| Verwijderd (vastgesteld ongebruikt) | de vroegere gebruikerspagina's en hun bouwstenen: `NewCallingForm`, `SupportSection`, `TaskRow`, `Timeline`, `GroupDecisionForm`, `WhatsAppShareButton`, `StatCard`, `SubmitButton`, `ConfirmSubmitButton`, `RingSync`, `RingSwitcher`, `NotificationBell`, `NotificationPanel`, `AppBadgeUpdater`, `src/lib/ringContext.ts` (ringcookie van de oude webpagina's), `notification.actions.ts`, de routes `/api/notifications`, `/api/notifications/unread-count`, `/api/badge-count` en de Server Actions voor stemmen, taken, vrijgeven en nieuw voorstel. Methode: importgrafiek vanaf alle routes, layouts en `instrumentation.ts`, plus zoeken in tests/e2e; wat alleen nog door tests werd gebruikt is samen met de bijbehorende test verwijderd |
| Bewust behouden | `MemberList`, `UserForm`, `DeleteCallingButton`, `deleteCallingAction` (ringpagina van de webmin), `push.actions.ts`, `InstallPwaCard`, `PushNotificationCard`, `DeviceList`, `EmailPreferenceForm` (profiel van de webmin) |
| Overgenomen in de nieuwe interface | tijdlijn Voortgang, algemene herinnering delen, app-badge (aantal openstaande acties; verdwijnt bij uitloggen), webpush alleen na een tik, installatiehulp, e-mailvoorkeur |
| Veilig uitloggen (reviewpunt) | zie hieronder |

**Veilig uitloggen.** Eerder ging de browser naar de inlogpagina ook als het intrekken van de sessie op de server mislukt was; de gebruiker dacht dan uitgelogd te zijn terwijl de sessie nog gold. Nu: (1) eerst wordt de pushregistratie van dit apparaat afgemeld (op een gedeeld apparaat mogen meldingen niet bij de vorige gebruiker blijven aankomen), (2) daarna wordt de sessie op de server ingetrokken; mislukt dat (geen verbinding, serverfout) dan blijft de gebruiker ingelogd en ziet hij "Uitloggen is niet gelukt. Je bent nog ingelogd…", een sessie die al ongeldig is (401) telt als uitgelogd, (3) pas na succes wordt de ringkeuze gewist, de badge verwijderd, een bericht naar andere tabbladen gestuurd (die direct naar de inlogpagina gaan) en doorgestuurd naar `/login`, (4) een via de terug-knop uit de bfcache teruggezette pagina wordt herladen, zodat er geen oude gegevens zichtbaar zijn. De server wist de cookie in hetzelfde antwoord waarmee hij de sessie intrekt. Tests: `mobile/tests/webApp.test.tsx` (6), `tests/webCookieAuth.test.ts`, `e2e/webApp.spec.ts`.

**Docker.** De CI bouwt nu bij elke pull request die de image raakt de volledige Docker-image (zonder publicatie), start die tegen de CI-database en controleert gezondheid, `/api/mobile/v1/meta`, de doorverwijzing van `/app` naar de inlogpagina, dat de gebundelde client in de image zit en geserveerd wordt, dat een cookie zonder de eigen header nooit toegang geeft, en dat er geen `.env`-bestanden in de image zitten. Alleen een push naar `main` publiceert.

## 13. Compatibiliteitscontrole iOS 1.1.2 (build 11, commit 067b669) vóór merge

- **Routes:** alle 93 routes van de mobiele API van 067b669 bestaan ongewijzigd (methode + pad); er zijn er 7 bijgekomen (webpush, e-mailvoorkeur, herverificatiecode) die uitsluitend via de sessiecookie werken. Bewaakt door `tests/ios112Compat.test.ts` (fixture `tests/fixtures/ios-1.1.2-routes.txt`).
- **Contract:** `shared/api-types.ts` is sinds 067b669 ongewijzigd. `service.ts`, `management.ts`, `workflow.ts`, `auth.ts`, `mfa.ts`, `session.ts`, `rbac.ts`, `loginMail.ts`, `proxy.ts`, de `.well-known`-bestanden en de pushmodules zijn ongewijzigd.
- **Authenticatie:** de Bearer-weg is ongewijzigd; de cookieweg geldt alleen met de eigen header `X-Ringtools-Web: 1` en een vertrouwde herkomst. Bearer + eigen header geeft 400; een cookie zonder eigen header telt nooit; een Bearer-verzoek negeert een meegestuurde cookie (`tests/webCookieAuth.test.ts`).
- **Verwijderd:** alleen webpagina's, server actions en de web-API's `/api/badge-count`, `/api/notifications`, `/api/notifications/unread-count` (alleen gebruikt door de vervallen webcomponenten; de app gebruikt `/api/mobile/v1`). `/api/session/refresh` en `/api/webauthn/*` (beveiligingspagina's) blijven bestaan.
- **Vlag:** `WEB_APP_V2_ENABLED` is nergens meer in de code of configuratie aanwezig; eerdere paragrafen in dit document beschrijven de oude fasering.
- **Niet getest:** geen fysiek toestel; Face ID/Secure Enclave, APNs-levering en Universal Links zijn alleen via code, servertests en de gebundelde client in een desktopbrowser gecontroleerd.
