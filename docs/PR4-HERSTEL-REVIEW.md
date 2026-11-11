# Herbeoordeling PR #4 en Apple-reviewdemo

Beoordeeld tegen productiecommit `e1b67c6e` en de oorspronkelijke PR-head `992522fce8`. Opnieuw gecontroleerd via GitHub: PR #4 open, bestaande featurebranch `fix/login-secundaire-links`; volledige eerdere CI-run `42970277995` succesvol. De eerdere rode TypeScript-run `42969976402` was achterhaald. Er is geen geschiedenis herschreven of wijziging op main gemaakt.

## Oorzaak en correctie

De PostgreSQL-trigger `RingMembership_account_scope` weigert terecht verboden combinaties van accountsoort, ring en rechten met SQLSTATE 23514, tekst `Account cannot join this ring`. Het generieke gebruikersformulier kon een reviewlidmaatschap naar de gewone `ringMembership.update()` sturen, bijvoorbeeld met `isRingManager=true`. De applicatie hield de speciale demo niet vóór die bewerking tegen; de onbekende Prisma-fout viel buiten de bestaande domeinfoutafhandeling en veroorzaakte de technische Next.js-foutpagina. Dit is geen mislukte migratie en staat los van de encryptiesleutelwaarschuwing. De exacte oorspronkelijke formulierpayload is niet beschikbaar; de verboden managerwijziging is op synthetische gegevens gereproduceerd en afgedekt.

De oorspronkelijke PR blokkeerde generieke wijzigingen **aan de demoring**, maar miste het omgekeerde pad: een review- of auditaccount via bestaand gebruikers-ID of e-mailadres aan een gewone of nieuw aangemaakte ring koppelen. `resolveUser()` weigert dat nu vóór het lidmaatschap wordt geschreven. `updateMember()` en de bestaande domeinguards weigeren generieke demo-mutaties vóór schrijfacties. `RingError` wordt door webacties als begrijpelijke Nederlandse formuliermelding teruggegeven en door de mobiele API als gecontroleerde JSON-fout. De normale gebruikers- en managerpaden blijven beschikbaar.

Geen databaseconstraint, accountsoort of autorisatierol is afgezwakt. Geen migratie nodig. Systeembeheer blijft uitsluitend webmin met wachtwoord en TOTP via de beveiligde website. De mobiele beheer-API geeft geen systeembeheerrechten.

## Alle acht eerdere commits

| Commit | Beoordeling en uiteindelijke behandeling |
| --- | --- |
| `e4cab5a2` | Compacte secundaire navigatie is passend; JSX en normale inlogstroom behouden. |
| `120c6b59` | Transparante tekstlinks en 48px-aanraakhoogte behouden. Verbeterd naar 14px/rem, sterke tekstkleur in beide modi, begrensde breedte/woordafbreking en Safari-systeemvoetnoot voor grotere systeemtekst. |
| `65a8ec3b` | Functionele componenttest behouden; browsercontrole toegevoegd voor 320px, lichte/donkere modus, 200% tekst en beide bestemmingen. De privacylink opent zoals voorheen extern. |
| `1092b547` | Guards voor demoringmutaties terecht; aangevuld met de ontbrekende accountcontrole bij koppelen via ID/e-mail aan gewone/nieuwe ringen. |
| `84bc9cd1` | Afgeschermde ringpagina en filtering van review/auditaccounts in de normale keuzelijst behouden. Serverbeleid blijft beslissend. |
| `80076fa6` | Verborgen profiel-/MFA-knoppen behouden, maar op zichzelf onvoldoende. WebAuthn-actor, MFA-beheeracties en generieke beheerders-MFA-reset beschermen nu ook server-side de reviewgrens. Reviewbeveiligingspagina toont uitleg zonder inschrijfformulieren. |
| `970471d0` | Bestaande domeinregressie behouden; uitgebreid met normale managerbewerkingen, beide verboden koppelrichtingen, gecontroleerde web/API-fouten, herstelbaarheid, wachtwoordrotatie en concurrerend herstel. |
| `992522fc` | Scheiding en sleutelwaarschuwing behouden. Advies om via een gewone extra productietestring ringbeheer te demonstreren vervangen door een geïsoleerde alleen-lezen demonstratie. Vaag rotatieadvies vervangen door een concreet onderhoudsplan. |

Er zijn geen complete eerdere commits teruggedraaid: de bruikbare kleine wijzigingen zijn behouden en de onvolledige beveiliging en documentatie gericht herschreven. De oorspronkelijke acht commits blijven reviewbaar in de PR-geschiedenis.

## Architectuurkeuze: alleen-lezen beheer, geen reviewbeheerrechten

