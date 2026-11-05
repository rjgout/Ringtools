# AGENTS.md – Ringtools

Centrale bron van waarheid voor alle AI-codingagents (Codex, Claude Code, enz.) en ontwikkelaars.
Lees dit bestand volledig vóór je iets wijzigt. Bij tegenstrijdigheid met een ander document gaat dit bestand voor,
tenzij de eigenaar uitdrukkelijk anders heeft opgedragen. (Bij de invoering van dit bestand bestonden er geen andere
`AGENTS.md`/`CLAUDE.md`; voeg bij een nieuw instructiebestand de inhoud hier samen i.p.v. een tweede bron te maken.)

## Koers: app-first met een blijvende beveiligde webomgeving (permanent, door de eigenaar vastgesteld; vervangt de eerdere app-only-aanname)

> **Beslissing eigenaar (fase E):** Ringtools blijft app-first, maar wordt **niet** app-only. De website houdt een beveiligde inlogmogelijkheid voor bevoegde gebruikers, bijvoorbeeld een ringsecretaris of
> ringadministrateur die tijdens een vergadering met een laptop voorstellen bekijkt, ondersteuning of gezamenlijke besluiten vastlegt en administratief werk doet. Dezelfde backend, database, autorisatie, rollen
> en beveiligingsregels als de app; **geen apart accountsysteem**; verplichte MFA en herverificatie blijven gelden. Bestaande webtoegang voor andere rollen wordt **niet** zonder afzonderlijke toestemming ingetrokken.
> De web-login wordt niet uitgeschakeld. De webmin-beheeromgeving blijft afzonderlijk beveiligd (wachtwoord + verplichte TOTP).

- **Gebouwd maar UIT (E2.1, vlag `WEB_TOTP_ENABLED`, standaard `false`; niet geactiveerd, niet op main):** authenticator-app (TOTP) naast passkeys voor gewone webgebruikers, met acht herstelcodes (alleen bij TOTP), keuzescherm, beheer met recente MFA en een gelijktijdigheidsveilige invariant (een account met verificatie aan houdt altijd een bruikbare methode). Zonder de vlag verandert er niets. Nieuwe methode toevoegen of vervangen bij een al beveiligd account nooit met alleen een e-mailcode; eerste inschrijving alleen als er werkelijk geen methode is. Webmin-reset is één transactie met identiteitsbevestiging, audit en gebruikersmelding. Activeren pas na akkoord van de eigenaar – `docs/WEB-MFA-ONTWERP.md` §9; back-up/herstel: `docs/BACKUP-HERSTEL.md`.
- **Gepland (alleen ontwerp, nog niet gebouwd of geactiveerd; keuzes bij de eigenaar):** web-MFA-keuze (app met number matching, passkey, authenticator-app) – `docs/WEB-MFA-ONTWERP.md`; Number matching is **niet** phishingbestendig en wordt nooit als WebAuthn-equivalent gepresenteerd. **Gebouwd (E3 stap 1):** verplichte app-ontgrendeling met biometrie/toestelcode – `docs/APP-ONTGRENDELING-ONTWERP.md`; het hardwaregebonden sessietoken (stap 2) is alleen een voorstel. Lokale ontgrendeling vervangt geen serverauthenticatie, MFA of herverificatie.
- **Ringtools is app-first.** De native apps voor **iOS en Android (Capacitor)** zijn het hoofdproduct en de primaire gebruikersplatforms.
- **De website (`ringapeldoorn.nl`) heeft twee delen:** een **publiek, informatief deel** (startpagina, privacy, contact, accountverwijdering, later links naar de stores; geen vertrouwelijke gegevens,
  geen sessie nodig, duidelijke knop **Inloggen**) en een **beveiligde webomgeving** voor bevoegde gebruikers (`/login` → `src/app/(app)`), met de bestaande rollen en bevoegdheden.
- **Nieuwe gebruikersfunctionaliteit wordt eerst voor de native app gebouwd.** Voor de webomgeving geldt: hergebruik de bestaande `workflow.ts`-functies en API-regels (nooit een tweede workflow of
  bevoegdheidsstructuur), en bouw alleen webfuncties die de eigenaar heeft aangewezen (nu: de vergaderwerkzaamheden van ringstaf; zie de tabel). Ontbreekt een bestaande eis in de web, documenteer dat in `docs/MIGRATIE-APP-ONLY.md`.
