# Ringtools — App Store-releasepakket

Stand 10 november 2026. Dit pakket bereidt indiening voor; er is niets gedeployd, naar TestFlight geüpload, ingediend of als Unlisted aangevraagd. Feitelijke testuitkomsten staan in [VALIDATIE.md](VALIDATIE.md).

## Metadata Nederlands

| Veld | In te vullen |
|---|---|
| Naam | Ringtools |
| Ondertitel | Roepingen en ontheffingen |
| Primaire categorie | Productiviteit (voorstel; eigenaar bevestigt) |
| Trefwoorden | roepingen,ontheffingen,ring,ondersteuning,besluiten,taken |
| Copyright | Eigenaar moet rechthebbende en jaar bevestigen; niet verzinnen |
| Privacy Policy URL | https://ringapeldoorn.nl/privacy |
| Support URL | https://ringapeldoorn.nl/contact |
| Marketing URL | Optioneel, https://ringapeldoorn.nl |
| Accountverwijdering | In app: Profiel → Account en privacy; web: https://ringapeldoorn.nl/accountverwijdering |
| Reviewcontact | Raphael Gout, raphael@ringapeldoorn.nl; vereist telefoonnummer nog door eigenaar invoeren |
| Leeftijdsclassificatie | Eigenaar beantwoordt de actuele vragenlijst; geen automatische 4+/18+-claim. Geen ongeschikte content beoogd, volwassen besloten doelgroep; gebruikers kunnen tekst invoeren |
| Privacy-antwoorden | Zie [STORE-PRIVACY.md](../STORE-PRIVACY.md), inclusief Sensitive Info |
| Content rights / DSA / beschikbaarheid / prijs | Eigenaar bevestigt gebruiksrechten, traderstatus/contact, landen, prijs en eventuele aanvullende wettelijke formulieren in App Store Connect |

Beschrijving:

> Ringtools helpt uitgenodigde gebruikers om roepingen en ontheffingen zorgvuldig te behandelen. Bekijk voorstellen, leg ondersteuning en gezamenlijke besluiten vast en volg de uitvoering van taken binnen je eigen ring.
>
> Het ringpresidium bereidt voorstellen voor en geeft ze expliciet vrij aan de hoge raad. De hoge raad kan ondersteuning geven of een bezwaar melden. Secretarissen en administrateurs volgen de uitvoering en leggen de administratieve verwerking vast. Vertrouwelijke ontheffingsdossiers zijn alleen zichtbaar voor bevoegde deelnemers; een gekoppelde betrokkene krijgt geen toegang tot het eigen dossier.
>
> Je meldt je aan met een e-mailcode en waar vereist extra verificatie. Op een geregistreerd toestel kun je snel aanmelden met de beveiliging van je telefoon. De app biedt lokale schermvergrendeling, functionele meldingen en links naar voorstellen. Je kunt in je profiel een verzoek indienen om je volledige account te verwijderen.
>
> Toegang is uitsluitend op uitnodiging. Ringtools is onafhankelijk ontwikkeld en is geen officiële applicatie van De Kerk van Jezus Christus van de Heiligen der Laatste Dagen.

Promotietekst (optioneel):
> Houd overzicht over voorstellen, ondersteuning, besluiten en uitvoering. Ringtools brengt roepingen en ontheffingen samen voor jouw besloten ring.

Gebruik alleen het eigen Ringtools-icoon. Geen kerklogo, officiële symbolen, screenshots uit LCR, endorsement of rechtenclaim zonder aantoonbare toestemming. Controleer eigen iconen/tekst/website mee bij de definitieve metadatareview.

## App Review Notes — plaktekst zonder geheimen

