# AGENTS.md – Ringtools

Centrale bron van waarheid voor alle AI-codingagents (Codex, Claude Code, enz.) en ontwikkelaars.
Lees dit bestand volledig vóór je iets wijzigt. Bij tegenstrijdigheid met een ander document gaat dit bestand voor,
tenzij de eigenaar uitdrukkelijk anders heeft opgedragen. (Bij de invoering van dit bestand bestonden er geen andere
`AGENTS.md`/`CLAUDE.md`; voeg bij een nieuw instructiebestand de inhoud hier samen i.p.v. een tweede bron te maken.)

## Koers: app-first (permanent, door de eigenaar vastgesteld)

- **Ringtools is app-first.** De native apps voor **iOS en Android (Capacitor)** zijn het hoofdproduct en de primaire gebruikersplatforms.
- **De publieke website (`ringapeldoorn.nl`) is uitsluitend informatief** (uithangbord): uitleg, privacy, contact, accountverwijdering,
  later links naar de stores. Geen vertrouwelijke gegevens, geen ingelogde gebruikersinterface.
- **Nieuwe gebruikersfunctionaliteit wordt voor de native app gebouwd, niet voor de publieke website.** Webvarianten zijn alleen
  toegestaan voor technisch beheer door `webmin`, en alleen met een vastgelegde reden.
- **De backend blijft centraal** (Next.js + PostgreSQL op de bestaande Synology NAS, Docker, poort 2809). Next.js blijft beschikbaar voor
  de mobiele API en eventueel een streng beveiligd technisch beheer (alleen `webmin`, verplichte TOTP). Dit is geen alternatief gebruikersportaal.
- **Beveiliging, tenantisolatie en MFA worden nooit verzwakt** – ook niet om iets sneller af te krijgen of voor platformcompatibiliteit.
- **Functionele volledigheid gaat vóór visuele verfijning.** Vormgeving komt later.
- **De bestaande webapp wordt uitsluitend via een gecontroleerde, gefaseerde migratie uitgeschakeld** (zie `docs/MIGRATIE-APP-ONLY.md`).
  De definitieve omschakeling gebeurt **nooit** zonder aparte, expliciete opdracht van de eigenaar. Tot die tijd blijft de webapp bereikbaar.
- **Elke wijziging houdt rekening met iOS én Android.** Een wijziging is pas afgerond wanneer de relevante platformtests zijn uitgevoerd
  of expliciet is vastgelegd waarom een test niet mogelijk was.
- **De `App-PersonalTeam`-configuratie voor iPhone-tests (gratis Personal Team) blijft behouden** en werkend (zie "Permanente lessen").
- Wijzigingen aan authenticatie, notificaties, navigatie, e-maillinks, opslag of API-contracten worden altijd expliciet op native
  compatibiliteit beoordeeld.
- Gebruik de productieconfiguratie van Capacitor niet als eenvoudige externe-websitewrapper. De apps gebruiken gebundelde assets en veilige
  toegang tot de bestaande Ringtools-backend.

## Platformen en functieoverzicht

Primair: **iOS** (`mobile/ios`) en **Android** (`mobile/android`), beide met dezelfde gebundelde React-client (`mobile/src`).
Daarnaast bestaan: de **publieke website** (informatief) en de **technische beheeromgeving** (webmin-only noodtoegang).
De huidige Next.js-webapp (`src/app`) is een **overgangsvoorziening** voor bestaande gebruikers tot de gecontroleerde omschakeling.

Legenda: ✅ aanwezig · 🔧 in uitvoering/gepland (fase) · — bewust niet · ⚠ overgang (webapp, wordt uitgefaseerd)

