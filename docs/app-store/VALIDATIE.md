# Implementatie en validatie App Store-voorbereiding

Branch: `feat/app-store-release-readiness`, gestart vanaf actuele `main` (`4a486945510304a62cb71648cfccda49d88c3955`). Geen productiegegevens gebruikt. Geen deploy, upload, indiening of merge uitgevoerd.

## Gebouwd

- Expliciete NORMAL/REVIEW/AUDIT-accountsoorten. Scopechecks en PostgreSQL-constraints/triggers voorkomen lidmaatschappen over de demo-grens en beheerdersrechten voor reviewaccounts.
- Drie via beveiligd webbeheer te provisioneren/roteren/in te trekken reviewlogins, bcrypt12, IP-/accountlimiet, persistente pogingvergrendeling, audit en gewone intrekbare/verlopende sessies. Gewone e-mailcode/MFA-/toestelaanmelding blijft behouden.
- Secundaire Demoaccount-ingang in de gedeelde iOS/Android-client; lokale OS-vergrendeling blijft gelden, geen demo-toestelregistratie of pushregistratie.
- Beheerde idempotente demo-reset met 8 roepingsgevallen (inclusief concept, negatieve steun, open taken en verwerkt) en 7 ontheffingsfasen. Seed via bestaande domeintransities; geen directe statusbypass. Geen externe uitnodigingen, e-mail of push; wel interne meldingen. Herstel vergrendelt demosessies en houdt bij fout de demo uitgeschakeld.
- Profiel → Account en privacy met uitvoerbaar volledig verwijderverzoek en status. Beheerwachtrij, beoordeling van open verantwoordelijkheden/laatste beheer, echte account-/credential-/sessie-/pushverwijdering en concreet gemotiveerde tijdelijke historische pseudonimisering. Gedeactiveerde gebruikers kunnen zonder inlogsessie aanvragen via een aparte eenmalige code. Privacyarm statusbewijs werkt na verwijdering; opruiming van verlopen bewijzen/auditobjecten.
- Publieke privacy-, verwijder- en contactpagina, Sensitive Info/gebruikscategorieën in iOS-manifest, Nederlandse storeteksten, App Privacy-antwoorden, Review Notes, Unlisted-onderzoek, back-up-/update-/rollback-/provisioninghandleiding en fictieve browsercaptures.
- Lange statuslabels vouwen op smalle mobiele rijen om zodat namen leesbaar blijven. Browserontwikkeling gebruikt de bestaande Vite-API-proxy; releasebuild behoudt de expliciete HTTPS-backend.

## Migraties

`20261203100000_app_review_privacy`: account-/ringvelden met veilige defaults, nieuwe credential-/verwijdertabellen, enumwaarden, indexes/FK's en scopestructuurconstraints/triggers. `20261203110000_demo_reset_guard`: resetvergrendeling en uitsluitend gereserveerde `.invalid`-reviewadressen. Additief; geen omzetting/wissing van bestaande gebruikers of ringen. Uitgevoerd op lokale `_test` en `_e2e`; niet op productie. Volg de rollbackbeperkingen in RELEASEPAKKET.md.

## Uitgevoerde controles