> Ringtools is an independently developed, invitation-only tool for callings and releases within a church stake. It is not an official application of The Church of Jesus Christ of Latter-day Saints.
>
> On the sign-in screen select **Demoaccount**, then enter the email and password supplied in App Review Information. No email inbox, activation code or external authenticator is required for these explicitly scoped review accounts. They use the same production app and backend as ordinary users, but can access only **Ringtools Demo**, which contains entirely fictional data. Emails, external invitations and push delivery are disabled for this tenant; internal notifications remain available.
>
> The device may request Face ID, fingerprint or device passcode to unlock the app locally. This is the regular device security prompt, not an email verification step.
>
> Primary: Apple Review 1 (ring presidency). Additional accounts: Apple Review 2 (high council), Apple Review 3 (secretary). Their credentials are supplied securely below in App Store Connect, never in the app binary or public documentation.
>
> The seeded overview contains drafts, presidency voting, presidency approval awaiting explicit release, high-council voting, a negative response requiring decision handling, approved proposals, execution tasks, processed history, release dossiers in several stages and internal notifications. Open a proposal to inspect its status, decisions and tasks. There is no automated transfer to external church systems.
>
> To exercise a full workflow, sign in as Review 1, submit the fictional draft, support it and explicitly release it to the high council. Sign out and sign in as Review 2, support it. Review 1 explicitly selects **Vrijgeven voor uitvoering** after the final approval; only then do assigned tasks become visible/executable and generate generic notifications. Review 1 records calling/setting-apart tasks; Review 2 records the supporting task. Review 3 administratively processes the completed proposal. The secretary cannot act as the supporting-task assignee. Alternatively inspect the pre-seeded cases without switching accounts. Do not use real personal information.
>
> Account deletion: **Profiel → Account en privacy → Account verwijderen aanvragen…**. Confirm the consequences and reauthenticate if requested. A real request enters the administrator's deletion queue. Target handling time is 14 days; open responsibilities must be transferred and any necessary retention assessed. Request status is shown in the profile and, via a private receipt, on the sign-in screen after deletion. Deletion covers the whole account across all stakes, not temporary deactivation. The public deletion page also accepts requests from inactive users without granting a login session.
>
> Please contact the supplied review contact for assistance. Ordinary users continue to use email-code/MFA or registered-device authentication; password sign-in is limited to explicitly provisioned demo review accounts.

De eigenaar vult in **App Store Connect → App Review Information → Sign-in required → Username / Password** de primaire reviewgegevens in vanuit de wachtwoordmanager. Extra rolgegevens alleen in de besloten App Review Notes/communicatie aan Apple, niet in deze repo, GitHub-issue, PR, CI, screenshot, publieke privacytekst of buildvariabele. Controleer alle drie vóór indiening. Geen echte wachtwoorden in dit sjabloon vervangen en daarna committen.

## Demoaccounts en ringbeheer: bewust gescheiden

De speciale `Ringtools Demo` is een **afgesloten App Review-tenant** en niet een vrij te beheren testring. Het gebruikersbeheer van gewone ringen mag hier geen personen toevoegen, bestaande accounts koppelen, rollen wijzigen of ringbeheerrechten uitdelen. Een `REVIEW`-account is alleen voor deze demo geldig en kan geen echte ring beheren; een normaal account kan juist niet deelnemen aan deze demo. Dit wordt zowel via servervalidatie als databaseconstraints afgedwongen.

Richt de drie vaste accounts uitsluitend in via **Instellingen → App Review en accountverwijdering**; geef bij eerste inrichting alle drie een eigen wachtwoord. Maak voor aanvullende acceptatietests met **echte ringbeheerderrechten** een **aparte test-ring** met alleen fictieve voorstellen en reguliere testaccounts. Gebruik geen echte namen of vertrouwelijke roepingen in een testring. De App Review-tenant blijft vrij van uitgaande mail en push; een reguliere testring heeft die garantie niet.

Wijzig of verwijder de drie vaste Apple-reviewaccounts niet via gewone ringgebruikersformulieren. De reviewbeheerpagina regelt credentials, intrekken/herstellen en demo-reset.

## Beveiligingssleutel van de server