| Functie | iOS | Android | Publieke website | Technisch beheer (webmin, web) |
|---|---|---|---|---|
| Informatie over Ringtools, privacy, contact, accountverwijdering | ✅ (links) | ✅ (links) | 🔧 E | — |
| Inloggen met e-mailcode | ✅ | ✅ | — (na omschakeling) | — |
| Native passkeys / volledige MFA voor gebruikers | 🔧 C5.2 voorbereid: server/API/tests klaar, functievlag UIT, geen plug-in gekoppeld (niet in PersonalTeam) | 🔧 C5.2 voorbereid (idem) | — | — |
| Webmin-login: wachtwoord + verplichte TOTP | ✅ B (toesteltest open) | ✅ B (toesteltest open) | — | ✅ |
| Roepingen bekijken, ondersteunen (stemmen) | ✅ | ✅ | ⚠ | — |
| Nieuw voorstel, verantwoordelijken, herinneren, opnieuw vragen, rondes beheren | ✅ A (toesteltest open) | ✅ A (toesteltest open) | ⚠ | — |
| Taken toewijzen/afronden, verwerken, definitief verwijderen | ✅ A (toesteltest open) | ✅ A (toesteltest open) | ⚠ | — |
| Gebruikersbeheer binnen eigen ring (ringbeheerder) | ✅ B (toesteltest open) | ✅ B (toesteltest open) | ⚠ | — |
| Ringbeheer: ringen aanmaken/wijzigen/(de)activeren (alleen webmin) | ✅ B (toesteltest open) | ✅ B (toesteltest open) | — | ✅ (aanmaken/wijzigen; activeren alleen in de app) |
| Eerste ringbeheerder van een nieuwe ring aanwijzen (webmin) | ✅ B (toesteltest open) | ✅ B (toesteltest open) | — | ✅ |
| Wijken/gemeenten, hogeraadskoppeling, ringinrichting, roepingencatalogus, eigen roepingen, aanstellingsbevoegdheid | ✅ C2 (toesteltest open) | ✅ C2 (toesteltest open) | — | ✅ (via app-beheer) |
| Nieuw voorstel via concept (naam → unit → roeping → verantwoordelijken), servercontrole bevoegdheden en eigen roepingen | ✅ C3 (toesteltest open) | ✅ C3 (toesteltest open) | — | — |
| Gestructureerde kerkelijke functies (ringpresident, eerste/tweede raadgever, …), machtigingen, voorgestelde bevoegde uitvoerders, catalogusoverzicht onder Inrichting | ✅ C4.5 (toesteltest open) | ✅ C4.5 (toesteltest open) | — | ✅ (via app-beheer) |
| Uitnodigen en activeren van nieuwe gebruikers (ringbeheerder nodigt uit; activatie met link of e-mail + code; geen sessie bij activatie) | ✅ C5.1 (toesteltest open) | ✅ C5.1 (toesteltest open) | informatieve landingspagina `/uitnodiging/<token>` | ✅ (webmin, via app-beheer) |
| Ontheffingen (aparte module; vertrouwelijk, betrokkene heeft geen toegang) | ✅ C4 (toesteltest open) | ✅ C4 (toesteltest open) | — | — |
| Meldingen in de app (bel) | ✅ | ✅ | ⚠ | — |
| Native push (APNs/FCM) | ✅ (niet in PersonalTeam) | ✅ | — | — |
| Universal Links / App Links | ✅ (niet in PersonalTeam) | ✅ | `.well-known`-bestanden | — |
| Sessies en apparaten beheren, sessie-intrekking op afstand | ✅ (ook webmin) | ✅ (ook webmin) | ⚠ | ✅ |
| SMTP/instellingen, MFA-reset, noodprocedures | — | — | — | ✅ |

Houd deze tabel actueel bij iedere functionele wijziging. Verplaatsen van webfunctionaliteit naar de app: API-route + gedeelde types + tests +
bijwerken van deze tabel en van `docs/MOBILE.md`.

## Architectuur

- **Eén centrale backend** (Next.js 16 + Server Actions voor de webapp, JSON-API voor mobiel), **één PostgreSQL-database**
  (Prisma), **één gedeelde bedrijfslogica** (`src/lib/workflow.ts`, `rbac.ts`, `queries.ts`, `notifications.ts`, `rings.ts`).
- Gescheiden frontends waar technisch nodig: `src/app` (webapp, SSR, Server Actions, sessiecookies) en `mobile/src`
  (statisch gebundelde React-client voor Capacitor).
- **Mobiele API:** `/api/mobile/v1/…` (`src/lib/api/router.ts`, `service.ts`, route `src/app/api/mobile/v1/[...path]`).
  Versieerbaar via `API_VERSION`/`MIN_APP_VERSION` en `GET /meta`. De API roept dezelfde `workflow.ts`-functies aan als de
  Server Actions; **nooit** workflow-/autorisatieregels dupliceren in de API of de client.