Gekozen is optie 2: Apple Review 3 ziet **Profiel → Gebruikersbeheer – demo**. De serverendpoint `/rings/:id/review-management` vereist een geldig reviewaccount, actieve eigen lidmaatschap, exact de eigen gemarkeerde demoring en de rol RINGSECRETARIS. Alleen fictieve namen, rollen, status en wijken/gemeenten worden geselecteerd. Geen e-mailadressen, credentials, sessies of mutatiebevoegdheden. Review 1/2 en gewone accounts kunnen deze endpoint niet gebruiken. Een andere ring wordt als niet gevonden afgehandeld.

Apple kan de drie beoordelings-/secretariaatsrollen, fictieve roepings- en ontheffingsworkflow, expliciete uitvoeringsvrijgave, taken, accountprivacy en de alleen-lezen gebruikers-/inrichtingsdemonstratie beoordelen. Echt uitnodigen, rollen wijzigen en ringbeheerrechten toekennen worden niet aan reviewers beschikbaar gesteld. Een reviewaccount is nooit ringbeheerder of systeembeheerder. Dit staat ook expliciet in de Review Notes; volledige muterende ringbeheerfunctionaliteit wordt niet als beoordeelbaar geclaimd.

## Inrichting en herstel

Alleen **Instellingen → App Review en accountverwijdering** beheert de drie vaste reviewaccounts. Eerste inrichting vereist drie geldige wachtwoorden en is één transactie. Een ontbrekende bestaande credential wordt niet meer stilzwijgend overgeslagen: het betreffende wachtwoord moet opnieuw worden ingevuld. Lege velden behouden bestaande credentials. Eén ingevuld veld wijzigt uitsluitend dat wachtwoord en trekt diens sessies/toesteltoegang in; de andere accounts blijven bruikbaar. Canonieke namen, rollen, lidmaatschappen en uitgeschakelde e-mailvoorkeur worden hersteld zonder een gewoon account over te nemen.

Een PostgreSQL-transactievergrendeling beschermt de hele reset, ook de normale workflowtransities die fictieve gevallen aanmaken. Provisioning, activeren/deactiveren en een tweede reset worden tijdens herstel geweigerd. Een procescrash geeft de vergrendeling vrij: een achtergebleven `demoResetting`-vlag verhindert de volgende poging niet meer. Tijdens herstel blokkeert het bestaande sessiebeleid de demo. Een seedfout houdt de demo uitgeschakeld en levert een begrijpelijke herstelmelding; opnieuw proberen kan veilig. De beheerpagina toont blokkade/herstelstatus en per account of een credential aanwezig is, nooit wachtwoorden/hashes.

De bestaande egressguards blijven intact: geen echte e-mail, APNs of webpush uit de demoring; alleen interne meldingen. Geen APNs-transport, sleutel, entitlement of NAS/Portainerconfiguratie gewijzigd. Notificaties voor gewone ringen houden het bestaande vrijgavebeleid, generieke externe inhoud en deduplicatie.

## Encryptiesleutel

De productieconfiguratie is niet gewijzigd. De gemelde zwakke sleutel blijft een open eigenaaractie. [SETTINGS-SLEUTELROTATIE.md](SETTINGS-SLEUTELROTATIE.md) inventariseert alle drie ciphertextvelden, exacte bestaande sleutelafleiding, de ontbrekende ingebouwde rotatiefunctie, de voorwaarden voor een apart beoordeeld onderhoudshulpmiddel, volledige transactionele herencryptie en gekoppelde database-/sleutelrollback. Deze PR introduceert geen nieuw cryptografisch formaat of ad-hoc productiehulpmiddel.

## Validatie en oplevergrens

Alle databases voor deze controle zijn lokale, afzonderlijke `_test`/`_e2e`-databases. Geen productiegegevens geraadpleegd of aangepast. Lokaal geslaagd: 695 backendtests (46 bestanden), 424 mobiele tests (46 bestanden), 77 browser-e2e-tests met de relevante vlaggen aan (7 tests voor uitgeschakelde vlaggen bewust overgeslagen), TypeScript voor backend/client, ESLint, Prisma-validatie, Next.js-productiebuild, Vite/Capacitor-build, native configuratie en 7 iOS-bundleverificatietests. Android `assembleDebug` is lokaal geslaagd. De uitgeschakelde vlaggen en definitieve CI-status worden aanvullend in PR #4 en het opleverbericht vastgelegd. De feature-CI bouwt Android en iOS zonder signing/publicatie; de actuele checkstatus moet bij de nieuwe PR-head worden beoordeeld, niet bij eerdere commits.

Nog door eigenaar op echte iPhone/iPad controleren: voetnootlinks met grote toegankelijkheidstekst/VoiceOver en donkere modus; drie reviewlogins; profiel naar alleen-lezen beheer voor Review 3; MFA/Face ID voor een gewoon account; systeembeheer met TOTP; daadwerkelijke APNs voor een gewone vrijgegeven taak en geen externe levering uit de demo. Browseremulatie en een simulatorbuild bewijzen geen fysieke Face ID-/APNs-levering.

Na beoordeling door de eigenaar pas beslissen over merge, Docker-image, TestFlight en store-indiening. Deze opdracht voert geen van die publicatiestappen uit.