Een waarschuwing dat `SETTINGS_ENCRYPTION_KEY` minder dan 32 tekens heeft, is een **afzonderlijk beveiligingswerkpunt**. De sleutel versleutelt onder meer opgeslagen SMTP-wachtwoorden en TOTP-geheimen. **Niet zomaar in Portainer vervangen**: zonder gecontroleerde herencryptie kunnen bestaande geheime waarden niet meer worden ontsleuteld en kan aanmelding/MFA uitvallen. Maak een herstelbare versleutelde back-up, inventariseer alle versleutelde velden en voer pas daarna een apart getest rotatieproces uit met tijdelijk zowel oude als nieuwe sleutel. Geen geheimen in GitHub of logs plaatsen.

## Apple-regels en distributiekeuze

Officiële bronnen geraadpleegd op 10 november 2026; opnieuw controleren vlak voor indiening:

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/): **2.1** volledige app, werkende backend en bruikbare demoaccountgegevens; **2.3** juiste metadata; **4.2** minimumfunctionaliteit; **5.1.1(i), (v)** privacyverklaring en accountverwijdering; **5.1.2** gebruik/delen van gegevens; **5.2.1** rechten op namen en merken. Ook **1.2** gebruikerscontent beoordelen in de context van de besloten, rolgebonden workflow; geen openbare sociale feed toevoegen of een vrijstelling claimen.
- [Offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/): eenvoudig vindbaar in app; volledig account en bijbehorende gegevens wissen, niet alleen deactiveren. Redelijke handmatige verwerking mag met termijn en voltooiingsbevestiging. Niet verplicht laten bellen/mailen/supportcontact opnemen bij een niet sterk gereguleerde app. Identiteitscontrole mag redelijk zijn. Een uitnodigingsmodel is geen reden om verwijdering weg te laten.
- [App Privacy details](https://developer.apple.com/app-store/app-privacy-details/): ook verwerkers en gegevens over anderen meenemen; religieuze overtuiging valt onder Sensitive Info. Geen tracking of biometrische verzameling claimen zonder feitelijke basis.
- [Unlisted app distribution](https://developer.apple.com/support/unlisted-app-distribution/): aanbevolen route voor deze beperkte doelgroep. De app is alleen via directe link te vinden; iedereen met die link kan installeren, dus serverautorisatie blijft vereist. Geen zoekresultaten/categorieaanbevelingen; geen beta/private test als Unlisted insturen. Selecteer publieke distributie in App Store Connect, dien een volledige release ter review in en volg Apples Unlisted-aanvraagprocedure; vermeld de bedoeling in Review Notes. De eigenaar dient de aanvraag zelf in. Apple beslist. Geen garantie op goedkeuring en geen link verzinnen. Custom Apps via Apple Business/School Manager is alleen passend bij aantoonbaar beheerde organisaties; niet veronderstellen dat die infrastructuur bestaat.
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/): actuele formaten en toekomstige SDK-eisen rechtstreeks in App Store Connect hercontroleren.

Native functionaliteit: Keychain/Keystore, OS-toestelverificatie en schermbescherming, push en deep links naast de volledige taak-/besluitworkflow. Dat ondersteunt 4.2; het oordeel blijft bij Apple. Beperkte doelgroep of alleen op uitnodiging is op zichzelf geen geconstateerde afwijzingsgrond, maar Apple moet alle functies zelfstandig kunnen beoordelen.

## Screenshots

Geen bestaande echte gebruikersscreenshots gebruiken. Browserbeelden van de synthetische testdemo zijn uitsluitend representatieve controlebeelden, niet automatisch geschikt als officiële iOS-storebeelden. Zie [screenshots/README.md](screenshots/README.md). Definitieve captures moeten afkomstig zijn van deze release op iPhone/iPad (simulator of toestel) zonder debuggegevens, geheimen of echte namen.

Per relevante apparaatgroep 1–10 JPEG/PNG-afbeeldingen zonder transparantie. Huidige officiële grote Dynamic Island-iPhoneformaten omvatten **1260×2736**, **1290×2796**, **1320×2868** (of liggend omgekeerd); iPhone met groot Face ID-scherm fallback **1284×2778** / **1242×2688** wanneer grote Dynamic Island-afbeeldingen ontbreken. iPad wordt ondersteund, dus ook **13-inch: 2064×2752** of **2048×2732** (of liggend omgekeerd). Controleer de actuele velden: Apple heeft ook toekomstige SDK-/iPhone Duo-eisen vanaf april 2027 aangekondigd; niet blind op oude 6,9-inchlabels vertrouwen.

Aanbevolen reeks: overzicht met statussen; voorstel en presidiumvrijgave; hogeraadondersteuning/negatieve reactie; uitvoeringstaken; verwerkt fictief dossier; vertrouwelijke ontheffing; profiel/privacy. Laat rollen zien via aparte captures waar nodig. Geen wachtwoordveld met zichtbare waarde of reviewcredential in captions.

## Productie-update en provisioning — eigenaar voert uit

1. Rond de open eigenaarbeslissingen in STORE-PRIVACY af, beoordeel PR en groene CI. Geen automatische merge: `main` publiceert een Docker-image die Watchtower kan oppakken.
2. Maak **vóór de update** een gecontroleerde PostgreSQL-back-up volgens [BACKUP-HERSTEL.md](../BACKUP-HERSTEL.md), bewaar image-digest en stackconfig veilig en controleer herstelbaarheid. Voer geen tests/seed tegen productie uit.
3. Na expliciete eigenaarbeslissing: merge/update volgens bestaande procedure. De bestaande entrypoint voert `prisma migrate deploy` uit. Deze branch voegt tabellen, velden met veilige defaults, enumwaarden en scopeconstraints toe. Bestaande accounts/ringen blijven NORMAL/isDemo=false. Geen data-import of conversie van bestaande ring.
4. Controleer login en MFA voor gewone gebruiker en webmin. Controleer publieke privacy-, support- en verwijderpagina en verwijderwachtrij. Geen vlaggen automatisch aanzetten.
5. Log in op de **website** als systeembeheer (wachtwoord + TOTP), ga naar Instellingen → Reviewdemo en verwijderverzoeken. Genereer **drie verschillende willekeurige wachtwoorden van minimaal 20 tekens, maximaal 72 UTF-8-bytes**, bij voorkeur 32 ASCII-tekens, in je wachtwoordmanager. Bewaar daar de drie logins; plak alleen in de beveiligde wachtwoordvelden. Deze pagina toont nooit opgeslagen wachtwoorden. Maak geen echte accounts via scripts of tests.
6. Provisioning maakt uitsluitend de getagde **Ringtools Demo** en REVIEW-accounts `apple.review1@ringtools.invalid`, `apple.review2@ringtools.invalid`, `apple.review3@ringtools.invalid`. `.invalid` is opzettelijk gereserveerd: geen mailbox nodig. Een gelijknamige echte ring of gewoon account wordt nooit overgenomen. Rollen: RINGPRESIDIUM, HOGERAAD, RINGSECRETARIS. Geen ring- of systeembeheerrechten. Tenant-ID's worden alleen door de server bepaald.
7. Voer **Demo herstellen** uit met de bevestiging `Ringtools Demo`. Alleen het gemarkeerde fictieve tenant wordt opgeschoond; sessies van reviewers vervallen. Fout tijdens seed blokkeert de demo; herstel de fout en probeer veilig opnieuw. Succes maakt de seed zichtbaar. Reset vóór review, niet tijdens Apples review; verwerkte demodossiers volgen ook de normale opruimingstermijn van 30 dagen.
8. Log met ieder account in dezelfde productie-app in via Demoaccount; probeer desgewenst een lokaal gemanipuleerd verzoek naar een andere ring (moet geweigerd). Doorloop de volledige fictieve workflow. Geen echte gegevens invoeren. Houd reviewdemo actief zolang Apple toegang nodig heeft.
9. Wachtwoord wijzigen: alleen het betreffende veld invullen, overige velden leeg. Bestaande sessies worden ingetrokken; geen appbuild nodig. Intrekken: deactiveer reviewaccount in hetzelfde beheer. De reviewer moet daarna opnieuw aanmelden. Na echte accountverwijdering: opnieuw provisioneren en resetten om drie rollen te herstellen.
10. Start de bestaande **handmatige** TestFlight-workflow pas zelf na beoordeling: juiste feature/release-ref, productie-HTTPS-URL, versie, uniek **hoger** buildnummer en expliciete uploadkeuze. Deze opdracht start die workflow niet. Verifieer de build op fysieke iPhone/iPad en Android volgens VALIDATIE. Gebruik nooit Personal Team voor store/TestFlight.
11. Vul metadata, App Privacy, export compliance, leeftijd/DSA/rechten, reviewcontact/telefoon en besloten credentials in App Store Connect in; voeg de echte releasecaptures toe. Selecteer de gecontroleerde build, kies handmatige release en dien zelf ter review in. Vraag Unlisted daarna/volgens Apple-procedure aan, zonder app- of testgeheimen openbaar te maken.

Rollback: additieve migraties niet terugdraaien door tabellen/data te wissen. Vóór provisioning kan de vorige image met bestaande data werken. **Na provisioning** herkent oude code de nieuwe accountsoorten niet: deactiveer de demo en alle REVIEW/AUDIT-accounts en trek hun sessies in vóór applicatierollback, of herstel gecontroleerd de complete pre-updateback-up met expliciet besef van verlies van latere wijzigingen. Laat nieuwe tabellen/enumwaarden staan; PostgreSQL enumverwijdering is geen simpele downmigration. Test herstel op een geïsoleerde kopie, niet live. Geen rollback van alleen half de database.

## Technische iOS-controle

Bundle-ID `nl.ringapeldoorn.ringtools` blijft gelijk. `MARKETING_VERSION`/clientversie 1.0.0; de handmatige workflow neemt een expliciet buildnummer of runnummer. Vergelijk met het **hoogste reeds geüploade nummer**: een runnummer is niet vanzelf hoger dan een eerdere handmatige override.

`.github/workflows/ios-testflight.yml` blijft uitsluitend `workflow_dispatch`, omgeving `testflight`, productie-HTTPS-URL en vier bestaande ASC/teamsecrets. Automatische archive/export signing en verificaties voor bundle-ID, versie/build, get-task-allow, productie-APNs en Associated Domains blijven behouden. Feature-CI bouwt alleen simulator/debug zonder publicatie. Secrets nooit in appvariabelen; de reviewwachtwoorden zijn uitsluitend backendhashes.

Eigen icoon: `mobile/resources/icon.png`, 1024×1024; gegenereerde AppIcon-assets. PrivacyInfo is aangevuld voor religieuze/gevoelige en gebruiksgegevens. Native Face ID-omschrijving, secure storage, lokale appvergrendeling, APNs-entitlements en `webcredentials`/`applinks` blijven behouden. `Debug-PersonalTeam` blijft apart en zonder entitlements. Server voor TestFlight/App Store: **APNS_PRODUCTION=true** en echte Team-ID/AASA/Android-fingerprint; niets daarvan verzinnen. Signed archive, daadwerkelijke Universal Links, pushlevering en store-upload zijn alleen met echte eigenaarcredentials en fysieke releaseacceptatie definitief te bevestigen.


Vóór de store-release ook de [notificatieprivacycorrectie](../NOTIFICATIE-PRIVACY-UITVOERING.md) uitvoeren en fysiek accepteren; de volledige reviewworkflow omvat na het hogeraadsakkoord een afzonderlijke uitvoeringsvrijgave.