- **Gedeelde types/contract:** `shared/api-types.ts` wordt door server (`@shared/…`) én mobiele client gebruikt. Een
  contracttest (`tests/api.test.ts`, "API-contract") borgt dat de server eraan voldoet. Wijzig types alleen
  achterwaarts-compatibel of verhoog `API_VERSION`.
- Mobiele clients praten **uitsluitend** via de API met de backend. Geen directe databaseverbinding vanuit mobiel,
  geen afzonderlijke database per platform, geen Server Actions vanuit Capacitor.
- Alle gevoelige bewerkingen blijven server-side. De client toont en vraagt; de server beslist.
- Capacitor-productieconfiguratie: gebundelde assets (`webDir: dist`), **geen `server.url`**, lege `allowNavigation`
  (wordt afgedwongen door `npm run check:native-config`).
- Bestaande Docker-deployment, poort **2809** en `docker-compose.yml` blijven behouden. Werk de Portainer-stack van de
  eigenaar nooit automatisch bij. Gebruik nooit force-push.

## Beveiliging (niet onderhandelbaar)

- Multi-tenancy en ringisolatie zijn verplicht: elke query/actie is gebonden aan een ring waarin de gebruiker een
  **actief** lidmaatschap heeft; de ring-keuze van de client wordt nooit vertrouwd zonder server-side controle.
- Elke API-route controleert identiteit (bearer-sessie via `authenticate`) én bevoegdheden binnen de juiste ring.
- MFA blijft behouden: het beheerdersaccount (webmin) en gebruikers met passkey-verificatie kunnen niet via de
  mobiele code-login inloggen (`/auth/login` weigert dit). Een pre-MFA-sessie wordt nooit een volledige sessie zonder
  bewijs van de tweede factor in dezelfde sessie (`Session.factorProvedAt`).
- Geen tokens, wachtwoorden of sleutels in broncode, logs, analytics of URL's. Geen `.p8`/`.p12`/keystore/
  `google-services.json`/`GoogleService-Info.plist` in git (zie `mobile/.gitignore`; `check:native-config` faalt erop).
- Geen gevoelige persoonsgegevens in pushmeldingen: alleen generieke tekst en een intern pad
  (`safeInternalPath`/`parseTarget`).
- Native sessietokens uitsluitend in Keychain/Keystore (`mobile/src/lib/storage.ts`). Nooit localStorage/sessionStorage
  voor gevoelige gegevens. Geen vertrouwelijke gegevens onversleuteld offline opslaan.
- Geen onveilige WebView-bridges of willekeurige externe navigatie; links worden alleen op de eigen host en bekende
  paden herkend. Geen authenticatiebypass vanuit de native app (ook niet voor reviewers).
- Open redirects voorkomen; eenmalige tokens niet lekken (niet loggen, niet in analytics, niet doorsturen).

## Permanente lessen (uit eerdere audits; niet opnieuw maken)

- **Geen React-state of opslagacties tijdens het renderen.** Statewijzigingen, `selectRing`, opslag en netwerkacties horen in een
  `useEffect`/event-handler, met een controle of de waarde daadwerkelijk verandert (zie `CallingDetail.tsx`).
- **Native pushlisteners nooit ongericht verwijderen.** Gebruik nooit `PushNotifications.removeAllListeners()` (of vergelijkbaar);
  beheer alleen de listener-handles die een functie zelf registreert en verwijder precies die. De `pushNotificationActionPerformed`-
  listener (tikken op een melding) moet in elke app-toestand blijven bestaan (`lib/deeplinks.ts`).
- **Geen aanbevelingen om MFA uit te schakelen voor platformcompatibiliteit.** Ontbrekende native MFA-ondersteuning krijgt een veilige
  melding ("log in via de webapp"), nooit het advies de beveiliging te verlagen (zie `docs/PASSKEYS-NATIVE.md`).
- **Mobiele CI moet ook relevante backendwijzigingen dekken.** `mobile-ci.yml` draait bij wijzigingen in `src/lib/api/`, `auth.ts`,
  `nativePush.ts`, `openLinks.ts`, `src/app/api/mobile/`, `src/app/.well-known/`, `prisma/`, `tests/` en dit bestand; voeg nieuwe
  mobiele backendbestanden meteen aan de paden en de backend-job toe.
