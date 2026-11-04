# AGENTS.md – Ringtools

Centrale bron van waarheid voor alle AI-codingagents (Codex, Claude Code, enz.) en ontwikkelaars.
Lees dit bestand volledig vóór je iets wijzigt. Bij tegenstrijdigheid met een ander document gaat dit bestand voor,
tenzij de eigenaar uitdrukkelijk anders heeft opgedragen. (Bij de invoering van dit bestand bestonden er geen andere
`AGENTS.md`/`CLAUDE.md`; voeg bij een nieuw instructiebestand de inhoud hier samen i.p.v. een tweede bron te maken.)

## Hoofdregel (altijd van toepassing)

> Voordat je bestaande functionaliteit wijzigt of nieuwe functionaliteit toevoegt, controleer je de gevolgen voor Web/PWA, iOS/Capacitor en Android/Capacitor. Behoud de bestaande gedeelde bedrijfslogica, tenantisolatie en beveiligingsarchitectuur. Een wijziging is pas afgerond wanneer de relevante platformtests zijn uitgevoerd of expliciet is vastgelegd waarom een test niet mogelijk was.

> Wijzigingen aan authenticatie, notificaties, navigatie, e-maillinks, opslag of API-contracten moeten altijd expliciet worden beoordeeld op native compatibiliteit.

> Gebruik de productieconfiguratie van Capacitor niet als eenvoudige externe-websitewrapper. De mobiele apps gebruiken gebundelde assets en veilige toegang tot de bestaande Ringtools-backend.

## Ondersteunde platforms

Ringtools ondersteunt drie platforms:

1. **Web/PWA** – de Next.js-app (`src/`), self-hosted via Docker op poort 2809.
2. **iOS** – via Capacitor (`mobile/ios`).
3. **Android** – via Capacitor (`mobile/android`).

Iedere toekomstige wijziging wordt op alle drie beoordeeld. Nieuwe functionaliteit wordt niet uitsluitend voor het web
ontwikkeld zonder uitdrukkelijke, vastgelegde reden (bijvoorbeeld: beheerfuncties die bewust webapp-only zijn – zie
"Bewust alleen web" hieronder).

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
- Elke uitzondering in opstartcode moet in een eindtoestand eindigen (uitgelogd, ingelogd of "niet beschikbaar + opnieuw proberen"),
  nooit in een eeuwig laadscherm (zie `lib/resume.ts`); netwerkverzoeken hebben een time-out.

## Design

Mobile-first; Liquid Glass-stijl behouden (tokens in `src/app/globals.css` en `mobile/src/styles.css`); iPhone, iPad en
Android; veilige schermranden (`env(safe-area-inset-*)`); dark mode; correct toetsenbord- en navigatiegedrag (Android-
terugknop); toegankelijk (contrast, focus, labels, ≥48 px aanraakdoelen); verschillende schermformaten.

## Bewust alleen web (nu)

Ringbeheer, gebruikersbeheer, beheerdersaccount, SMTP/instellingen, MFA/passkeys en beveiligingsinstellingen, staf-acties
(herinneren, taken beheren, verwerken, verwijderen, nieuw voorstel). Zie `docs/MOBILE.md` ("Nog niet geïmplementeerd").
Verplaatsen naar mobiel vereist: API-route + gedeelde types + tests + bijwerken van deze lijst.

## Checklist vóór en na iedere wijziging

**Vooraf**
- [ ] Welke platformen raakt dit (Web/PWA, iOS, Android)? Zo niet alle drie: waarom niet (vastleggen).
- [ ] Raakt het authenticatie/sessies, notificaties, navigatie, e-maillinks, opslag of het API-contract? → expliciet op
      native compatibiliteit beoordelen.
- [ ] Hergebruikt het bestaande bedrijfslogica en autorisatie (geen duplicatie)? Blijft ringisolatie gewaarborgd?
- [ ] Nieuwe app-permissies, entitlements of native plugins? → store-/privacyimpact (`docs/STORE-PRIVACY.md`).
- [ ] Nieuwe of gewijzigde Prisma-migratie? Additief en veilig voor bestaande data?

**Achteraf (voer uit en rapporteer wat is gedraaid)**
- [ ] `npx tsc --noEmit` en `npx eslint .` (root).
- [ ] `npx vitest run` (root: server, API-contract, push, ringisolatie) en `cd mobile && npm test`.
- [ ] `npx next build` (Next.js-build) en indien relevant Playwright-e2e (`npx playwright test`, zie README) voor Web/PWA.
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