- **De backend blijft centraal** (Next.js + PostgreSQL op de bestaande Synology NAS, Docker, poort 2809). Next.js blijft beschikbaar voor
  de mobiele API en eventueel een streng beveiligd technisch beheer (alleen `webmin`, verplichte TOTP). Dit is geen alternatief gebruikersportaal.
- **Beveiliging, tenantisolatie en MFA worden nooit verzwakt** – ook niet om iets sneller af te krijgen of voor platformcompatibiliteit.
- **Functionele volledigheid gaat vóór visuele verfijning.** Vormgeving komt later.
- **De web-login voor gewone gebruikers wordt niet uitgeschakeld** (beslissing eigenaar, fase E). Het intrekken van webtoegang voor een rol vereist altijd een afzonderlijke, expliciete opdracht van de eigenaar.
  De bestandsnaam `docs/MIGRATIE-APP-ONLY.md` is historisch; het document beschrijft de fasering van de app-first-koers.
- **Elke wijziging houdt rekening met iOS én Android.** Een wijziging is pas afgerond wanneer de relevante platformtests zijn uitgevoerd
  of expliciet is vastgelegd waarom een test niet mogelijk was.
- **De `App-PersonalTeam`-configuratie voor iPhone-tests (gratis Personal Team) blijft behouden** en werkend (zie "Permanente lessen").
- Wijzigingen aan authenticatie, notificaties, navigatie, e-maillinks, opslag of API-contracten worden altijd expliciet op native
  compatibiliteit beoordeeld.
- Gebruik de productieconfiguratie van Capacitor niet als eenvoudige externe-websitewrapper. De apps gebruiken gebundelde assets en veilige
  toegang tot de bestaande Ringtools-backend.

## Platformen en functieoverzicht

Primair: **iOS** (`mobile/ios`) en **Android** (`mobile/android`), beide met dezelfde gebundelde React-client (`mobile/src`).
Daarnaast bestaan: de **publieke website** (informatief), de **beveiligde webomgeving voor bevoegde gebruikers** (Next.js-webapp, `src/app`; blijvend, ook voor vergaderingen op een laptop) en de
**technische beheeromgeving** (webmin-only). De gewone gebruikersomgeving en de webmin-beheeromgeving blijven strikt gescheiden.

Legenda: ✅ aanwezig · 🔧 in uitvoering/gepland (fase) · — bewust niet · ⚠ beveiligde webomgeving (blijvend; bestaande functies, nieuwe alleen op aanwijzing van de eigenaar)