| Controle | Resultaat |
|---|---|
| Volledige backend `npx vitest run` | **664 geslaagd**, 44 bestanden |
| Gerichte controle review/privacy + management + API | **42 geslaagd**, na aanscherping payload/receiptlimiet en credentialcascade |
| Laatste controle legacy-adresherkenning bij gedeactiveerde gebruikers + gewone aanmelding | **26 geslaagd** |
| Volledige mobiele `npm test` | **419 geslaagd**, 45 bestanden, inclusief 4 nieuwe UI-tests |
| Root/mobile TypeScript, root ESLint | Geslaagd; geen lintwaarschuwingen in laatste controle |
| Next-productiebuild en mobiele productiebuild/Capacitor sync | Geslaagd |
| Prisma validate, migrate deploy op gescheiden lokale testdatabases | Geslaagd; schema-diff: geen verschil |
| Native configuratiecontrole | Geslaagd: bundle-ID, links, Face ID, privacy, opslag, entitlements en geen appgeheimen |
| iOS-bundleverifier Python | **7 geslaagd** |
| Lokale Android debug-build, JDK21/SDK36 | **BUILD SUCCESSFUL**, geen signing of publicatie |
| Nieuwe browser-e2e | **3 geslaagd**: echte webbeheerprovisioning/reset, echte verwijderaanvraag/afhandeling/status zonder login, mobiele demo/privacy tegen draaiende backend |
| Volledige browserregressie, functies aan | **71 geslaagd**, 7 verwachte vlagoverslagen; inclusief de 3 nieuwe browsercontroles |
| Browserregressie met vlaggen uit | **21 geslaagd**, 9 verwachte overslagen (waaronder optionele mobiele browserrun); gewone webauth, publieke privacy, review en verwijderen meegenomen |
| Browserregressie met alleen toestel-login, zonder automatische inrichting | **5 geslaagd** |
| Native GitHub CI van de App Store-implementatie | **Alle vier jobs geslaagd**: backend, client, Android debug en iOS simulator + unsigned device archive/configuraties. [Run 42839215603](https://github.com/rjgout/Ringtools/actions/runs/42839215603), implementatie `7ccace3`, daarna door eigenaar opgenomen in main `681141c`. De opvolgende notificatiecorrectie heeft eigen tests/CI. |

## Gevraagde regressies

1–3 geldige reviewlogin, onjuist wachtwoord, normaal account/webmin uitgesloten: `tests/reviewReadiness.test.ts`.
4–8 gewone/demo-isolatie beide richtingen, gemanipuleerde API, DB-invarianten, geen ADMIN/ringbeheer en de drie werkelijke workflowrollen: hetzelfde bestand plus bestaande API/ring-/workflowtests.
9–10 gewone codes/MFA/native toestelprotocollen: bestaande `simpleLogin`, `nativeTotpLogin`, `webTotp`, `nativeMfa`, `deviceEnrollment`, `deviceLogin`, `deviceLoginConcurrency` en mobiele suites.
11–14 rotatie/intrekken, verlopen sessie, reset/vergrendeling, andere tenant behouden en geen mail/pushregistratie/uitnodiging: nieuwe reviewsuite plus bestaande push-transporttests.
15–16 volledige multiring-verwijdering, credentialcascade, inactief account zonder sessie, laatste beheer, actieve taken/rondes, grondslagvereiste en ontvangstbewijs: nieuwe backend-/UI-/e2e-tests.
17 gewone administratieve workflows en ontheffingsvertrouwelijkheid: volledige bestaande backend/client en browserregressie.
18 geen reviewwachtwoorden in bron/config/build: willekeurige testwachtwoorden alleen in procesgeheugen, geen productieprovisioning; diff en native-configcontrole. Geen echte personen in testdata/captures. De door de eigenaar opgegeven publieke contactgegevens zijn bewust in privacy-/supportteksten opgenomen.

## Grenzen en resterende releasevoorwaarden

Deze nieuwe versie is in deze opdracht **niet op fysieke iPhone, iPad of Android getest**. De eigenaar heeft de eerdere vereenvoudigde login/Face ID via TestFlight op een iPhone werkend gemeld; dit is geen bewijs voor de nieuwe demo-/privacyflow. Op Linux is geen lokale Xcode-build mogelijk; de macOS-CI-uitkomst wordt afzonderlijk vastgelegd. Signing/ASC-credentials, werkelijk productie-APNs, AASA/Universal Links en Android App Links moeten met de gekozen releasebuild fysiek worden bevestigd. Simulator/unsigned device archive is geen signing- of pushleveringsbewijs.

Vóór indiening nog nodig: juridische grondslagen inclusief religieuze gegevens, leveranciers-/doorgifte-/back-upretentie, zo nodig wettelijke uitzonderingen; juist export-complianceantwoord; definitieve leeftijds-/DSA-/rechtengegevens en reviewtelefoon; echte iPhone/iPad-storecaptures; gecontroleerde back-up en eigenaarupdate; handmatige reviewprovisioning, TestFlight-validatie, credentials in besloten ASC en eventuele Unlisted-aanvraag. Zie de exacte stappen in RELEASEPAKKET.md.

Technische conclusie: de gevraagde demo en verwijderfunctie zijn geïmplementeerd en lokaal functioneel getest. **Nog geen onvoorwaardelijke App Store-gereedheid**: de genoemde fysieke, juridische en storevoorwaarden moeten aantoonbaar zijn afgerond. Tenantisolatie berust op bestaande autorisatie met aanvullende serverchecks en DB-invarianten; een aparte database is hiervoor niet noodzakelijk gebleken. Een directe Unlisted-link is nooit toegangsbeveiliging. Historische pseudonimisering bewaart gevoelige procescontext en is alleen toegestaan met een echte grondslag; een motiveringstekst op zichzelf creëert die grondslag niet.