- **Native pushproviders worden met hun officiële protocollen getest.** FCM: OAuth 2.0-serviceaccount (JWT bearer) als
  `application/x-www-form-urlencoded`, tokencache/-vernieuwing, 401-retry. APNs: ES256-provider-token, HTTP/2 met `apns-topic`. Test de
  echte requestheaders en -body (niet alleen gemockte succesresponses) en de echte transportlaag. Een geslaagde levering mag pas
  worden geclaimd na verificatie met echte sleutels en een fysiek toestel.
- **App Store- en TestFlight-configuraties worden afzonderlijk gevalideerd.** TestFlight en de App Store gebruiken productie-APNs
  (`APNS_PRODUCTION=true`, `aps-environment=production` in de IPA); sandbox is alleen voor rechtstreekse Xcode-builds. Valideer
  development, TestFlight en store-release apart; pushsleutels staan alleen op de server, nooit in GitHub.
- **iOS-testconfiguratie voor een gratis Personal Team** (`Debug-PersonalTeam`, scheme `App-PersonalTeam`, `ios/PersonalTeam.xcconfig`) is
  een aparte configuratie zonder entitlements. Haal Push/Associated Domains **nooit** uit `Debug`/`Release` of `App/App.entitlements`
  voor deze test, en gebruik de Personal Team-configuratie nooit voor TestFlight/App Store. Code die push/links gebruikt moet het
  buildprofiel (`lib/buildProfile.ts`) respecteren en zonder die capabilities nooit crashen of blijven hangen. Wijzigingen aan het
  iOS-project of de entitlements: draai `npm run check:native-config` en `scripts/verify-ios-configs.sh` (CI doet dat op macOS).
- Elke uitzondering in opstartcode moet in een eindtoestand eindigen (uitgelogd, ingelogd of "niet beschikbaar + opnieuw proberen"),
  nooit in een eeuwig laadscherm (zie `lib/resume.ts`); netwerkverzoeken hebben een time-out.

- **Webmin-API en gebruikers-API blijven gescheiden.** Gewone routes weigeren het beheerdersaccount (403) en `/admin/*` weigert gewone
  gebruikers; het wachtende token na het wachtwoord werkt nergens als sessie. Gevoelige beheeracties (gebruikers, ringen) vereisen een recente
  tweede factor (`reauth-required` → herverificatie). Een gedeactiveerde ring (`Ring.active`) is voor niemand toegankelijk behalve voor de webmin;
  bij nieuwe lidmaatschapscontroles altijd `ring: { active: true }` meenemen.

- **Workflowregels (vastgesteld door de eigenaar).** Een lege hoge raad leidt nooit tot goedkeuring; presidiumakkoord start de hogeraadronde nooit
  automatisch (status `PRESIDIUM_APPROVED` → expliciete, idempotente vrijgave met audit); gezamenlijke besluiten leggen een werkelijk genomen besluit vast
  en maken nooit reacties namens anderen aan; negatieve reacties worden nooit stilzwijgend overschreven. LCR blijft de bron voor ledengegevens en
  roepingen: bewaar geen blijvend personenregister en importeer nooit persoonsgegevens uit LCR (alleen functietitels).

- **Catalogus en bevoegdheden.** Onbekende regels zijn `ONBEKEND`/`TE_BEOORDELEN`, nooit de ruimste standaardbevoegdheid; alleen `GEVERIFIEERD` kent (expliciet aangewezen) personen bevoegdheid toe, en
  een Ringtools-rol of kerkelijke functie is nooit een machtiging. Nieuwe voorstellen lopen uitsluitend via concepten (`/drafts`) met server-side validatie bij indienen (idempotent); een eigen of niet-geverifieerde
  roeping vereist altijd de bevestigde procedurecontrole. Wijzigingen aan de catalogus: draai `npm run catalog:review` (test bewaakt `docs/CATALOGUS-CONTROLE.md`).

- **Ontheffingen zijn vertrouwelijk.** Koppel een betrokkene nooit automatisch op naam aan een account; de staf identificeert het account expliciet (`OntheffingPerson.accountMode`). Een gekoppeld account heeft nergens
  toegang (detail, lijst, aantallen, melding, push, deeplink). Gebruik voor elke nieuwe ontheffingsroute `loadAccess`/`visibleWhere` in `src/lib/ontheffingen.ts` en `notify({ ontheffingId })`; stuur nooit e-mail of
  namen/functies in meldingen. Hoe een betrokken hogeraadslid na kennisgeving deelneemt is een OPEN vraag voor de eigenaar (`docs/MIGRATIE-APP-ONLY.md`); verzin geen kerkelijke regel.