| Functie | iOS | Android | Website (publiek deel / beveiligde webomgeving) | Technisch beheer (webmin, web) |
|---|---|---|---|---|
| Informatie over Ringtools, privacy, contact, accountverwijdering | ✅ (links) | ✅ (links) | ✅ E (publiek: startpagina met knop Inloggen, privacy, contact, accountverwijdering) | — |
| Inloggen met e-mailcode | ✅ | ✅ | ✅ bestaande web-login blijft (inlogcode + MFA waar die geldt) | — |
| Native passkeys / volledige MFA voor gebruikers | 🔧 C5.2: server, API, Capawesome-plug-in + adapter en tests klaar; functievlag UIT, niet op een toestel getest (niet in PersonalTeam) | 🔧 C5.2: plug-in + adapter klaar; functievlag UIT, niet op een toestel getest | — | — |
| Webmin-login: wachtwoord + verplichte TOTP | ✅ B (toesteltest open) | ✅ B (toesteltest open) | — | ✅ |
| Roepingen bekijken, ondersteunen (stemmen) | ✅ | ✅ | ✅ web (blijvend) | — |
| Nieuw voorstel, verantwoordelijken, herinneren, opnieuw vragen, rondes beheren | ✅ A (toesteltest open) | ✅ A (toesteltest open) | ✅ web (blijvend) | — |
| Taken toewijzen/afronden, verwerken, definitief verwijderen | ✅ A (toesteltest open) | ✅ A (toesteltest open) | ✅ web (blijvend) | — |
| Gezamenlijk akkoord (presidium/hoge raad) vastleggen, expliciet vrijgeven aan de hoge raad, melding "Voorstel wacht op vrijgave" aan ringstaf | ✅ C1 (toesteltest open) | ✅ C1 (toesteltest open) | ✅ E: ringstaf op een laptop (zelfde `workflow.ts`; secretaris/administrateur legt vast, is nooit ondersteuner) | — |
| Gebruikersbeheer binnen eigen ring (ringbeheerder) | ✅ B (toesteltest open) | ✅ B (toesteltest open) | ✅ web (blijvend) | — |
| Ringbeheer: ringen aanmaken/wijzigen/(de)activeren (alleen webmin) | ✅ B (toesteltest open) | ✅ B (toesteltest open) | — | ✅ (aanmaken/wijzigen; activeren alleen in de app) |
| Eerste ringbeheerder van een nieuwe ring aanwijzen (webmin) | ✅ B (toesteltest open) | ✅ B (toesteltest open) | — | ✅ |
| Wijken/gemeenten, hogeraadskoppeling, ringinrichting, roepingencatalogus, eigen roepingen, aanstellingsbevoegdheid | ✅ C2 (toesteltest open) | ✅ C2 (toesteltest open) | — | ✅ (via app-beheer) |
| Nieuw voorstel via concept (naam → unit → roeping → verantwoordelijken), servercontrole bevoegdheden en eigen roepingen | ✅ C3 (toesteltest open) | ✅ C3 (toesteltest open) | — | — |
| Gestructureerde kerkelijke functies (ringpresident, eerste/tweede raadgever, …), machtigingen, voorgestelde bevoegde uitvoerders, catalogusoverzicht onder Inrichting | ✅ C4.5 (toesteltest open) | ✅ C4.5 (toesteltest open) | — | ✅ (via app-beheer) |
| Uitnodigen en activeren van nieuwe gebruikers (ringbeheerder nodigt uit; activatie met link of e-mail + code; zonder verplichte MFA direct ingelogd, met verplichte MFA geen sessie) | ✅ C5.1 (toesteltest open) | ✅ C5.1 (toesteltest open) | informatieve landingspagina `/uitnodiging/<token>` | ✅ (webmin, via app-beheer) |
| Ontheffingen (aparte module; vertrouwelijk, betrokkene heeft geen toegang) | ✅ C4 (toesteltest open) | ✅ C4 (toesteltest open) | — | — |
| Verplichte appvergrendeling (Face ID/Touch ID/biometrie/toestelcode; 30 s achtergrond; afscherming app-switcher; Android FLAG_SECURE) | ✅ E3 stap 1 (toesteltest open; ook in PersonalTeam) | ✅ E3 stap 1 (toesteltest open) | — | — |
| Meldingen in de app (bel) | ✅ | ✅ | ✅ web (blijvend) | — |
| Native push (APNs/FCM) | ✅ (niet in PersonalTeam) | ✅ | — | — |
| Universal Links / App Links | ✅ (niet in PersonalTeam) | ✅ | `.well-known`-bestanden | — |
| Sessies en apparaten beheren, sessie-intrekking op afstand | ✅ (ook webmin) | ✅ (ook webmin) | ✅ web (blijvend) | ✅ |
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
  Een uitnodiging legt alleen rol, functie en ringbeheerder vast en kent **nooit** een machtiging toe; activeren geeft alleen een gewone volledige sessie zonder tweede e-mailcode als het account **geen verplichte MFA** heeft (de geldige, eenmalige uitnodiging bewijst de controle over het e-mailadres, zoals een inlogcode); de sessie ontstaat in dezelfde transactie als het verbruiken van de uitnodiging (hooguit één per uitnodiging, nooit bij een mislukte activatie). Accounts met verplichte MFA en het beheerdersaccount krijgen **nooit** een sessie via een uitnodiging: daar blijven inloggen en de tweede factor via de bestaande routes lopen. Ringbeheerders voegen niet meer rechtstreeks toe (alleen via uitnodiging; bestaand account koppelen blijft aan de webmin).
  Antwoorden verraden nooit of een e-mailadres al bestaat. Een uitnodiging vervalt zodra de uitnodiger niet meer bevoegd is, de ring inactief is of het lidmaatschap bewust is gedeactiveerd. Tokens en codes nooit loggen of tonen in beheerschermen.