- **Ontheffing van een hogeraadslid: eerst persoonlijke kennisgeving** (server-side blokkade in de vrijgave), de betrokkene blijft daarna toch uitgesloten. Functies met een procedure buiten Ringtools (ringpresident, raadgevers ringpresidium,
  ringpatriarch, bisschop) zijn nooit als eigen roeping te gebruiken (`isOutsideRingtoolsFunctionName`); raadgevers in een bisschap wel. Lopende ontheffingsdossiers worden nooit automatisch verwijderd (herinnering 30 / beoordeling 90 dagen).
- **Meldingen na een gelukte opslag zijn herstelbaar** (claim + lease + `skipExisting`), nooit "opslaan en hopen". Achteraf wijzigen volgt de bij indienen vastgelegde procedure (`procedureSnapshot`).

- **Kerkelijke functie ≠ Ringtools-rol ≠ machtiging (C4.5).** De rol (`RingMembership.role`) regelt toegang en gebruikersbeheer. De gestructureerde functie (`churchFunctionCode`, `src/lib/churchFunctions.ts`) bepaalt wat volgens de geverifieerde
  handboekprocedure mogelijk is; de ringpresident is op grond van zijn functie bevoegd, een aangewezen raadgever/hogeraadslid heeft daarnaast een expliciete machtiging (`appointAuthority`) nodig. Alles wat onzeker is (functie `ONBEKEND`, functie die niet
  bij de rol past, ontbrekende machtiging) is niet bevoegd (fail-closed); bevoegdheid wordt nooit automatisch toegekend, ook niet bij migratie. Een wijkkoppeling van een hogeraadslid is nooit een machtiging. Bevoegde leden en externe uitvoerders (zonder Ringtools-account)
  blijven gescheiden. Gebruik uitsluitend `eligibleForRule`/`authorityClassOf` voor bevoegdheidsvragen.
- **Uitnodigingen (C5.1).** Eén accountsysteem: een uitnodiging (`RingInvitation`, alleen hashes van token en code, 7 dagen geldig) maakt bij activatie een gewoon account + lidmaatschap aan of koppelt een bestaand account aan een extra ring, zonder naam, e-mail of beveiliging van dat account te wijzigen.
  Een uitnodiging legt alleen rol, functie en ringbeheerder vast en kent **nooit** een machtiging toe; activeren geeft **nooit** een sessie (inloggen en MFA verlopen via de bestaande routes). Ringbeheerders voegen niet meer rechtstreeks toe (alleen via uitnodiging; bestaand account koppelen blijft aan de webmin).
  Antwoorden verraden nooit of een e-mailadres al bestaat. Een uitnodiging vervalt zodra de uitnodiger niet meer bevoegd is, de ring inactief is of het lidmaatschap bewust is gedeactiveerd. Tokens en codes nooit loggen of tonen in beheerschermen.
- **Native passkeys (C5.2).** Pending-login (`mfaAt = null`) werkt uitsluitend op `/auth/mfa/*`; volledige sessie pas na een door de server geverifieerde assertion. Functievlag `NATIVE_PASSKEYS_ENABLED` blijft UIT tot toesteltests (zie `docs/PASSKEYS-NATIVE.md`); de Personal Team-build heeft de capability nooit. Toegestane origins: web alleen `APP_BASE_URL`; native + expliciete Android-`apk-key-hash`.
- **Afbakening:** Ringtools ondersteunt uitsluitend roepingen en ontheffingen. Organisatorische aanwijzingen en taakverdelingen krijgen geen afzonderlijke workflow. Registreren van een presidiumakkoord en vrijgeven aan de hoge raad blijven twee aparte, expliciete handelingen.

## Design

Mobile-first; Liquid Glass-stijl behouden (tokens in `src/app/globals.css` en `mobile/src/styles.css`); iPhone, iPad en
Android; veilige schermranden (`env(safe-area-inset-*)`); dark mode; correct toetsenbord- en navigatiegedrag (Android-
terugknop); toegankelijk (contrast, focus, labels, ≥48 px aanraakdoelen); verschillende schermformaten.

## Bewust (voorlopig) niet in de app

Zie het functieoverzicht: SMTP/instellingen, MFA-reset en noodprocedures blijven bij technisch beheer (`webmin`, web). Alles wat reguliere
gebruikers, ringbeheerders en `webmin` voor hun werk nodig hebben, moet in de app komen (Fasen A–D in `docs/MIGRATIE-APP-ONLY.md`).

## Checklist vóór en na iedere wijziging

**Vooraf**
- [ ] Raakt dit iOS én Android (primaire platformen)? Zo niet beide: waarom niet (vastleggen). Raakt het de overgangswebapp of technisch beheer?
- [ ] Raakt het authenticatie/sessies, notificaties, navigatie, e-maillinks, opslag of het API-contract? → expliciet op
      native compatibiliteit beoordelen.
- [ ] Hergebruikt het bestaande bedrijfslogica en autorisatie (geen duplicatie)? Blijft ringisolatie gewaarborgd?
- [ ] Nieuwe app-permissies, entitlements of native plugins? → store-/privacyimpact (`docs/STORE-PRIVACY.md`).
- [ ] Nieuwe of gewijzigde Prisma-migratie? Additief en veilig voor bestaande data?

**Achteraf (voer uit en rapporteer wat is gedraaid)**
- [ ] `npx tsc --noEmit` en `npx eslint .` (root).
- [ ] `npx vitest run` (root: server, API-contract, push, ringisolatie) en `cd mobile && npm test`.
- [ ] `npx next build` (Next.js-build) en indien relevant Playwright-e2e (`npx playwright test`, zie README) voor de overgangswebapp en het technisch beheer.
- [ ] `cd mobile && npm run build` (client) en `npm run check:native-config` (Capacitor-/native configuratie, deep links).
- [ ] Android: `cd mobile && npm run build:android:debug` (vereist JDK 21 + Android SDK) – of expliciet "niet getest".
- [ ] iOS: `npm run build:ios:simulator` op macOS met Xcode – of expliciet "niet getest".
- [ ] Deep links, pushflow en inloggen op een fysiek toestel: handmatig; zo niet gedaan, expliciet rapporteren.
- [ ] Docker/GitHub Actions blijven werken (`docker-publish.yml` ongewijzigd of bewust aangepast).
- [ ] Wijziging aan mobiele backend, auth, push, links of API? → bevestig dat `mobile-ci.yml` die paden dekt en dat de backend-job draait.
- [ ] Geen geheimen in diff/buildoutput (`git diff`, `npm run check:native-config`).
- [ ] Documentatie bijgewerkt (`README.md`, `docs/MOBILE.md`, `docs/STORE-PRIVACY.md`, dit bestand).

## Rapportage-eerlijkheid

- Als een platform niet getest kan worden, wordt dat **expliciet** gerapporteerd (wat wel/niet, en waarom).
- **Claim nooit een geslaagde native build zonder die daadwerkelijk te hebben uitgevoerd.** Een CI-run die niet
  gedraaid heeft, telt niet.
- Noem het project niet "App Store-ready"/"Play Store-ready" voordat technische én beleidsmatige releasevoorwaarden
  (`docs/MOBILE.md`, `docs/STORE-PRIVACY.md`) aantoonbaar zijn vervuld en op fysieke toestellen getest.

## Releases

- Mobiele builds publiceren nooit automatisch naar App Store of Play Store. Publicatie loopt via een aparte, expliciet
  gestarte procedure (`.github/workflows/mobile-release.yml`, handmatig) door de eigenaar.
- Definitieve app-ID's (`RINGTOOLS_APP_ID`: nu voorlopig `nl.ringapeldoorn.ringtools`), Team-ID's, signing-vingerafdrukken
  en pushsleutels verzin je nooit; ze komen van de eigenaar en staan alleen in secrets/omgevingsvariabelen.

## Werkwijze repository

- Ontwikkelbranch: `claude/ringpresidium-webapp-veccye` → na groene validatie fast-forward naar `main`.
- Commit-berichten in het Nederlands, beschrijvend; eindig met de gevraagde attributieregels.
- Stel alleen vragen bij een essentiële functionele keuze; voeg geen ongevraagde functionaliteit toe.