- **Native passkeys (C5.2).** Pending-login (`mfaAt = null`) werkt uitsluitend op `/auth/mfa/*`; volledige sessie pas na een door de server geverifieerde assertion. Plug-in: `@capawesome/capacitor-passkeys` exact gepind (0.1.2) achter `PasskeyProvider` (`lib/capawesomePasskeys.ts`; alleen native, nooit in de Personal Team-build); de adapter doet alleen authenticatie. Functievlag `NATIVE_PASSKEYS_ENABLED` blijft UIT tot toesteltests (zie `docs/PASSKEYS-NATIVE.md`); de Personal Team-build heeft de capability nooit. Productie-`App.entitlements` bevat `webcredentials:` naast `applinks:`; `Debug-PersonalTeam` blijft zonder entitlements. Toegestane origins: web alleen `APP_BASE_URL`; native + expliciete Android-`apk-key-hash`.
- **Appvergrendeling (E3).** Gegevens ophalen of de sessie verversen gebeurt nooit rechtstreeks op een native gebeurtenis (`appStateChange`/`visibilitychange`) maar via `LockController.onResume` en met een synchrone `isUnlocked()`-controle; `ApiClient` weigert verzoeken zolang vergrendeld (`isBlocked`). De native schermbescherming is een voorwaarde voor toegang (`ensurePrivacyScreen`, fail-closed). Verplicht voor alle native gebruikers/rollen (ook webmin en de Personal Team-build); eigen controle BOVEN OP de serversessie, geen vervanging van MFA of herverificatie. Structuur: `DeepLinks` (buiten) + `AppLockGate` > `AuthProvider` > `Shell`. Vóór de eerste ontgrendeling worden `AuthProvider`/`Shell` niet gemonteerd (geen token lezen, geen API, geen vertrouwelijke UI). Fail-closed: fout, annulering of ontbrekende toestelbeveiliging = vergrendeld/geblokkeerd; geen eigen pincode of onveilige terugval. Terug uit de achtergrond: < 30 s zonder prompt, anders opnieuw (klokfout = vergrendelen). Deeplinks/pushtikken: listeners blijven buiten de gate; de bestemming gaat naar `routeInbox` (geheugen, TTL 5 min) en wordt pas na ontgrendeling én zonder afscherming verwerkt. Nieuwe schermen/functies die gegevens ophalen of tonen horen binnen de gate; raak `AppLockGate`, `lib/appLock.ts` of `PrivacyScreen` niet aan zonder tests (`mobile/tests/appLock*.test.*`). `capacitor.config.ts` houdt `PrivacyScreen.preventScreenshots: false` (check:native-config). Plug-ins (`@aparajita/capacitor-biometric-auth` 10.0.0, `@capacitor-community/privacy-screen` 8.0.0) blijven exact gepind achter `AppLockProvider`; de Personal Team-build krijgt hierdoor geen entitlements.
- **Afbakening:** Ringtools ondersteunt uitsluitend roepingen en ontheffingen. Organisatorische aanwijzingen en taakverdelingen krijgen geen afzonderlijke workflow. Registreren van een presidiumakkoord en vrijgeven aan de hoge raad blijven twee aparte, expliciete handelingen.

## Design

Mobile-first; Liquid Glass-stijl behouden (tokens in `src/app/globals.css` en `mobile/src/styles.css`); iPhone, iPad en
Android; veilige schermranden (`env(safe-area-inset-*)`); dark mode; correct toetsenbord- en navigatiegedrag (Android-
terugknop); toegankelijk (contrast, focus, labels, ≥48 px aanraakdoelen); verschillende schermformaten.

## Bewust (voorlopig) niet in de app

Zie het functieoverzicht: SMTP/instellingen, MFA-reset en noodprocedures blijven bij technisch beheer (`webmin`, web). Alles wat reguliere
gebruikers, ringbeheerders en `webmin` voor hun werk nodig hebben, moet in de app komen (Fasen A–D in `docs/MIGRATIE-APP-ONLY.md`); de beveiligde webomgeving blijft daarnaast bestaan.

## Checklist vóór en na iedere wijziging

**Vooraf**
- [ ] Raakt dit iOS én Android (primaire platformen)? Zo niet beide: waarom niet (vastleggen). Raakt het de beveiligde webomgeving of technisch beheer?
- [ ] Raakt het authenticatie/sessies, notificaties, navigatie, e-maillinks, opslag of het API-contract? → expliciet op
      native compatibiliteit beoordelen.
- [ ] Hergebruikt het bestaande bedrijfslogica en autorisatie (geen duplicatie)? Blijft ringisolatie gewaarborgd?
- [ ] Nieuwe app-permissies, entitlements of native plugins? → store-/privacyimpact (`docs/STORE-PRIVACY.md`).
- [ ] Nieuwe of gewijzigde Prisma-migratie? Additief en veilig voor bestaande data?

**Achteraf (voer uit en rapporteer wat is gedraaid)**
- [ ] `npx tsc --noEmit` en `npx eslint .` (root).
- [ ] `npx vitest run` (root: server, API-contract, push, ringisolatie) en `cd mobile && npm test`.
- [ ] `npx next build` (Next.js-build) en indien relevant Playwright-e2e (`npx playwright test`, zie README) voor de publieke pagina's, de beveiligde webomgeving en het technisch beheer.
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
